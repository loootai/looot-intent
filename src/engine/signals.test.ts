import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";
import { SIGNAL_BY_ID, SIGNALS, companyNameOf, matchesAny } from "./signals";

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
    expect(SIGNAL_BY_ID.ads_linkedin.buildInput("acme.com")).toEqual({ company: "acme" });
    expect(SIGNAL_BY_ID.ads_google.buildInput("acme.com")).toEqual({ domain: "acme.com" });
  });
});

describe("LinkedIn ads signal", () => {
  it("runs the live scrapecreators endpoint at its catalog price", () => {
    expect(SIGNAL_BY_ID.ads_linkedin.endpointId).toBe("scrapecreators-linkedin-ads-search");
    expect(SIGNAL_BY_ID.ads_linkedin.fallbackMicros).toBe(1_880);
  });
  it("takes the company name from the first label of the domain", () => {
    expect(companyNameOf("www.acme.co.uk")).toBe("acme");
    expect(companyNameOf("acme.com")).toBe("acme");
  });
  it("reads adType, headline and startDate from the documented ad fields", () => {
    const parsed = SIGNAL_BY_ID.ads_linkedin.parse({ ads: [{ id: "1", adType: "video", headline: "Hello", startDate: "2026-10-01" }] }, ctx);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0]).toMatchObject({ title: "LinkedIn video", detail: "Hello", date: "2026-10-01T00:00:00.000Z" });
  });
});

describe("third-party buying intent signal", () => {
  const def = SIGNAL_BY_ID.intent_topics;
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "theirstackBuyingIntents.json"), "utf8"));
  it("runs the TheirStack endpoint at the catalog price per result and asks for one result", () => {
    expect(def).toMatchObject({ endpointId: "theirstack-companies-buying-intents", jobId: "companies.buying-intents", provider: "theirstack", fallbackMicros: 98_100, priceUnit: "result", shapeVerified: false });
    expect(def.buildInput("Acme.com")).toEqual({ company_domain: "Acme.com", limit: 1 });
  });
  it("reads topics, confidence, job counts and dates from the fixture", () => {
    const { events } = def.parse(fixture, ctx);
    expect(events.map((e) => e.title)).toEqual(["Revenue intelligence", "Sales engagement", "Data warehouse"]);
    expect(events[0]).toMatchObject({ signalId: "intent_topics", category: "intent", provider: "theirstack", date: "2026-10-06T00:00:00.000Z", relevant: true });
    expect(events[0].detail).toContain("high confidence");
    expect(events[0].detail).toContain("9 job posts");
    expect(events.map((e) => e.relevant)).toEqual([true, true, false]);
  });
  it("accepts a flat list of topics and returns nothing for an empty or odd body", () => {
    const flat = { data: [{ name: "Cloud migration", confidence: "high", num_jobs: 3, last_date_found: "2026-10-01" }] };
    expect(def.parse(flat, ctx).events[0]).toMatchObject({ title: "Cloud migration", relevant: true });
    expect(def.parse({ data: [] }, ctx).events).toEqual([]);
    expect(def.parse("<html>", ctx).events).toEqual([]);
  });
  it("has its own weight in the config", () => {
    expect(cfg.signals.intent_topics.weight).toBeGreaterThan(0);
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
