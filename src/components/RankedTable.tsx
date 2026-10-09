"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usd } from "@/engine/money";
import type { AccountScore, Stage } from "@/engine/types";
import { cn } from "@/lib/cn";
import { Bar, StageChip } from "./chips";

const STAGES: Stage[] = ["deciding", "considering", "aware", "unaware"];

/** Accounts ranked by score, filterable by buying stage. */
export function RankedTable({ accounts }: { accounts: AccountScore[] }) {
  const [stage, setStage] = useState<Stage | "all">("all");
  const counts = useMemo(() => Object.fromEntries(STAGES.map((s) => [s, accounts.filter((a) => a.stage === s).length])) as Record<Stage, number>, [accounts]);
  const rows = accounts.map((a, i) => ({ a, rank: i + 1 })).filter((r) => stage === "all" || r.a.stage === stage);
  return (
    <section aria-label="Ranked accounts">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-16 font-medium">Ranked accounts</h2>
        {(["all", ...STAGES] as const).map((s) => (
          <button key={s} type="button" onClick={() => setStage(s)} aria-pressed={stage === s} className={cn("rounded-full border px-2.5 py-0.5 text-12 capitalize", stage === s ? "border-brand bg-brand text-brand-ink" : "border-line-strong text-mute hover:bg-hover")}>
            {s}{s !== "all" && <span className="num ml-1 opacity-70">{counts[s]}</span>}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-panel border border-line bg-panel">
        <table className="w-full min-w-[760px] text-left text-13">
          <thead className="border-b border-line text-12 text-mute">
            <tr>
              <th className="w-12 px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Account</th>
              <th className="w-44 px-3 py-2 font-medium">Score</th>
              <th className="px-3 py-2 font-medium">Stage</th>
              <th className="px-3 py-2 font-medium">Strongest signal</th>
              <th className="px-3 py-2 text-right font-medium">Signals</th>
              <th className="px-3 py-2 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ a, rank }) => {
              const top = [...a.breakdown].sort((x, y) => y.points - x.points)[0];
              return (
                <tr key={a.domain} className="border-t border-line hover:bg-hover">
                  <td className="num px-3 py-2 text-mute">{rank}</td>
                  <td className="px-3 py-2"><Link href={`/accounts/${encodeURIComponent(a.domain)}`} className="font-medium text-link hover:underline">{a.domain}</Link></td>
                  <td className="px-3 py-2"><div className="flex items-center gap-2"><span className="num w-8 text-right font-medium">{a.score}</span><Bar value={a.score} max={100} /></div></td>
                  <td className="px-3 py-2"><StageChip stage={a.stage} /></td>
                  <td className="max-w-[260px] truncate px-3 py-2 text-mute" title={top?.points > 0 ? `${top.label}: ${top.summary}` : undefined}>{top && top.points > 0 ? `${top.label}, ${top.points.toFixed(1)} pts` : "None"}</td>
                  <td className="num px-3 py-2 text-right text-mute">{a.coverage.withData}/{a.coverage.enabled}</td>
                  <td className="num px-3 py-2 text-right text-mute">{usd(a.costMicros)}</td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-mute">No accounts in this stage.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
