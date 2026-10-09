import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config";
import { DEMO_DOMAINS, DEMO_NOW, demoRunner, demoSnapshots } from "./demo";
import { buildQuote, idempotencyKey, normalizeDomain, parseCsvDomains, parseDomains, runIntent } from "./engine";
import { LoootError, type LoootRun, type Runner } from "./looot";
import { FALLBACK_PRICES, SIGNAL_BY_ID } from "./signals";

const cfg = loadConfig();
const now = new Date("2026-10-10T09:00:00Z");
const base = { config: cfg, prices: FALLBACK_PRICES, now };

function recorder(answer: (endpointId: string, input: Record<string, unknown>) => LoootRun | Promise<LoootRun>) {
  const calls: { endpointId: string; input: Record<string, unknown>; key: string }[] = [];
  const looot: Runner = {
    async runAndWait(endpointId, input, key) {
      calls.push({ endpointId, input, key });
      return answer(endpointId, input);
    },
  };
  return { looot, calls };
}
const done = (cost: number, result: unknown = { data: [] }): LoootRun => ({ runId: "r", status: "completed", result, actualCost: cost });

describe("domains", () => {
  it("normalises scheme, www, path and case", () => {
    expect(normalizeDomain("HTTPS://www.Acme.com/pricing?x=1")).toBe("acme.com");
    expect(normalizeDomain("not a domain")).toBeNull();
    expect(normalizeDomain("a@example.com")).toBeNull();
  });
  it("de-duplicates, skips headers and comments, and reports rejects", () => {
    const r = parseDomains("domain\nacme.com\nwww.acme.com\n# note\nglobex.io, initech.co\nnope");
    expect(r.domains).toEqual(["acme.com", "globex.io", "initech.co"]);
    expect(r.rejected).toEqual(["nope"]);
  });
  it("reads one CSV column by header name or index", () => {
    const csv = "name,website,email\nAcme,acme.com,a@example.com\nGlobex,https://globex.io,g@example.com\n";
    expect(parseCsvDomains(csv, "website").domains).toEqual(["acme.com", "globex.io"]);
    expect(parseCsvDomains(csv, "1").domains).toEqual(["acme.com", "globex.io"]);
    expect(() => parseCsvDomains(csv, "site")).toThrow(/not found/);
  });
});

describe("quote", () => {
  it("is calls times list price per enabled signal and makes no call", () => {
    const q = buildQuote(["a.com", "b.com"], cfg, FALLBACK_PRICES);
    expect(q.lines).toHaveLength(10);
    expect(q.perAccountMicros).toBe(Object.values(FALLBACK_PRICES).reduce((a, b) => a + b, 0));
    expect(q.totalMicros).toBe(q.perAccountMicros * 2);
    const off = structuredClone(cfg);
    off.signals.traffic.enabled = false;
    expect(buildQuote(["a.com"], off, FALLBACK_PRICES).lines.map((l) => l.signalId)).not.toContain("traffic");
  });
});

describe("idempotency key", () => {
  it("is stable inside the window and changes with the input or the window", () => {
    const def = SIGNAL_BY_ID.hiring;
    const input = def.buildInput("acme.com");
    const k = idempotencyKey("acme.com", def, input, cfg, now);
    expect(idempotencyKey("acme.com", def, input, cfg, new Date("2026-10-11T20:00:00Z"))).toBe(k); // same ISO week (Mon 5 Oct)
    expect(idempotencyKey("acme.com", def, input, cfg, new Date("2026-10-12T01:00:00Z"))).not.toBe(k); // next week
    expect(idempotencyKey("acme.com", def, { ...input, limit: 5 }, cfg, now)).not.toBe(k);
    expect(idempotencyKey("globex.io", def, def.buildInput("globex.io"), cfg, now)).not.toBe(k);
  });
  it("sends the key on every call", async () => {
    const { looot, calls } = recorder(() => done(0.01));
    await runIntent({ ...base, domains: ["acme.com"], looot, capMicros: 5_000_000 });
    expect(calls).toHaveLength(10);
    expect(new Set(calls.map((c) => c.key)).size).toBe(10);
    expect(calls.every((c) => c.key.startsWith("intent:v1:acme.com:"))).toBe(true);
  });
});

describe("spend cap", () => {
  it("never makes a call that could pass the cap", async () => {
    const { looot, calls } = recorder(() => done(0.01));
    const cap = 100_000; // $0.10
    const { result } = await runIntent({ ...base, domains: ["a.com", "b.com", "c.com"], looot, capMicros: cap, config: { ...cfg, concurrency: 3 } });
    const listTotal = calls.reduce((n, c) => n + FALLBACK_PRICES[c.endpointId], 0);
    expect(listTotal).toBeLessThanOrEqual(cap);
    expect(result.skippedByCap).toBe(30 - calls.length);
    expect(result.skippedByCap).toBeGreaterThan(0);
    const skipped = result.accounts.flatMap((a) => a.breakdown).filter((b) => b.status === "skipped_cap");
    expect(skipped).toHaveLength(result.skippedByCap);
  });
  it("makes no call at all with a zero cap", async () => {
    const { looot, calls } = recorder(() => done(0));
    const { result } = await runIntent({ ...base, domains: ["a.com"], looot, capMicros: 0 });
    expect(calls).toHaveLength(0);
    expect(result.accounts[0].score).toBe(0);
  });
  it("refuses an endpoint whose live price could not be read", async () => {
    const { looot, calls } = recorder(() => done(0));
    const { result } = await runIntent({ ...base, domains: ["a.com"], looot, capMicros: 5_000_000, unpriced: ["datagma-website-traffic"] });
    expect(calls.map((c) => c.endpointId)).not.toContain("datagma-website-traffic");
    expect(result.accounts[0].breakdown.find((b) => b.signalId === "traffic")!.status).toBe("skipped_price");
  });
});

describe("failure handling", () => {
  it("treats a run still in progress as pending, not failed", async () => {
    const { looot } = recorder((id) => (id === "companyenrich-companies-workforce" ? { runId: "r9", status: "pending_provider" } : done(0.01)));
    const { result } = await runIntent({ ...base, domains: ["a.com"], looot, capMicros: 5_000_000 });
    expect(result.pendingCalls).toBe(1);
    expect(result.failedCalls).toBe(0);
    const line = result.accounts[0].breakdown.find((b) => b.signalId === "headcount")!;
    expect(line.status).toBe("pending");
    expect(result.accounts[0].pendingCount).toBe(1);
  });
  it("records a failed call at the charge looot reports and carries on", async () => {
    const { looot } = recorder((id) => (id === "adyntel-linkedin" ? { runId: "r", status: "failed", actualCost: 0, error: { code: "upstream_error", message: "x" } } : done(0.01)));
    const { result } = await runIntent({ ...base, domains: ["a.com"], looot, capMicros: 5_000_000 });
    expect(result.failedCalls).toBe(1);
    expect(result.spentMicros).toBe(9 * 10_000);
  });
  it("stops the whole run on a 402 and says why", async () => {
    const { looot, calls } = recorder(() => {
      throw new LoootError("Top up to continue", 402, "insufficient_funds");
    });
    const { result } = await runIntent({ ...base, domains: ["a.com", "b.com"], looot, capMicros: 5_000_000, config: { ...cfg, concurrency: 1 } });
    expect(calls).toHaveLength(1);
    expect(result.aborted).toContain("Top up");
  });
  it("keeps a paid call whose body does not parse and reports it", async () => {
    const { looot } = recorder(() => done(0.01, "<html>"));
    const { result } = await runIntent({ ...base, domains: ["a.com"], looot, capMicros: 5_000_000 });
    expect(result.accounts[0].score).toBe(0);
    expect(result.spentMicros).toBe(10 * 10_000);
  });
  it("survives a parser that throws", async () => {
    const spy = vi.spyOn(SIGNAL_BY_ID.news, "parse").mockImplementation(() => {
      throw new Error("boom");
    });
    const { looot } = recorder(() => done(0.01));
    const { result } = await runIntent({ ...base, domains: ["a.com"], looot, capMicros: 5_000_000 });
    spy.mockRestore();
    expect(result.accounts[0].breakdown.find((b) => b.signalId === "news")!.status).toBe("parse_error");
  });
});

describe("demo run", () => {
  it("ranks the sample accounts and needs no network", async () => {
    const { result, snapshots } = await runIntent({ ...base, now: DEMO_NOW, domains: DEMO_DOMAINS, looot: demoRunner(), capMicros: 5_000_000, demo: true, snapshots: demoSnapshots() });
    expect(result.spentMicros).toBe(0);
    const scores = result.accounts.map((a) => a.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(result.accounts[0].stage).toBe("deciding");
    expect(result.accounts.at(-1)!.stage).toBe("unaware");
    expect(snapshots[DEMO_DOMAINS[0]].headcount).toBeDefined();
  });
  it("scores growth against the saved snapshot on the next run", async () => {
    const first = await runIntent({ ...base, now: DEMO_NOW, domains: [DEMO_DOMAINS[0]], looot: demoRunner(), capMicros: 5_000_000, demo: true });
    expect(first.result.accounts[0].breakdown.find((b) => b.signalId === "headcount")!.points).toBe(0);
    const second = await runIntent({ ...base, now: DEMO_NOW, domains: [DEMO_DOMAINS[0]], looot: demoRunner(), capMicros: 5_000_000, demo: true, snapshots: first.snapshots });
    // same reading twice: growth is zero, still no points
    expect(second.result.accounts[0].breakdown.find((b) => b.signalId === "headcount")!.points).toBe(0);
  });
});
