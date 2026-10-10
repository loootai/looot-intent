import type { IntentConfig } from "./config";
import { dateOf, findNumber, findObject, flat, isRec, rowsOf, str, type Rec } from "./read";
import type { Category, Parsed, SignalEvent, SignalId } from "./types";

export interface ParseContext {
  icp: IntentConfig["icp"];
  /** When the call ran. Used to date things a provider reports without a date. */
  now: Date;
}

export interface SignalDef {
  id: SignalId;
  category: Category;
  label: string;
  /** Short plural for the breakdown line, "open roles". */
  noun: string;
  provider: string;
  /** looot job id, kept as the catalog reference. */
  jobId: string;
  /** The pinned looot endpoint this app runs. */
  endpointId: string;
  /** Price per call in micro-dollars from the public catalog on PRICES_AS_OF. */
  fallbackMicros: number;
  /** false until someone has checked a real response body against the parser. */
  shapeVerified: boolean;
  buildInput(domain: string): Record<string, unknown>;
  parse(result: unknown, ctx: ParseContext): Parsed;
}

export const PRICES_AS_OF = "2026-10-10";

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** true when any term appears as a whole word or phrase in the text. Empty terms match everything. */
export function matchesAny(text: string, terms: string[]): boolean {
  const t = ` ${words(text)} `;
  const live = terms.map(words).filter(Boolean);
  if (live.length === 0) return true;
  return live.some((term) => t.includes(` ${term} `));
}

function event(def: Pick<SignalDef, "id" | "category" | "provider">, e: Omit<SignalEvent, "signalId" | "category" | "provider">): SignalEvent {
  return { signalId: def.id, category: def.category, provider: def.provider, ...e };
}

function clip(s: string | undefined, n = 140): string | undefined {
  if (!s) return undefined;
  return s.length > n ? `${s.slice(0, n - 1)}...` : s;
}

/** "acme.co.uk" becomes "acme". The LinkedIn ad search takes a company name, so this is a guess that works for most brands. */
export function companyNameOf(domain: string): string {
  return domain.replace(/^www\./, "").split(".")[0] ?? domain;
}

const HIRING = { id: "hiring", category: "hiring", provider: "predictleads" } as const;
const FUNDING = { id: "funding", category: "funding", provider: "predictleads" } as const;
const NEWS = { id: "news", category: "news", provider: "predictleads" } as const;
const TECH = { id: "tech", category: "tech", provider: "predictleads" } as const;
const SEO = { id: "seo", category: "seo", provider: "dataforseo" } as const;
const TRAFFIC = { id: "traffic", category: "traffic", provider: "datagma" } as const;
const ADS_G = { id: "ads_google", category: "ads", provider: "scrapecreators" } as const;
const ADS_L = { id: "ads_linkedin", category: "ads", provider: "scrapecreators" } as const;
const REDDIT = { id: "social_reddit", category: "social", provider: "scrapecreators" } as const;
const HEAD = { id: "headcount", category: "headcount", provider: "companyenrich" } as const;

/** Every signal the app can fetch. Job ids and prices come from the free looot catalog. */
export const SIGNALS: SignalDef[] = [
  {
    ...HIRING,
    label: "Hiring and job ads",
    noun: "open roles",
    jobId: "jobs.company",
    endpointId: "predictleads-companies-job-openings",
    fallbackMicros: 10_000,
    shapeVerified: false,
    buildInput: (domain) => ({ company_id_or_domain: domain, active_only: true, limit: 50 }),
    parse(result, ctx) {
      const events = rowsOf(result).map((raw) => {
        const r = flat(raw);
        const title = str(r, "title", "job_title") ?? "Job opening";
        return event(HIRING, {
          date: dateOf(r, "first_seen_at", "posted_at", "last_seen_at"),
          title,
          detail: clip([str(r, "location"), str(r, "seniority")].filter(Boolean).join(", ") || undefined),
          url: str(r, "url"),
          relevant: matchesAny(title, ctx.icp.jobTitleKeywords),
        });
      });
      return { events };
    },
  },
  {
    ...FUNDING,
    label: "Funding",
    noun: "financing events",
    jobId: "company.funding",
    endpointId: "predictleads-companies-financing-events",
    fallbackMicros: 10_000,
    shapeVerified: false,
    buildInput: (domain) => ({ company_id_or_domain: domain, limit: 20 }),
    parse(result) {
      const events = rowsOf(result).map((raw) => {
        const r = flat(raw);
        const kind = str(r, "financing_type_normalized", "financing_type", "category") ?? "Financing";
        const amount = findNumber(r, ["amount", "amount_usd"]);
        const title = amount ? `${kind.replace(/_/g, " ")}, ${compactUsd(amount)}` : kind.replace(/_/g, " ");
        return event(FUNDING, { date: dateOf(r, "effective_date", "found_at", "published_at"), title, detail: clip(str(r, "summary")), url: str(r, "url"), relevant: true });
      });
      return { events };
    },
  },
  {
    ...NEWS,
    label: "Company news",
    noun: "news events",
    jobId: "company.news",
    endpointId: "predictleads-companies-news-events",
    fallbackMicros: 10_000,
    shapeVerified: false,
    buildInput: (domain) => ({ company_id_or_domain: domain, limit: 25 }),
    parse(result, ctx) {
      const events = rowsOf(result).map((raw) => {
        const r = flat(raw);
        const category = str(r, "category") ?? "news";
        return event(NEWS, {
          date: dateOf(r, "found_at", "published_at"),
          title: clip(str(r, "summary", "title")) ?? category.replace(/_/g, " "),
          detail: category.replace(/_/g, " "),
          url: str(r, "url"),
          relevant: ctx.icp.newsCategories.length === 0 || ctx.icp.newsCategories.includes(category),
        });
      });
      return { events };
    },
  },
  {
    ...TECH,
    label: "Tech stack changes",
    noun: "technology detections",
    jobId: "company.technographics",
    endpointId: "predictleads-companies-technology-detections",
    fallbackMicros: 10_000,
    shapeVerified: false,
    buildInput: (domain) => ({ company_id_or_domain: domain, limit: 100 }),
    parse(result, ctx) {
      // JSON:API: the technology name sits in `included`, linked from each detection.
      const names = new Map<string, string>();
      if (isRec(result) && Array.isArray(result.included)) {
        for (const inc of result.included) {
          if (isRec(inc) && typeof inc.id === "string") {
            const n = str(flat(inc), "name");
            if (n) names.set(inc.id, n);
          }
        }
      }
      const events = rowsOf(result, ["data"]).map((raw) => {
        const r = flat(raw);
        const rel = isRec(raw.relationships) && isRec(raw.relationships.technology) && isRec(raw.relationships.technology.data) ? raw.relationships.technology.data : undefined;
        const name = (rel && typeof rel.id === "string" ? names.get(rel.id) : undefined) ?? str(r, "technology_name", "name") ?? "Technology";
        return event(TECH, { date: dateOf(r, "first_seen_at"), title: name, detail: "newly detected", relevant: matchesAny(name, ctx.icp.technologies) });
      });
      return { events };
    },
  },
  {
    ...SEO,
    label: "SEO movement",
    noun: "ranking changes",
    jobId: "keywords.domain.overview",
    endpointId: "dataforseo-dataforseo-labs-google-domain-rank-overview-live-ai",
    fallbackMicros: 12_000,
    shapeVerified: false,
    buildInput: (domain) => ({ target: domain, language_code: "en", location_name: "United States" }),
    parse(result, ctx) {
      // DataForSEO: metrics.organic has count, is_new, is_up, is_down, is_lost.
      const organic = findObject(result, ["count", "is_up", "is_down"]);
      if (!organic) return { events: [] };
      const num = (k: string) => (typeof organic[k] === "number" ? (organic[k] as number) : 0);
      const count = num("count");
      if (count <= 0) return { events: [] };
      const net = (num("is_new") + num("is_up") - num("is_down") - num("is_lost")) / count;
      const title = `${count.toLocaleString("en-US")} ranking keywords: ${num("is_up")} up, ${num("is_new")} new, ${num("is_down")} down, ${num("is_lost")} lost`;
      return { events: [event(SEO, { date: ctx.now.toISOString(), title, relevant: true })], metric: { name: "net keyword movement", value: net, kind: "direct" } };
    },
  },
  {
    ...TRAFFIC,
    label: "Web traffic",
    noun: "traffic readings",
    jobId: "company.traffic",
    endpointId: "datagma-website-traffic",
    fallbackMicros: 65_320,
    shapeVerified: false,
    buildInput: (domain) => ({ domain }),
    parse(result, ctx) {
      const visits = findNumber(result, ["visits", "monthlyVisits", "totalVisits", "estimatedMonthlyVisits", "monthly_visits"]);
      if (visits === undefined) return { events: [] };
      return { events: [event(TRAFFIC, { date: ctx.now.toISOString(), title: `${visits.toLocaleString("en-US")} monthly visits`, relevant: true })], metric: { name: "monthly visits", value: visits, kind: "snapshot" } };
    },
  },
  {
    ...ADS_G,
    label: "Google ads",
    noun: "ads running",
    jobId: "google.company.ads",
    endpointId: "scrapecreators-google-company-ads",
    fallbackMicros: 1_880,
    shapeVerified: false,
    buildInput: (domain) => ({ domain }),
    parse(result) {
      const events = rowsOf(result, ["ads", "data", "results"]).map((raw) => {
        const r = flat(raw);
        return event(ADS_G, { date: dateOf(r, "firstShown", "first_shown", "startDate", "start_date", "firstSeen"), title: `Google ${str(r, "format", "adFormat", "type") ?? "ad"}`, detail: clip(str(r, "headline", "title", "advertiserName")), url: str(r, "adUrl", "url"), relevant: true });
      });
      return { events };
    },
  },
  {
    ...ADS_L,
    label: "LinkedIn ads",
    noun: "ads running",
    jobId: "ads.linkedin.search",
    endpointId: "scrapecreators-linkedin-ads-search",
    fallbackMicros: 1_880,
    shapeVerified: false,
    // The endpoint searches by company name, not domain, so the name is the first label of the domain.
    buildInput: (domain) => ({ company: companyNameOf(domain) }),
    parse(result, ctx) {
      const events = rowsOf(result, ["ads", "data", "results"]).map((raw) => {
        const r = flat(raw);
        return event(ADS_L, { date: dateOf(r, "start_date", "startDate", "first_seen", "posted_at") ?? ctx.now.toISOString(), title: `LinkedIn ${str(r, "adType", "creative_type", "type") ?? "ad"}`, detail: clip(str(r, "headline", "description", "commentary")), url: str(r, "url", "adUrl"), relevant: true });
      });
      return { events };
    },
  },
  {
    ...REDDIT,
    label: "Reddit mentions",
    noun: "posts",
    jobId: "reddit.post.search",
    endpointId: "scrapecreators-reddit-search",
    fallbackMicros: 1_880,
    shapeVerified: false,
    buildInput: (domain) => ({ query: `"${domain}"`, sort: "new", timeframe: "month" }),
    parse(result) {
      const events = rowsOf(result, ["posts", "data", "results", "items"]).map((raw) => {
        const r = flat(raw);
        const sub = str(r, "subreddit");
        return event(REDDIT, { date: dateOf(r, "created_utc", "created_at", "createdAt", "created"), title: clip(str(r, "title")) ?? "Reddit post", detail: sub ? `r/${sub.replace(/^r\//, "")}` : undefined, url: str(r, "url", "permalink"), relevant: true });
      });
      return { events };
    },
  },
  {
    ...HEAD,
    label: "Headcount growth",
    noun: "headcount readings",
    jobId: "company.workforce",
    endpointId: "companyenrich-companies-workforce",
    fallbackMicros: 49_000,
    shapeVerified: false,
    buildInput: (domain) => ({ domain }),
    parse(result, ctx) {
      const n = findNumber(result, ["employeeCount", "employee_count", "observedEmployeeCount", "observed_employee_count", "employees", "headcount", "total"]);
      if (n === undefined) return { events: [] };
      return { events: [event(HEAD, { date: ctx.now.toISOString(), title: `${n.toLocaleString("en-US")} employees observed`, relevant: true })], metric: { name: "employees", value: n, kind: "snapshot" } };
    },
  },
];

export const SIGNAL_BY_ID: Record<SignalId, SignalDef> = Object.fromEntries(SIGNALS.map((s) => [s.id, s])) as Record<SignalId, SignalDef>;

/** Fallback prices keyed by endpoint id. */
export const FALLBACK_PRICES: Record<string, number> = Object.fromEntries(SIGNALS.map((s) => [s.endpointId, s.fallbackMicros]));

function compactUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}k`;
  return `$${n}`;
}

export type { Rec };
