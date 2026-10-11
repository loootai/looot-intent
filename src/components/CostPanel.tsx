import { usd, usdPrecise } from "@/engine/money";
import type { RunResult, SignalId } from "@/engine/types";
import { Bar, StatusChip } from "./chips";

/** What the run cost: quote against spend and cap, and the spend per signal and provider. */
export function CostPanel({ run }: { run: RunResult }) {
  const per = new Map<SignalId, { cost: number; ok: number; pending: number; failed: number; skipped: number; unavailable: number }>();
  for (const a of run.accounts) {
    for (const b of a.breakdown) {
      const x = per.get(b.signalId) ?? { cost: 0, ok: 0, pending: 0, failed: 0, skipped: 0, unavailable: 0 };
      x.cost += b.costMicros;
      if (b.status === "ok") x.ok += 1;
      else if (b.status === "pending") x.pending += 1;
      else if (b.status === "skipped_price") x.unavailable += 1;
      else if (b.status === "skipped_cap") x.skipped += 1;
      else x.failed += 1;
      per.set(b.signalId, x);
    }
  }
  return (
    <section aria-label="Cost" className="rounded-panel border border-line bg-panel p-4">
      <h2 className="text-16 font-medium">Cost</h2>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Quoted at list price", usd(run.quotedMicros)],
          ["Spent", usd(run.spentMicros)],
          ["Spend cap", usd(run.capMicros)],
          ["Per account", usdPrecise(run.quote.perAccountMicros)],
        ].map(([k, v]) => (
          <div key={k}><dt className="text-12 text-mute">{k}</dt><dd className="num text-20 font-medium">{v}</dd></div>
        ))}
      </dl>
      <div className="mt-3"><Bar value={run.spentMicros} max={run.capMicros} /></div>
      <p className="mt-2 text-12 text-mute">
        {run.demo ? "Demo data. No looot call was made, so the spend is zero. The quote is what the same run costs live." : "Spend is what looot charged. A failed call costs nothing."}
        {run.pendingCalls > 0 && ` ${run.pendingCalls} calls are still running at the provider. They are pending, not failed. Run again in the same week to collect them without a second charge.`}
        {run.skippedByCap > 0 && ` ${run.skippedByCap} calls were skipped because the cap would have been passed.`}
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-12">
          <thead className="text-mute"><tr><th className="py-1 pr-3 font-medium">Signal</th><th className="py-1 pr-3 font-medium">Provider</th><th className="py-1 pr-3 text-right font-medium">List price</th><th className="py-1 pr-3 text-right font-medium">Calls ok</th><th className="py-1 pr-3 font-medium">Other</th><th className="py-1 text-right font-medium">Spent</th></tr></thead>
          <tbody>
            {run.quote.lines.map((l) => {
              const x = per.get(l.signalId);
              return (
                <tr key={l.signalId} className="border-t border-line">
                  <td className="py-1 pr-3">{l.label}</td><td className="py-1 pr-3 text-mute">{l.provider}</td>
                  <td className="num py-1 pr-3 text-right">{usdPrecise(l.priceMicros)}{l.unit === "result" && <span className="text-faint" title="Priced per result. The app asks for 1 result per account, so this is the most one account costs."> /result</span>}</td><td className="num py-1 pr-3 text-right">{x?.ok ?? 0}/{l.calls}</td>
                  <td className="py-1 pr-3 text-mute">
                    {x?.pending ? <span className="mr-1"><StatusChip status="pending" /> {x.pending}</span> : null}
                    {x?.unavailable ? <span className="mr-1"><StatusChip status="skipped_price" /> {x.unavailable}</span> : null}
                    {x?.failed ? <span className="mr-1"><StatusChip status="failed" /> {x.failed}</span> : null}
                    {x?.skipped ? <span><StatusChip status="skipped_cap" /> {x.skipped}</span> : null}
                  </td>
                  <td className="num py-1 text-right">{usdPrecise(x?.cost ?? 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
