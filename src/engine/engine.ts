import type { IntentConfig } from "./config";
import { LoootError, type PriceMap, type Runner } from "./looot";
import { toMicros } from "./money";
import { scoreAccount } from "./score";
import { SIGNALS, SIGNAL_BY_ID, type SignalDef } from "./signals";
import type { AccountScore, Quote, QuoteLine, RunResult, SignalEvent, SignalId, SignalResult, Snapshots } from "./types";

/** Lower-cases a domain and strips scheme, path and "www.". Returns null when it is not a domain. */
export function normalizeDomain(input: string): string | null {
  let d = input.trim().toLowerCase();
  if (!d) return null;
  d = d.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0].replace(/:\d+$/, "");
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d) ? d : null;
}

const HEADER_WORDS = new Set(["domain", "domains", "website", "url", "company", "site"]);

/** Unique, valid domains from free text: one per line, or separated by commas, semicolons or tabs. Header words are skipped. */
export function parseDomains(text: string): { domains: string[]; rejected: string[] } {
  const seen = new Set<string>();
  const rejected: string[] = [];
  for (const part of text.split(/[\n,;\t]+/)) {
    const t = part.trim().replace(/^["']|["']$/g, "");
    if (!t || t.startsWith("#") || HEADER_WORDS.has(t.toLowerCase())) continue;
    const d = normalizeDomain(t);
    if (d) seen.add(d);
    else rejected.push(t);
  }
  return { domains: [...seen], rejected };
}

/** Domains from one column of a CSV file. `column` is a header name or a zero-based index. Defaults to the first column. */
export function parseCsvDomains(text: string, column?: string): { domains: string[]; rejected: string[] } {
  const rows = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const cells = (l: string) => l.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  let idx = 0;
  let body = rows;
  if (column !== undefined && /^\d+$/.test(column)) idx = Number(column);
  else if (rows.length) {
    const head = cells(rows[0]).map((h) => h.toLowerCase());
    const found = column !== undefined ? head.indexOf(column.toLowerCase()) : head.findIndex((h) => HEADER_WORDS.has(h));
    if (column !== undefined && found < 0) throw new Error(`Column "${column}" not found. Header: ${head.join(", ")}`);
    if (found >= 0) {
      idx = found;
      body = rows.slice(1);
    }
  }
  return parseDomains(body.map((l) => cells(l)[idx] ?? "").join("\n"));
}

/** Signals that are switched on in the config, in a fixed order. */
export function enabledSignals(cfg: IntentConfig): SignalDef[] {
  return SIGNALS.filter((s) => cfg.signals[s.id].enabled);
}

/** What a run costs at list price. Pure: no call is made. */
export function buildQuote(domains: string[], cfg: IntentConfig, prices: PriceMap, priceSource: Quote["priceSource"] = "catalog"): Quote {
  const lines: QuoteLine[] = enabledSignals(cfg).map((s) => {
    const priceMicros = prices[s.endpointId] ?? s.fallbackMicros;
    return { signalId: s.id, label: s.label, provider: s.provider, jobId: s.jobId, endpointId: s.endpointId, unit: s.priceUnit, calls: domains.length, priceMicros, totalMicros: priceMicros * domains.length };
  });
  const perAccountMicros = lines.reduce((n, l) => n + l.priceMicros, 0);
  return { lines, accounts: domains.length, perAccountMicros, totalMicros: perAccountMicros * domains.length, priceSource };
}

function windowStamp(now: Date, w: IntentConfig["freshnessWindow"]): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (w === "month") return d.toISOString().slice(0, 7);
  if (w === "week") d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function shortHash(text: string): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++) {
    h ^= BigInt(text.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0").slice(0, 10);
}

/**
 * One key per (account, signal, input, window). The same key replays the stored run and never charges twice,
 * so a re-run inside the window, or after a crash, costs nothing for calls that already finished.
 */
export function idempotencyKey(domain: string, def: SignalDef, input: Record<string, unknown>, cfg: IntentConfig, now: Date): string {
  return `intent:v1:${domain}:${def.id}:${shortHash(JSON.stringify(input))}:${windowStamp(now, cfg.freshnessWindow)}`;
}

export interface RunOptions {
  domains: string[];
  config: IntentConfig;
  looot: Runner;
  prices: PriceMap;
  priceSource?: Quote["priceSource"];
  /** Endpoint ids whose live price could not be read. A call to one of them is refused. */
  unpriced?: readonly string[];
  /** Per-run spend cap in micro-dollars. No call is made that could pass it. */
  capMicros: number;
  /** Readings from earlier runs, for signals that score growth. */
  snapshots?: Snapshots;
  now?: Date;
  demo?: boolean;
  onProgress?: (done: number, total: number, domain: string) => void;
}

const FAIL_STOPS = new Set(["unauthorized", "insufficient_funds", "payment_required", "invalid_token", "missing_token"]);

/**
 * Fetches every enabled signal for every domain, scores each account and ranks them.
 * Before each call it reserves the list price against the cap, so the spend can never pass the cap.
 * A call that is still running when waiting stops is "pending", never a failure.
 */
export async function runIntent(opts: RunOptions): Promise<{ result: RunResult; snapshots: Snapshots }> {
  const { config: cfg, looot, prices } = opts;
  const now = opts.now ?? new Date();
  const startedAt = opts.demo ? now.toISOString() : new Date().toISOString();
  const signals = enabledSignals(cfg);
  const quote = buildQuote(opts.domains, cfg, prices, opts.priceSource);
  const unpriced = new Set(opts.unpriced ?? []);
  const prior = opts.snapshots ?? {};

  let committed = 0; // list price reserved for calls made or in flight, replaced by the real charge when a call ends
  let spent = 0;
  let skippedByCap = 0;
  let pendingCalls = 0;
  let failedCalls = 0;
  let aborted: string | null = null;
  const nextSnapshots: Snapshots = JSON.parse(JSON.stringify(prior));

  async function one(domain: string, def: SignalDef): Promise<SignalResult> {
    const listPriceMicros = prices[def.endpointId] ?? def.fallbackMicros;
    const base = { signalId: def.id, listPriceMicros, events: [] as SignalEvent[], costMicros: 0 };
    if (aborted) return { ...base, status: "skipped_cap", message: aborted };
    if (!opts.demo && unpriced.has(def.endpointId)) return { ...base, status: "skipped_price", message: "Source unavailable: the catalog has no readable price for this endpoint." };
    if (!opts.demo && committed + listPriceMicros > opts.capMicros) {
      skippedByCap += 1;
      return { ...base, status: "skipped_cap", message: "Spend cap reached." };
    }
    if (!opts.demo) committed += listPriceMicros;
    const input = def.buildInput(domain);
    try {
      const run = await looot.runAndWait(def.endpointId, input, idempotencyKey(domain, def, input, cfg, now));
      const cost = opts.demo ? 0 : toMicros(run.actualCost);
      if (run.status === "completed") {
        committed += cost - listPriceMicros;
        spent += cost;
        try {
          const parsed = def.parse(run.result, { icp: cfg.icp, now });
          return { signalId: def.id, status: "ok", costMicros: cost, listPriceMicros, runId: run.runId, events: parsed.events, metric: parsed.metric };
        } catch (e) {
          failedCalls += 1;
          return { ...base, status: "parse_error", costMicros: cost, runId: run.runId, message: (e as Error).message };
        }
      }
      if (run.status === "failed" || run.status === "blocked" || run.status === "stopped") {
        committed += cost - listPriceMicros;
        spent += cost;
        failedCalls += 1;
        return { ...base, status: "failed", costMicros: cost, runId: run.runId, errorCode: run.error?.code ?? run.status, message: run.error?.message };
      }
      // queued, running, reconciliation_pending, pending_provider: the provider has not finished. Keep the reservation.
      pendingCalls += 1;
      return { ...base, status: "pending", runId: run.runId, message: `Run ${run.runId} is ${run.status}.` };
    } catch (e) {
      committed -= listPriceMicros; // the request never produced a run
      failedCalls += 1;
      const err = e instanceof LoootError ? e : null;
      const code = err?.code ?? "network_error";
      if (err && (FAIL_STOPS.has(code) || err.status === 401 || err.status === 402)) aborted = `Stopped: ${err.message}`;
      return { ...base, status: "failed", errorCode: code, message: (e as Error).message };
    }
  }

  const accounts: AccountScore[] = new Array(opts.domains.length);
  let next = 0;
  let done = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= opts.domains.length) return;
      const domain = opts.domains[i];
      const results: SignalResult[] = [];
      for (const def of signals) results.push(await one(domain, def));
      accounts[i] = scoreAccount(domain, results, cfg, now, prior[domain]);
      for (const r of results) {
        if (r.status === "ok" && r.metric?.kind === "snapshot") (nextSnapshots[domain] ??= {})[r.signalId] = { value: r.metric.value, at: now.toISOString() };
      }
      opts.onProgress?.(++done, opts.domains.length, domain);
    }
  }
  await Promise.all(Array.from({ length: Math.min(cfg.concurrency, Math.max(1, opts.domains.length)) }, worker));

  accounts.sort((a, b) => b.score - a.score || b.breakdown.filter((x) => x.strength > 0).length - a.breakdown.filter((x) => x.strength > 0).length || a.domain.localeCompare(b.domain));
  const result: RunResult = {
    runId: `run_${shortHash(startedAt + opts.domains.join(","))}`,
    startedAt,
    finishedAt: opts.demo ? now.toISOString() : new Date().toISOString(),
    demo: opts.demo ?? false,
    icp: cfg.icp.description,
    capMicros: opts.capMicros,
    quotedMicros: quote.totalMicros,
    spentMicros: spent,
    skippedByCap,
    pendingCalls,
    failedCalls,
    aborted,
    quote,
    accounts,
  };
  return { result, snapshots: nextSnapshots };
}

export type { SignalId };
export { SIGNAL_BY_ID };
