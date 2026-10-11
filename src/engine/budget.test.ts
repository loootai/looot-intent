import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { Budget, DEFAULT_LIMITS, HARD_EXPIRY_MS, RESERVE_TTL_MS } from "./budget";
import { loadConfig } from "./config";
import { DEMO_NOW, demoRunner } from "./demo";
import { runIntent } from "./engine";
import { LoootError, type LoootRun, type Runner } from "./looot";
import { FALLBACK_PRICES } from "./signals";

const cfg = loadConfig();
const now = new Date("2026-10-10T09:00:00Z");
const base = { config: cfg, prices: FALLBACK_PRICES, now, capMicros: 5_000_000 };
let dir: string;
let file: string;
const open = () => new Budget(file);

beforeEach(() => {
  mkdirSync(join(process.cwd(), ".vitest"), { recursive: true });
  dir = mkdtempSync(join(process.cwd(), ".vitest", "budget-"));
  file = join(dir, "budget.json");
});

function runner(answer: (n: number, endpointId: string) => LoootRun | Promise<LoootRun> | never) {
  const calls: string[] = [];
  const looot: Runner = {
    async runAndWait(endpointId) {
      calls.push(endpointId);
      return answer(calls.length, endpointId);
    },
  };
  return { looot, calls };
}
const completed = (cost: number): LoootRun => ({ runId: "run_ok", status: "completed", result: { data: [] }, actualCost: cost });
/** One signal on, so one account is one call. */
const one = (id: keyof typeof cfg.signals = "hiring") => ({ ...cfg, concurrency: 1, signals: Object.fromEntries(Object.entries(cfg.signals).map(([k, v]) => [k, { ...v, enabled: k === id }])) as typeof cfg.signals });
const PRICE = FALLBACK_PRICES["predictleads-companies-job-openings"];

describe("period budget", () => {
  it("has a default daily and monthly limit that the owner can change", async () => {
    const b = open();
    expect((await b.status(now)).limits).toEqual(DEFAULT_LIMITS);
    await b.setLimits({ dailyMicros: 2_000_000, monthlyMicros: 9_000_000 });
    expect((await open().status(now)).limits).toEqual({ dailyMicros: 2_000_000, monthlyMicros: 9_000_000 });
  });

  it("lets exactly one of two concurrent reservations through when their sum is over the budget", async () => {
    await open().setLimits({ dailyMicros: 1_000_000, monthlyMicros: 5_000_000 });
    const out = await Promise.all([open().reserve("k1", 700_000, now), open().reserve("k2", 700_000, now)]);
    expect(out.filter((r) => r.ok)).toHaveLength(1);
    expect(out.filter((r) => !r.ok)).toHaveLength(1);
    expect((await open().status(now)).day.reservedMicros).toBe(700_000);
  });

  it("holds under 25 concurrent reservations from separate handles", async () => {
    await open().setLimits({ dailyMicros: 1_000_000, monthlyMicros: 5_000_000 });
    const out = await Promise.all(Array.from({ length: 25 }, (_, i) => open().reserve(`k${i}`, 100_000, now)));
    expect(out.filter((r) => r.ok)).toHaveLength(10);
    const s = await open().status(now);
    expect(s.day.reservedMicros).toBe(1_000_000);
    expect(s.day.remainingMicros).toBe(0);
  });

  it("stops many small runs at the budget and says which limit it hit", async () => {
    await open().setLimits({ dailyMicros: 300_000, monthlyMicros: 300_000 });
    const b = open();
    let ok = 0;
    let last = "";
    for (let i = 0; i < 10; i++) {
      const r = await b.reserve(`s${i}`, 100_000, now);
      if (r.ok) ok++;
      else last = r.message;
    }
    expect(ok).toBe(3);
    expect(last).toMatch(/budget is reached/i);
  });

  it("counts a settled run against the day and the month, and a new day starts clean", async () => {
    const b = open();
    await b.setLimits({ dailyMicros: 1_000_000, monthlyMicros: 5_000_000 });
    await b.reserve("a", 400_000, now);
    await b.settle("a", "fp", 350_000, now);
    const s = await b.status(now);
    expect(s.day.usedMicros).toBe(350_000);
    expect(s.month.usedMicros).toBe(350_000);
    const next = new Date("2026-10-11T09:00:00Z");
    const s2 = await b.status(next);
    expect(s2.day.usedMicros).toBe(0);
    expect(s2.month.usedMicros).toBe(350_000);
  });

  it("releases a reservation", async () => {
    const b = open();
    await b.reserve("a", 400_000, now);
    await b.release("a");
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });

  it("rejects limits that are not positive or put the day above the month", async () => {
    const b = open();
    await expect(b.setLimits({ dailyMicros: 0, monthlyMicros: 1_000_000 })).rejects.toThrow();
    await expect(b.setLimits({ dailyMicros: 5_000_000, monthlyMicros: 1_000_000 })).rejects.toThrow(/daily/i);
    await expect(b.setLimits({ dailyMicros: Number.NaN, monthlyMicros: 1_000_000 })).rejects.toThrow();
  });
});

describe("reconciling reservations", () => {
  async function pendingReservation() {
    const b = open();
    await b.reserve("p", 10_000, now);
    await b.attach("p", "run_p");
    return b;
  }

  it("settles a late completion to the real cost", async () => {
    const b = await pendingReservation();
    await b.reconcile({ getRun: async () => ({ runId: "run_p", status: "completed", result: { x: 1 }, actualCost: 0.0031 }) }, new Date(now.getTime() + 60_000));
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(0);
    expect(s.day.usedMicros).toBe(3_100);
  });

  it("keeps the reservation while the run is still going", async () => {
    const b = await pendingReservation();
    await b.reconcile({ getRun: async () => ({ runId: "run_p", status: "running" }) }, new Date(now.getTime() + 2 * RESERVE_TTL_MS));
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(10_000);
    expect(s.day.usedMicros).toBe(0);
  });

  it("releases when the run ended failed with no charge", async () => {
    const b = await pendingReservation();
    await b.reconcile({ getRun: async () => ({ runId: "run_p", status: "failed", actualCost: 0 }) }, new Date(now.getTime() + 60_000));
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(0);
    expect(s.day.usedMicros).toBe(0);
  });

  it("keeps an unfetchable run reserved until the hard expiry, then releases it", async () => {
    const b = await pendingReservation();
    const broken = { getRun: async (): Promise<LoootRun> => { throw new LoootError("down", 503); } };
    await b.reconcile(broken, new Date(now.getTime() + 2 * RESERVE_TTL_MS));
    expect((await b.status(now)).day.reservedMicros).toBe(10_000);
    await b.reconcile(broken, new Date(now.getTime() + HARD_EXPIRY_MS + 1));
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });

  it("keeps a reservation that never got a run id until the hard expiry", async () => {
    const b = open();
    await b.reserve("crash", 10_000, now);
    await b.reconcile({ getRun: async () => { throw new Error("not called"); } }, new Date(now.getTime() + 2 * RESERVE_TTL_MS));
    expect((await b.status(now)).day.reservedMicros).toBe(10_000);
    await b.reconcile({ getRun: async () => { throw new Error("not called"); } }, new Date(now.getTime() + HARD_EXPIRY_MS + 1));
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });
});

describe("runIntent with the budget", () => {
  const hiring = { ...base, config: one("hiring") };

  it("does not charge a repeated identical request twice", async () => {
    const b = open();
    const first = runner(() => completed(0.01));
    const r1 = (await runIntent({ ...hiring, domains: ["acme.com", "globex.io"], looot: first.looot, ledger: b })).result;
    const second = runner(() => completed(0.01));
    const r2 = (await runIntent({ ...hiring, domains: ["acme.com", "globex.io"], looot: second.looot, ledger: b })).result;
    expect(first.calls).toHaveLength(2);
    expect(second.calls).toHaveLength(0);
    expect(r2.spentMicros).toBe(0);
    expect((await b.status(now)).day.usedMicros).toBe(r1.spentMicros);
  });

  it("charges again after the freshness window rolls over, with a new key", async () => {
    const b = open();
    const a = runner(() => completed(0.01));
    await runIntent({ ...hiring, domains: ["acme.com"], looot: a.looot, ledger: b });
    const later = runner(() => completed(0.01));
    await runIntent({ ...hiring, domains: ["acme.com"], looot: later.looot, ledger: b, now: new Date("2026-10-20T09:00:00Z") });
    expect(later.calls).toHaveLength(1);
  });

  it("keeps the total charged inside the budget when 16 workers in one process race for it", async () => {
    const b = open();
    await b.setLimits({ dailyMicros: 5 * PRICE, monthlyMicros: 5 * PRICE });
    const domains = Array.from({ length: 40 }, (_, i) => `d${i}.example.com`);
    const { looot, calls } = runner(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return completed(PRICE / 1e6);
    });
    const { result } = await runIntent({ ...hiring, config: { ...hiring.config, concurrency: 16 }, domains, looot, ledger: b, capMicros: 100_000_000 });
    const s = await b.status(now);
    expect(calls).toHaveLength(5);
    expect(result.spentMicros).toBe(5 * PRICE);
    expect(s.day.usedMicros).toBe(5 * PRICE);
    expect(s.day.reservedMicros).toBe(0);
    expect(result.skippedByBudget).toBe(35);
    expect(result.budgetMessage).toMatch(/budget is reached/i);
  });

  it("keeps the total inside the budget when two processes' worth of runs start together", async () => {
    await open().setLimits({ dailyMicros: 6 * PRICE, monthlyMicros: 6 * PRICE });
    const mk = (tag: string) => runIntent({ ...hiring, config: { ...hiring.config, concurrency: 8 }, domains: Array.from({ length: 12 }, (_, i) => `${tag}${i}.example.com`), looot: runner(async () => { await new Promise((r) => setTimeout(r, 3)); return completed(PRICE / 1e6); }).looot, ledger: open(), capMicros: 100_000_000 });
    const [a, c] = await Promise.all([mk("a"), mk("c")]);
    expect(a.result.spentMicros + c.result.spentMicros).toBe(6 * PRICE);
    expect((await open().status(now)).day.usedMicros).toBe(6 * PRICE);
  });

  it("still holds the per-run cap when 16 workers wait on the reservation at once", async () => {
    const b = open();
    const domains = Array.from({ length: 40 }, (_, i) => `c${i}.example.com`);
    const { looot, calls } = runner(() => completed(PRICE / 1e6));
    const { result } = await runIntent({ ...hiring, config: { ...hiring.config, concurrency: 16 }, domains, looot, ledger: b, capMicros: 7 * PRICE });
    expect(calls).toHaveLength(7);
    expect(result.skippedByCap).toBe(33);
  });

  it("stops many small runs at the budget", async () => {
    const b = open();
    await b.setLimits({ dailyMicros: 3 * PRICE, monthlyMicros: 3 * PRICE });
    let calls = 0;
    for (let i = 0; i < 8; i++) {
      const r = runner(() => completed(PRICE / 1e6));
      await runIntent({ ...hiring, domains: [`run${i}.example.com`], looot: r.looot, ledger: b });
      calls += r.calls.length;
    }
    expect(calls).toBe(3);
    expect((await b.status(now)).day.usedMicros).toBe(3 * PRICE);
  });

  it("keeps the reservation of a pending call and never records it failed at zero", async () => {
    const b = open();
    const { looot } = runner(() => ({ runId: "run_slow", status: "running" }));
    const { result } = await runIntent({ ...hiring, domains: ["acme.com"], looot, ledger: b });
    expect(result.pendingCalls).toBe(1);
    expect(result.failedCalls).toBe(0);
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(PRICE);
    expect(s.day.usedMicros).toBe(0);
  });

  it("settles a pending call to its real cost when it ends later", async () => {
    const b = open();
    const { looot } = runner(() => ({ runId: "run_slow", status: "pending_provider" }));
    await runIntent({ ...hiring, domains: ["acme.com"], looot, ledger: b });
    await b.reconcile({ getRun: async () => ({ runId: "run_slow", status: "completed", result: { data: [] }, actualCost: 0.0093 }) }, new Date(now.getTime() + 60_000));
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(0);
    expect(s.day.usedMicros).toBe(9_300);
  });

  it("releases the reservation of a call looot answered with an error", async () => {
    const b = open();
    const { looot } = runner(() => { throw new LoootError("bad input", 400, "invalid_input"); });
    const { result } = await runIntent({ ...hiring, domains: ["acme.com"], looot, ledger: b });
    expect(result.failedCalls).toBe(1);
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(0);
    expect(s.day.usedMicros).toBe(0);
  });

  it("releases a run looot reports failed at no charge", async () => {
    const b = open();
    const { looot } = runner(() => ({ runId: "r", status: "failed", actualCost: 0, error: { code: "provider_error" } }));
    await runIntent({ ...hiring, domains: ["acme.com"], looot, ledger: b });
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });

  it("keeps the reservation when the network fails and the outcome is unknown", async () => {
    const b = open();
    const { looot } = runner(() => { throw new TypeError("fetch failed"); });
    await runIntent({ ...hiring, domains: ["acme.com"], looot, ledger: b });
    expect((await b.status(now)).day.reservedMicros).toBe(PRICE);
  });

  it("makes no call and no reservation once the budget is reached, and says why", async () => {
    const b = open();
    await b.setLimits({ dailyMicros: PRICE - 1, monthlyMicros: PRICE - 1 });
    const { looot, calls } = runner(() => completed(0.01));
    const { result } = await runIntent({ ...hiring, domains: ["acme.com"], looot, ledger: b });
    expect(calls).toHaveLength(0);
    expect(result.skippedByBudget).toBe(1);
    expect(result.accounts[0].breakdown[0].status).toBe("skipped_budget");
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });

  it("is not used in demo mode", async () => {
    const b = open();
    const { result } = await runIntent({ ...base, domains: ["acme.com"], looot: demoRunner(), ledger: b, demo: true, now: DEMO_NOW });
    expect(result.spentMicros).toBe(0);
    expect(() => readFileSync(file, "utf8")).toThrow();
  });
});

describe("the budget file", () => {
  it("survives a damaged file by falling back to the defaults", async () => {
    writeFileSync(file, "{not json");
    expect((await open().status(now)).limits).toEqual(DEFAULT_LIMITS);
  });
});
