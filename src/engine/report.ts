import { ago } from "./score";
import { usd, usdPrecise } from "./money";
import type { AccountScore, RunResult } from "./types";

const q = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One row per account: rank, score, stage, coverage, cost, reasons. */
export function toCsv(run: RunResult): string {
  const head = ["rank", "domain", "score", "stage", "signals_with_data", "signals_enabled", "cost_usd", "top_reasons"];
  const rows = run.accounts.map((a, i) => [i + 1, a.domain, a.score, a.stage, a.coverage.withData, a.coverage.enabled, (a.costMicros / 1e6).toFixed(5), a.reasons.join(" | ")]);
  return [head, ...rows].map((r) => r.map(q).join(",")).join("\n") + "\n";
}

/** A markdown report: ranking table, then one section per account with its score breakdown. */
export function toMarkdown(run: RunResult): string {
  const lines: string[] = [];
  lines.push(`# Account intent report`, "");
  lines.push(`Run ${run.runId}${run.demo ? " (demo data, no looot calls)" : ""}. ${run.accounts.length} accounts. Quoted ${usd(run.quotedMicros)} at list price, spent ${usd(run.spentMicros)}, cap ${usd(run.capMicros)}.`);
  if (run.pendingCalls) lines.push("", `${run.pendingCalls} calls were still running at the provider when waiting stopped. They are pending, not failed. Run again in the same window to collect them without a second charge.`);
  if (run.skippedByBudget) lines.push("", `${run.skippedByBudget} calls were skipped because the period budget would have been passed.`);
  if (run.skippedByCap) lines.push("", `${run.skippedByCap} calls were skipped because the spend cap would have been passed.`);
  if (run.aborted) lines.push("", run.aborted);
  lines.push("", `ICP: ${run.icp}`, "");
  lines.push("| Rank | Account | Score | Stage | Signals | Cost |", "| --- | --- | --- | --- | --- | --- |");
  run.accounts.forEach((a, i) => lines.push(`| ${i + 1} | ${a.domain} | ${a.score} | ${a.stage} | ${a.coverage.withData}/${a.coverage.enabled} | ${usd(a.costMicros)} |`));
  for (const a of run.accounts) lines.push("", ...accountSection(a, new Date(run.finishedAt)));
  return lines.join("\n") + "\n";
}

function accountSection(a: AccountScore, now: Date): string[] {
  const out = [`## ${a.domain}: ${a.score}, ${a.stage}`, ""];
  out.push("| Signal | Provider | Points | Max | Cost | Evidence |", "| --- | --- | --- | --- | --- | --- |");
  for (const b of a.breakdown) out.push(`| ${b.label} | ${b.provider} | ${b.points.toFixed(1)} | ${b.maxPoints.toFixed(1)} | ${usdPrecise(b.costMicros)} | ${b.summary} |`);
  const recent = a.events.filter((e) => e.date).slice(0, 5);
  if (recent.length) {
    out.push("", "Latest events:");
    for (const e of recent) out.push(`- ${ago(e.date, now)}: ${e.title} (${e.provider})`);
  }
  return out;
}

/** The JSON a script or an agent reads. */
export function toJson(run: RunResult): string {
  return JSON.stringify(run, null, 2) + "\n";
}
