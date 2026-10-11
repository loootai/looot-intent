import { loadConfig, type IntentConfig } from "@/engine/config";
import { DEMO_DOMAINS, DEMO_ICP, DEMO_NOW, demoRunner, demoSnapshots } from "@/engine/demo";
import { buildQuote, parseDomains, runIntent } from "@/engine/engine";
import { fetchPrices, hasLoootToken, loootFromEnv } from "@/engine/looot";
import { toMicros } from "@/engine/money";
import { FALLBACK_PRICES } from "@/engine/signals";
import { readState, writeState, type State } from "@/engine/state";
import { maxRunUsd } from "@/lib/auth/policy";
import type { Quote, RunResult } from "@/engine/types";

/** true when the app runs on sample data: no token, no network, no cost. */
export function isDemo(): boolean {
  return process.env.LOOOT_INTENT_DEMO === "1";
}

export function canRunLive(): boolean {
  return hasLoootToken();
}

declare global {
  var __intentDemoState: State | undefined;
}

/** The config the app scores with. The demo swaps in the sample ICP. */
export function appConfig(): IntentConfig {
  const cfg = loadConfig(process.env.LOOOT_INTENT_CONFIG);
  if (isDemo()) cfg.icp.description = DEMO_ICP;
  return cfg;
}

/** The latest run. In demo mode it is computed once from the sample accounts and kept in memory. */
export async function getState(): Promise<State> {
  if (!isDemo()) return readState();
  if (!globalThis.__intentDemoState) {
    const { result, snapshots } = await runIntent({ config: appConfig(), domains: DEMO_DOMAINS, looot: demoRunner(), prices: FALLBACK_PRICES, capMicros: 5_000_000, snapshots: demoSnapshots(), now: DEMO_NOW, demo: true });
    globalThis.__intentDemoState = { run: result, snapshots };
  }
  return globalThis.__intentDemoState;
}

export interface QuoteReply {
  quote: Quote;
  rejected: string[];
  domains: string[];
  unpriced: string[];
}

/** Quote for a pasted domain list. Reads prices from the public catalog (free) unless in demo mode. */
export async function quoteFor(domainText: string): Promise<QuoteReply> {
  const { domains, rejected } = parseDomains(domainText);
  const cfg = appConfig();
  if (isDemo()) return { quote: buildQuote(domains, cfg, FALLBACK_PRICES, "catalog"), rejected, domains, unpriced: [] };
  const live = await fetchPrices(FALLBACK_PRICES);
  return { quote: buildQuote(domains, cfg, live.prices, live.source), rejected, domains, unpriced: live.unread };
}

/**
 * Runs the engine for the UI and saves the result. The UI never sees the token.
 * The ceiling is the server's LOOOT_INTENT_MAX_RUN_USD, or less if the caller confirmed a smaller quote. The caller cannot raise it.
 * The server prices the list again and refuses before any paid call when that price is above the ceiling or above the quote the caller confirmed.
 */
export async function runFor(input: { domains: string; icp?: string; confirmedMaxMicros: number }): Promise<RunResult> {
  const { domains } = parseDomains(input.domains);
  if (domains.length === 0) throw new Error("No valid domains.");
  if (domains.length > 500) throw new Error("At most 500 domains per run.");
  const cfg = appConfig();
  if (input.icp?.trim()) cfg.icp.description = input.icp.trim();
  const serverCapMicros = toMicros(maxRunUsd());
  const capMicros = Math.min(serverCapMicros, input.confirmedMaxMicros);
  if (isDemo()) {
    const { result, snapshots } = await runIntent({ config: cfg, domains, looot: demoRunner(), prices: FALLBACK_PRICES, capMicros, snapshots: globalThis.__intentDemoState?.snapshots ?? demoSnapshots(), now: DEMO_NOW, demo: true });
    globalThis.__intentDemoState = { run: result, snapshots };
    return result;
  }
  const looot = loootFromEnv();
  const live = await fetchPrices(FALLBACK_PRICES);
  const quote = buildQuote(domains, cfg, live.prices, live.source);
  const dollars = (m: number) => `$${(m / 1e6).toFixed(2)}`;
  if (quote.totalMicros > input.confirmedMaxMicros) throw new Error(`The price now (${dollars(quote.totalMicros)}) is above the quote you confirmed (${dollars(input.confirmedMaxMicros)}). Get a new quote.`);
  if (quote.totalMicros > serverCapMicros) throw new Error(`The quote (${dollars(quote.totalMicros)}) is above this server's per-run cap (${dollars(serverCapMicros)}). Score fewer accounts, or raise LOOOT_INTENT_MAX_RUN_USD on the server.`);
  const state = readState();
  const { result, snapshots } = await runIntent({ config: cfg, domains, looot, prices: live.prices, priceSource: live.source, unpriced: live.unread, capMicros, snapshots: state.snapshots });
  writeState({ run: result, snapshots });
  return result;
}
