import type { Runner } from "./looot";
import type { Snapshots } from "./types";

/** The clock demo data is relative to, so screenshots and tests do not drift. */
export const DEMO_NOW = new Date("2026-10-10T09:00:00.000Z");

interface Profile {
  domain: string;
  /** 0..1 how much hiring for ICP roles. */
  hiring: number;
  /** Days since a financing event, or null. */
  fundedDaysAgo: number | null;
  news: number;
  /** Technologies and days since first detected. */
  tech: [string, number][];
  /** Net share of ranking keywords moving up. Negative for a decline. */
  seoNet: number;
  trafficBase: number;
  trafficGrowth: number;
  adsGoogle: number;
  adsLinkedin: number;
  reddit: number;
  headcountBase: number;
  headcountGrowth: number;
}

const PROFILES: Profile[] = [
  { domain: "northbeam-labs.example", hiring: 1, fundedDaysAgo: 21, news: 1, tech: [["HubSpot", 30], ["Segment", 55], ["Snowflake", 400]], seoNet: 0.3, trafficBase: 210_000, trafficGrowth: 0.24, adsGoogle: 6, adsLinkedin: 5, reddit: 4, headcountBase: 180, headcountGrowth: 0.12 },
  { domain: "quillstack.example", hiring: 0.8, fundedDaysAgo: 48, news: 0.7, tech: [["Salesforce", 40], ["Outreach", 70]], seoNet: 0.18, trafficBase: 95_000, trafficGrowth: 0.15, adsGoogle: 3, adsLinkedin: 4, reddit: 2, headcountBase: 120, headcountGrowth: 0.09 },
  { domain: "ledgerly.example", hiring: 0.6, fundedDaysAgo: 140, news: 0.5, tech: [["HubSpot", 90]], seoNet: 0.1, trafficBase: 64_000, trafficGrowth: 0.11, adsGoogle: 2, adsLinkedin: 1, reddit: 1, headcountBase: 85, headcountGrowth: 0.06 },
  { domain: "tandemworks.example", hiring: 0.5, fundedDaysAgo: null, news: 0.4, tech: [["Salesloft", 35]], seoNet: 0.05, trafficBase: 40_000, trafficGrowth: 0.2, adsGoogle: 0, adsLinkedin: 3, reddit: 0, headcountBase: 210, headcountGrowth: 0.04 },
  { domain: "fieldnote.example", hiring: 0.35, fundedDaysAgo: 220, news: 0.3, tech: [["Segment", 200]], seoNet: 0.12, trafficBase: 128_000, trafficGrowth: 0.03, adsGoogle: 4, adsLinkedin: 0, reddit: 3, headcountBase: 60, headcountGrowth: 0.02 },
  { domain: "paperkite.example", hiring: 0.25, fundedDaysAgo: null, news: 0.4, tech: [["Salesforce", 300]], seoNet: -0.04, trafficBase: 33_000, trafficGrowth: 0.01, adsGoogle: 1, adsLinkedin: 1, reddit: 1, headcountBase: 140, headcountGrowth: 0.03 },
  { domain: "meridian-forge.example", hiring: 0.2, fundedDaysAgo: 330, news: 0.1, tech: [], seoNet: 0.02, trafficBase: 18_000, trafficGrowth: -0.02, adsGoogle: 0, adsLinkedin: 0, reddit: 0, headcountBase: 310, headcountGrowth: 0 },
  { domain: "oakhollow.example", hiring: 0.1, fundedDaysAgo: null, news: 0, tech: [["HubSpot", 500]], seoNet: -0.1, trafficBase: 52_000, trafficGrowth: -0.08, adsGoogle: 0, adsLinkedin: 0, reddit: 0, headcountBase: 75, headcountGrowth: -0.03 },
  { domain: "brightharbor.example", hiring: 0.1, fundedDaysAgo: null, news: 0.1, tech: [], seoNet: 0, trafficBase: 9_000, trafficGrowth: 0, adsGoogle: 0, adsLinkedin: 0, reddit: 0, headcountBase: 30, headcountGrowth: 0 },
  { domain: "stonebridge-co.example", hiring: 0, fundedDaysAgo: null, news: 0, tech: [], seoNet: -0.2, trafficBase: 22_000, trafficGrowth: -0.15, adsGoogle: 0, adsLinkedin: 0, reddit: 0, headcountBase: 450, headcountGrowth: -0.06 },
];

/** The domains the demo scores, in file order. */
export const DEMO_DOMAINS = PROFILES.map((p) => p.domain);

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(DEMO_NOW.getTime() - n * DAY).toISOString();

const ROLES_RELEVANT = ["Account Executive, Mid-Market", "Sales Development Representative", "Head of Revenue Operations", "Demand Generation Manager", "Growth Marketing Lead", "Senior Account Executive", "VP Sales", "Marketing Operations Manager", "SDR Team Lead", "Director of Growth"];
const ROLES_OTHER = ["Office Manager", "Facilities Coordinator", "Warehouse Associate", "Legal Counsel"];
const NEWS_CATS = ["receives_financing", "launches", "hires", "expands_offices_in", "partners_with", "increases_headcount_by", "signs_new_client", "has_issues_with"];

/** Provider-shaped response bodies built from the profile. Shapes follow each provider's documented response. */
function bodyFor(endpointId: string, p: Profile): unknown {
  switch (endpointId) {
    case "predictleads-companies-job-openings": {
      const n = Math.round(p.hiring * 12);
      const other = p.hiring < 0.3 ? 2 : 1;
      return {
        data: [
          ...Array.from({ length: n }, (_, i) => ({ id: `jo_${i}`, type: "job_opening", attributes: { title: ROLES_RELEVANT[i % ROLES_RELEVANT.length], url: `https://${p.domain}/careers/${i}`, first_seen_at: daysAgo(1 + i * 2.5), last_seen_at: daysAgo(0), location: "Remote, US" } })),
          ...Array.from({ length: other }, (_, i) => ({ id: `jx_${i}`, type: "job_opening", attributes: { title: ROLES_OTHER[i % ROLES_OTHER.length], first_seen_at: daysAgo(20 + i * 9), last_seen_at: daysAgo(2) } })),
        ],
        meta: { count: n + other },
      };
    }
    case "predictleads-companies-financing-events":
      return { data: p.fundedDaysAgo === null ? [] : [{ id: "fe_1", type: "financing_event", attributes: { category: "receives_financing", financing_type_normalized: "series_b", amount: 28_000_000 - p.fundedDaysAgo * 20_000, effective_date: daysAgo(p.fundedDaysAgo).slice(0, 10), found_at: daysAgo(p.fundedDaysAgo - 2), summary: `${p.domain} raised a growth round.` } }] };
    case "predictleads-companies-news-events":
      return { data: Array.from({ length: Math.round(p.news * 6) }, (_, i) => ({ id: `ne_${i}`, type: "news_event", attributes: { category: NEWS_CATS[i % (p.news > 0.5 ? 7 : 8)], summary: `Company announcement ${i + 1}`, found_at: daysAgo(3 + i * 6), url: `https://news.example/${p.domain}/${i}` } })) };
    case "predictleads-companies-technology-detections":
      return {
        data: p.tech.map(([, days], i) => ({ id: `td_${i}`, type: "technology_detection", attributes: { first_seen_at: daysAgo(days), last_seen_at: daysAgo(0) }, relationships: { technology: { data: { id: `t_${i}`, type: "technology" } } } })),
        included: p.tech.map(([name], i) => ({ id: `t_${i}`, type: "technology", attributes: { name } })),
      };
    case "dataforseo-dataforseo-labs-google-domain-rank-overview-live-ai": {
      const count = 1400;
      const up = Math.round(count * Math.max(0.05, 0.12 + p.seoNet / 2));
      const down = Math.round(count * Math.max(0.03, 0.12 - p.seoNet / 2));
      return { tasks: [{ result: [{ target: p.domain, items: [{ se_type: "google", metrics: { organic: { count, etv: p.trafficBase * 0.4, is_new: Math.round(count * 0.04), is_up: up, is_down: down, is_lost: Math.round(count * 0.02) } } }] }] }] };
    }
    case "datagma-website-traffic":
      return { siteOverview: { visits: Math.round(p.trafficBase * (1 + p.trafficGrowth)), globalRank: 120_000 } };
    case "scrapecreators-google-company-ads":
      return { ads: Array.from({ length: p.adsGoogle }, (_, i) => ({ creativeId: `cr_${i}`, format: i % 2 ? "video" : "text", firstShown: daysAgo(2 + i * 6), headline: `Ad copy ${i + 1}` })) };
    case "adyntel-linkedin":
      return { ads: Array.from({ length: p.adsLinkedin }, (_, i) => ({ ad_id: `li_${i}`, advertiser: p.domain, creative_type: "single_image", commentary: `Sponsored post ${i + 1}`, start_date: daysAgo(3 + i * 7) })) };
    case "scrapecreators-reddit-search":
      return { posts: Array.from({ length: p.reddit }, (_, i) => ({ title: `Anyone using ${p.domain.split(".")[0]}?`, subreddit: i % 2 ? "sales" : "saas", created_utc: Math.floor((DEMO_NOW.getTime() - (2 + i * 5) * DAY) / 1000), url: `https://reddit.example/${i}` })) };
    case "companyenrich-companies-workforce":
      return { observedEmployeeCount: Math.round(p.headcountBase * (1 + p.headcountGrowth)), employeeRange: "51-200", departments: [{ name: "Sales", count: 20 }] };
    default:
      return { data: [] };
  }
}

/** Stands in for looot in demo mode. It plays recorded-shape fixtures and makes no network call. */
export function demoRunner(): Runner {
  const byDomain = new Map(PROFILES.map((p) => [p.domain, p]));
  return {
    async runAndWait(endpointId, input, idempotencyKey) {
      const raw = String(input.company_id_or_domain ?? input.target ?? input.domain ?? input.company_domain ?? String(input.query ?? "").replace(/"/g, ""));
      const p = byDomain.get(raw);
      // A domain outside the sample set has no recorded signals.
      return { runId: `demo_${idempotencyKey.split(":").slice(2, 4).join("_")}`, status: "completed", result: p ? bodyFor(endpointId, p) : { data: [] }, actualCost: 0 };
    },
  };
}

/** Readings from "last week", so growth signals score in the demo. */
export function demoSnapshots(): Snapshots {
  const out: Snapshots = {};
  for (const p of PROFILES) {
    out[p.domain] = {
      headcount: { value: p.headcountBase, at: daysAgo(7) },
      traffic: { value: p.trafficBase, at: daysAgo(7) },
    };
  }
  return out;
}

export const DEMO_ICP = "B2B SaaS companies with 50 to 500 employees that sell to sales and marketing teams and are growing their go-to-market team.";
