export type Category = "hiring" | "funding" | "news" | "tech" | "seo" | "traffic" | "ads" | "social" | "headcount" | "intent";

export type SignalId = "hiring" | "funding" | "news" | "tech" | "seo" | "traffic" | "ads_google" | "ads_linkedin" | "social_reddit" | "headcount" | "intent_topics";

export type Stage = "unaware" | "aware" | "considering" | "deciding";

/** One thing a provider reported about an account: a job ad, a funding round, a news item, an ad. */
export interface SignalEvent {
  signalId: SignalId;
  category: Category;
  provider: string;
  /** ISO date the thing happened or was first seen. null when the provider gave none. */
  date: string | null;
  title: string;
  detail?: string;
  url?: string;
  /** true when the event matches the ICP (a job title, a technology, a news category). */
  relevant: boolean;
}

/** A single number a provider reported, for signals that need two readings to mean anything. */
export interface Metric {
  name: string;
  value: number;
  /**
   * "snapshot": a level (headcount, visits). It scores only against the reading from an earlier run.
   * "direct": a movement the provider already computed (keywords up minus keywords down). Scores right away.
   */
  kind: "snapshot" | "direct";
}

export interface Parsed {
  events: SignalEvent[];
  metric?: Metric;
}

export type CallStatus = "ok" | "failed" | "pending" | "skipped_cap" | "skipped_budget" | "skipped_price" | "parse_error";

/** What one provider call for one account produced. */
export interface SignalResult {
  signalId: SignalId;
  status: CallStatus;
  /** What looot charged. For a pending call this is 0 until the run finishes. */
  costMicros: number;
  listPriceMicros: number;
  runId?: string;
  errorCode?: string;
  message?: string;
  events: SignalEvent[];
  metric?: Metric;
}

/** One line of the score breakdown: a signal, who supplied it, its weight and its cost. */
export interface BreakdownLine {
  signalId: SignalId;
  category: Category;
  label: string;
  provider: string;
  endpointId: string;
  status: CallStatus;
  /** The most points this signal can add, from its weight. */
  maxPoints: number;
  /** 0 to 1: how much of the maxPoints the evidence earns. */
  strength: number;
  points: number;
  eventCount: number;
  costMicros: number;
  summary: string;
}

export interface AccountScore {
  domain: string;
  score: number;
  stage: Stage;
  /** Signals that returned data over signals enabled. */
  coverage: { withData: number; enabled: number };
  breakdown: BreakdownLine[];
  /** Plain sentences naming the signals behind the score, strongest first. */
  reasons: string[];
  events: SignalEvent[];
  costMicros: number;
  pendingCount: number;
}

export interface QuoteLine {
  signalId: SignalId;
  label: string;
  provider: string;
  jobId: string;
  endpointId: string;
  /** "call": one flat price per call. "result": the price is per result, and the app asks for one result at most. */
  unit: "call" | "result";
  calls: number;
  priceMicros: number;
  totalMicros: number;
}

export interface Quote {
  lines: QuoteLine[];
  accounts: number;
  perAccountMicros: number;
  totalMicros: number;
  priceSource: "catalog" | "fallback";
}

export interface Snapshot {
  value: number;
  at: string;
}

/** Last reading of each metric per account: domain, then signal id. */
export type Snapshots = Record<string, Partial<Record<SignalId, Snapshot>>>;

export interface RunResult {
  runId: string;
  startedAt: string;
  finishedAt: string;
  demo: boolean;
  icp: string;
  capMicros: number;
  quotedMicros: number;
  spentMicros: number;
  /** Calls skipped because the cap would have been passed. */
  skippedByCap: number;
  /** Calls not made because the period budget would have been passed. */
  skippedByBudget?: number;
  /** The refusal text when the period budget stopped a call. */
  budgetMessage?: string | null;
  /** Calls that were still running when waiting stopped. They are not failures. */
  pendingCalls: number;
  failedCalls: number;
  aborted: string | null;
  quote: Quote;
  accounts: AccountScore[];
}
