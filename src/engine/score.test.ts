import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";
import { maxPointsOf, recencyWeight, scoreAccount, stageOf, strengthOf } from "./score";
import type { SignalEvent, SignalId, SignalResult } from "./types";

const cfg = loadConfig();
const now = new Date("2026-10-10T00:00:00Z");
const ev = (signalId: SignalId, daysAgo: number | null, relevant = true): SignalEvent => ({
  signalId, category: "hiring", provider: "predictleads", title: "x", relevant,
  date: daysAgo === null ? null : new Date(now.getTime() - daysAgo * 86_400_000).toISOString(),
});
const ok = (signalId: SignalId, events: SignalEvent[], metric?: SignalResult["metric"]): SignalResult => ({ signalId, status: "ok", costMicros: 10_000, listPriceMicros: 10_000, events, metric });

describe("recencyWeight", () => {
  it("halves after one half-life and counts undated events at half", () => {
    expect(recencyWeight(new Date(now.getTime() - 45 * 86_400_000).toISOString(), now, 45)).toBeCloseTo(0.5);
    expect(recencyWeight(now.toISOString(), now, 45)).toBe(1);
    expect(recencyWeight(null, now, 45)).toBe(0.5);
  });
});

describe("maxPointsOf", () => {
  it("scales enabled weights to 100 and gives disabled signals 0", () => {
    const m = maxPointsOf(cfg);
    expect(Object.values(m).reduce((a, b) => a + b, 0)).toBeCloseTo(100);
    const off = structuredClone(cfg);
    off.signals.traffic.enabled = false;
    const m2 = maxPointsOf(off);
    expect(m2.traffic).toBe(0);
    expect(Object.values(m2).reduce((a, b) => a + b, 0)).toBeCloseTo(100);
  });
});

describe("strengthOf", () => {
  const hiring = cfg.signals.hiring;
  it("saturates at the configured weighted event count", () => {
    const six = Array.from({ length: 6 }, () => ev("hiring", 0));
    expect(strengthOf(ok("hiring", six), hiring, now, undefined).strength).toBe(1);
    expect(strengthOf(ok("hiring", six.slice(0, 3)), hiring, now, undefined).strength).toBeCloseTo(0.5);
  });
  it("counts events that miss the ICP at 40%", () => {
    const s = strengthOf(ok("hiring", [ev("hiring", 0, false), ev("hiring", 0, false)]), hiring, now, undefined);
    expect(s.strength).toBeCloseTo((2 * 0.4) / 6);
    expect(s.summary).toContain("0 of 2");
  });
  it("gives a growth metric no points on the first run and scores the second against it", () => {
    const m = { name: "employees", value: 110, kind: "snapshot" as const };
    expect(strengthOf(ok("headcount", [ev("headcount", 0)], m), cfg.signals.headcount, now, undefined).strength).toBe(0);
    const s = strengthOf(ok("headcount", [ev("headcount", 0)], m), cfg.signals.headcount, now, { value: 100, at: "2026-10-03T00:00:00Z" });
    expect(s.strength).toBe(1);
    expect(s.summary).toContain("+10.0%");
  });
  it("never goes negative when a metric shrinks", () => {
    const m = { name: "employees", value: 80, kind: "snapshot" as const };
    expect(strengthOf(ok("headcount", [], m), cfg.signals.headcount, now, { value: 100, at: "2026-10-03T00:00:00Z" }).strength).toBe(0);
  });
  it("scores nothing for a pending, failed or skipped call and says why", () => {
    for (const status of ["pending", "failed", "skipped_cap", "skipped_price", "parse_error"] as const) {
      const s = strengthOf({ ...ok("hiring", []), status }, hiring, now, undefined);
      expect(s.strength).toBe(0);
      expect(s.summary.length).toBeGreaterThan(5);
    }
  });
});

describe("stageOf", () => {
  it("needs enough categories to call an account deciding", () => {
    expect(stageOf(90, 3, cfg)).toBe("deciding");
    expect(stageOf(90, 2, cfg)).toBe("considering");
    expect(stageOf(45, 5, cfg)).toBe("considering");
    expect(stageOf(20, 1, cfg)).toBe("aware");
    expect(stageOf(19, 9, cfg)).toBe("unaware");
  });
});

describe("scoreAccount", () => {
  it("adds points per signal, lists them with provider and cost, and is deterministic", () => {
    const results = [ok("hiring", Array.from({ length: 6 }, () => ev("hiring", 0))), ok("funding", [])];
    const a = scoreAccount("acme.com", results, cfg, now);
    const b = scoreAccount("acme.com", results, cfg, now);
    expect(a).toEqual(b);
    expect(a.score).toBe(Math.round(maxPointsOf(cfg).hiring));
    const line = a.breakdown.find((l) => l.signalId === "hiring")!;
    expect(line).toMatchObject({ provider: "predictleads", strength: 1, costMicros: 10_000 });
    expect(a.reasons[0]).toContain("predictleads");
    expect(a.costMicros).toBe(20_000);
  });
  it("sorts events newest first and counts pending calls", () => {
    const a = scoreAccount("acme.com", [ok("hiring", [ev("hiring", 10), ev("hiring", 1)]), { ...ok("news", []), status: "pending" }], cfg, now);
    expect(a.events[0].date! > a.events[1].date!).toBe(true);
    expect(a.pendingCount).toBe(1);
  });
});
