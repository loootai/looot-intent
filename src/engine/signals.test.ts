import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";
import { SIGNAL_BY_ID, SIGNALS, matchesAny } from "./signals";

const cfg = loadConfig();
const ctx = { icp: cfg.icp, now: new Date("2026-10-10T09:00:00Z") };

describe("signal catalog", () => {
  it("has one pinned endpoint and a positive price for every signal", () => {
    expect(new Set(SIGNALS.map((s) => s.id)).size).toBe(SIGNALS.length);
    for (const s of SIGNALS) {
      expect(s.endpointId).toMatch(/^[a-z0-9-]+$/);
      expect(s.fallbackMicros).toBeGreaterThan(0);
    }
  });
  it("sends the domain under the field name each provider documents", () => {
    expect(SIGNAL_BY_ID.hiring.buildInput("acme.com")).toMatchObject({ company_id_or_domain: "acme.com" });
    expect(SIGNAL_BY_ID.seo.buildInput("acme.com")).toMatchObject({ target: "acme.com" });
    expect(SIGNAL_BY_ID.ads_linkedin.buildInput("acme.com")).toMatchObject({ company_domain: "acme.com" });
    expect(SIGNAL_BY_ID.ads_google.buildInput("acme.com")).toEqual({ domain: "acme.com" });
  });
});

describe("matchesAny", () => {
  it("matches whole words only and treats an empty list as match-all", () => {
    expect(matchesAny("Senior Account Executive", ["account executive"])).toBe(true);
    expect(matchesAny("Salesforce Admin", ["sales"])).toBe(false);
    expect(matchesAny("Anything", [])).toBe(true);
  });
});

describe("parsers", () => {
  it("reads PredictLeads job openings and flags the ICP roles", () => {
    const body = { data: [{ attributes: { title: "SDR Team Lead", first_seen_at: "2026-10-01T00:00:00Z", url: "https://x/1" } }, { attributes: { title: "Office Manager", first_seen_at: "2026-09-01T00:00:00Z" } }] };
    const { events } = SIGNAL_BY_ID.hiring.parse(body, ctx);
    expect(events.map((e) => e.relevant)).toEqual([true, false]);
    expect(events[0]).toMatchObject({ signalId: "hiring", provider: "predictleads", date: "2026-10-01T00:00:00.000Z", url: "https://x/1" });
  });
  it("reads the technology name from the JSON:API included block", () => {
    const body = { data: [{ attributes: { first_seen_at: "2026-09-20T00:00:00Z" }, relationships: { technology: { data: { id: "t1" } } } }], included: [{ id: "t1", attributes: { name: "HubSpot" } }] };
    const { events } = SIGNAL_BY_ID.tech.parse(body, ctx);
    expect(events[0].title).toBe("HubSpot");
    expect(events[0].relevant).toBe(true);
  });
  it("reads a financing event with its amount", () => {
    const body = { data: [{ attributes: { financing_type_normalized: "series_b", amount: 28_000_000, effective_date: "2026-09-01" } }] };
    expect(SIGNAL_BY_ID.funding.parse(body, ctx).events[0].title).toBe("series b, $28.0M");
  });
  it("finds the DataForSEO organic block anywhere in the body and computes net movement", () => {
    const body = { tasks: [{ result: [{ items: [{ metrics: { organic: { count: 100, is_new: 10, is_up: 30, is_down: 10, is_lost: 5 } } }] }] }] };
    const parsed = SIGNAL_BY_ID.seo.parse(body, ctx);
    expect(parsed.metric).toEqual({ name: "net keyword movement", value: 0.25, kind: "direct" });
  });
  it("reads traffic and headcount as snapshot metrics", () => {
    expect(SIGNAL_BY_ID.traffic.parse({ siteOverview: { visits: 5000 } }, ctx).metric).toMatchObject({ value: 5000, kind: "snapshot" });
    expect(SIGNAL_BY_ID.headcount.parse({ observedEmployeeCount: 210 }, ctx).metric).toMatchObject({ value: 210, kind: "snapshot" });
  });
  it("converts Reddit epoch seconds to ISO dates", () => {
    const { events } = SIGNAL_BY_ID.social_reddit.parse({ posts: [{ title: "t", subreddit: "sales", created_utc: 1_790_000_000 }] }, ctx);
    expect(events[0].date).toBe(new Date(1_790_000_000_000).toISOString());
    expect(events[0].detail).toBe("r/sales");
  });
  it("returns nothing for bodies it does not recognise", () => {
    for (const s of SIGNALS) expect(s.parse({ unexpected: true }, ctx).events).toEqual([]);
    for (const s of SIGNALS) expect(s.parse(null, ctx).events).toEqual([]);
  });
});
