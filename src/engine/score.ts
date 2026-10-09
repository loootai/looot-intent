import type { IntentConfig } from "./config";
import { SIGNAL_BY_ID } from "./signals";
import type { AccountScore, BreakdownLine, Category, SignalEvent, SignalId, SignalResult, Snapshot, Stage } from "./types";

const DAY = 86_400_000;

/** How much an event still counts: 1 today, 0.5 after one half-life. Undated events count 0.5. */
export function recencyWeight(date: string | null, now: Date, halfLifeDays: number): number {
  if (!date) return 0.5;
  const ageDays = Math.max(0, (now.getTime() - Date.parse(date)) / DAY);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

/** Events that do not match the ICP still count, at this share. */
export const UNRELEVANT_SHARE = 0.4;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** "3 days ago", "today". */
export function ago(date: string | null, now: Date): string {
  if (!date) return "undated";
  const d = Math.floor((now.getTime() - Date.parse(date)) / DAY);
  if (d <= 0) return "today";
  if (d === 1) return "1 day ago";
  if (d < 60) return `${d} days ago`;
  return `${Math.round(d / 30)} months ago`;
}

export interface SignalStrength {
  strength: number;
  summary: string;
}

/** Turns one signal's result into a 0..1 strength and a one-line summary. Pure. */
export function strengthOf(result: SignalResult, cfg: IntentConfig["signals"][SignalId], now: Date, prior: Snapshot | undefined): SignalStrength {
  const def = SIGNAL_BY_ID[result.signalId];
  if (result.status === "pending") return { strength: 0, summary: "Still running at the provider. Re-run to collect it, the call is not charged twice." };
  if (result.status === "skipped_cap") return { strength: 0, summary: "Skipped: the spend cap would have been passed." };
  if (result.status === "skipped_price") return { strength: 0, summary: "Skipped: the live price could not be read." };
  if (result.status === "failed") return { strength: 0, summary: `Failed${result.errorCode ? ` (${result.errorCode})` : ""}. Not charged.` };
  if (result.status === "parse_error") return { strength: 0, summary: "The response did not match the expected shape." };

  const m = result.metric;
  if (m?.kind === "direct") {
    const s = clamp01(m.value / cfg.saturation);
    return { strength: s, summary: `${result.events[0]?.title ?? m.name}. Net movement ${(m.value * 100).toFixed(0)}% of ranking keywords.` };
  }
  if (m?.kind === "snapshot") {
    if (!prior) return { strength: 0, summary: `${result.events[0]?.title ?? m.name}. Baseline recorded, growth needs a second run.` };
    const growth = prior.value > 0 ? (m.value - prior.value) / prior.value : 0;
    const pct = `${growth >= 0 ? "+" : ""}${(growth * 100).toFixed(1)}%`;
    return { strength: clamp01(growth / cfg.saturation), summary: `${m.name} ${prior.value.toLocaleString("en-US")} to ${m.value.toLocaleString("en-US")} (${pct}) since ${prior.at.slice(0, 10)}.` };
  }

  if (result.events.length === 0) return { strength: 0, summary: `No ${def.noun} found.` };
  let sum = 0;
  let relevant = 0;
  let newest: string | null = null;
  for (const e of result.events) {
    sum += recencyWeight(e.date, now, cfg.halfLifeDays) * (e.relevant ? 1 : UNRELEVANT_SHARE);
    if (e.relevant) relevant += 1;
    if (e.date && (!newest || e.date > newest)) newest = e.date;
  }
  const n = result.events.length;
  const noun = n === 1 ? def.noun.replace(/s$/, "") : def.noun;
  const matched = relevant < n ? `${relevant} of ${n} ${def.noun} match the ICP` : `${n} ${noun}`;
  return { strength: clamp01(sum / cfg.saturation), summary: `${matched}, newest ${ago(newest, now)}.` };
}

/** Maps a score and the categories showing signal to a buying stage. */
export function stageOf(score: number, activeCategories: number, cfg: IntentConfig): Stage {
  const s = cfg.stages;
  if (score >= s.deciding && activeCategories >= s.decidingMinCategories) return "deciding";
  if (score >= s.considering) return "considering";
  if (score >= s.aware) return "aware";
  return "unaware";
}

/** Points a signal can add at most: its weight scaled so the enabled weights add up to 100. */
export function maxPointsOf(cfg: IntentConfig): Record<SignalId, number> {
  const entries = Object.entries(cfg.signals) as [SignalId, IntentConfig["signals"][SignalId]][];
  const total = entries.filter(([, c]) => c.enabled).reduce((n, [, c]) => n + c.weight, 0);
  return Object.fromEntries(entries.map(([id, c]) => [id, c.enabled && total > 0 ? (100 * c.weight) / total : 0])) as Record<SignalId, number>;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Scores one account from the results of its signal calls. Pure: same input, same score. */
export function scoreAccount(domain: string, results: SignalResult[], cfg: IntentConfig, now: Date, prior: Partial<Record<SignalId, Snapshot>> = {}): AccountScore {
  const max = maxPointsOf(cfg);
  const breakdown: BreakdownLine[] = results.map((r) => {
    const def = SIGNAL_BY_ID[r.signalId];
    const { strength, summary } = strengthOf(r, cfg.signals[r.signalId], now, prior[r.signalId]);
    return {
      signalId: r.signalId,
      category: def.category,
      label: def.label,
      provider: def.provider,
      endpointId: def.endpointId,
      status: r.status,
      maxPoints: round1(max[r.signalId]),
      strength: Math.round(strength * 100) / 100,
      points: round1(max[r.signalId] * strength),
      eventCount: r.events.length,
      costMicros: r.costMicros,
      summary,
    };
  });
  const raw = breakdown.reduce((n, b) => n + b.maxPoints * b.strength, 0);
  const score = Math.round(Math.min(100, raw));
  const active = new Set<Category>(breakdown.filter((b) => b.strength >= cfg.activeStrength).map((b) => b.category));
  const withData = results.filter((r) => r.status === "ok" && (r.events.length > 0 || r.metric)).length;
  const events: SignalEvent[] = results.flatMap((r) => r.events).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const reasons = [...breakdown]
    .filter((b) => b.points >= 1)
    .sort((a, b) => b.points - a.points)
    .slice(0, 4)
    .map((b) => `${b.label}: ${b.summary} +${b.points.toFixed(1)} of ${b.maxPoints.toFixed(1)} points (${b.provider}).`);
  return {
    domain,
    score,
    stage: stageOf(score, active.size, cfg),
    coverage: { withData, enabled: results.length },
    breakdown,
    reasons: reasons.length ? reasons : ["No signal found in the enabled sources."],
    events,
    costMicros: results.reduce((n, r) => n + r.costMicros, 0),
    pendingCount: results.filter((r) => r.status === "pending").length,
  };
}
