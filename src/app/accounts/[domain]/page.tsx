import { requireAdminPage } from "@/lib/auth/guard";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Bar, StageChip, StatusChip } from "@/components/chips";
import { usd, usdPrecise } from "@/engine/money";
import { ago } from "@/engine/score";
import { getState } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ domain: string }> }): Promise<Metadata> {
  return { title: decodeURIComponent((await params).domain) };
}

export default async function AccountPage({ params }: { params: Promise<{ domain: string }> }) {
  await requireAdminPage();
  const domain = decodeURIComponent((await params).domain);
  const { run } = await getState();
  const rank = run ? run.accounts.findIndex((a) => a.domain === domain) : -1;
  if (!run || rank < 0) notFound();
  const a = run.accounts[rank];
  const now = new Date(run.finishedAt);
  const dated = a.events.filter((e) => e.date);
  const undated = a.events.filter((e) => !e.date);
  const byPoints = [...a.breakdown].sort((x, y) => y.points - x.points || y.maxPoints - x.maxPoints);
  return (
    <div className="grid grid-cols-1 gap-6">
      <Link href="/" className="inline-flex w-fit items-center gap-1 text-12 text-mute hover:text-ink"><ArrowLeft size={14} /> All accounts</Link>

      <header className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="truncate text-20 font-medium tracking-tight">{a.domain}</h1>
          <p className="text-12 text-mute">Rank {rank + 1} of {run.accounts.length}. {a.coverage.withData} of {a.coverage.enabled} signals returned data. {usd(a.costMicros)} spent on this account.</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <StageChip stage={a.stage} className="px-3 py-1 text-13" />
          <div className="text-right"><div className="num text-[40px] font-medium leading-none">{a.score}</div><div className="text-11 text-mute">of 100</div></div>
        </div>
      </header>

      <section className="rounded-panel border border-line bg-panel p-4" aria-label="Why this score">
        <h2 className="text-16 font-medium">Why this score</h2>
        <ul className="mt-2 grid gap-1.5">
          {a.reasons.map((r) => <li key={r} className="text-13">{r}</li>)}
        </ul>
      </section>

      <section aria-label="Score breakdown by provider">
        <h2 className="mb-2 text-16 font-medium">Score breakdown by provider</h2>
        <div className="overflow-x-auto rounded-panel border border-line bg-panel">
          <table className="w-full min-w-[820px] text-left text-13">
            <thead className="border-b border-line text-12 text-mute">
              <tr><th className="px-3 py-2 font-medium">Signal</th><th className="px-3 py-2 font-medium">Provider</th><th className="w-48 px-3 py-2 font-medium">Points</th><th className="px-3 py-2 font-medium">Evidence</th><th className="px-3 py-2 text-right font-medium">Cost</th><th className="px-3 py-2 font-medium">Call</th></tr>
            </thead>
            <tbody>
              {byPoints.map((b) => (
                <tr key={b.signalId} className="border-t border-line align-top">
                  <td className="px-3 py-2 font-medium">{b.label}</td>
                  <td className="px-3 py-2 text-mute">{b.provider}<div className="num text-11 text-faint">{b.endpointId.length > 28 ? `${b.endpointId.slice(0, 27)}...` : b.endpointId}</div></td>
                  <td className="px-3 py-2"><div className="flex items-center gap-2"><span className="num w-20 text-right text-12">{b.points.toFixed(1)} / {b.maxPoints.toFixed(1)}</span><Bar value={b.points} max={b.maxPoints} /></div></td>
                  <td className="px-3 py-2 text-mute">{b.summary}</td>
                  <td className="num px-3 py-2 text-right text-mute">{usdPrecise(b.costMicros)}</td>
                  <td className="px-3 py-2"><StatusChip status={b.status} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-line-strong">
              <tr><td className="px-3 py-2 font-medium" colSpan={2}>Total</td><td className="num px-3 py-2 text-right font-medium">{a.score} / 100</td><td /><td className="num px-3 py-2 text-right">{usdPrecise(a.costMicros)}</td><td /></tr>
            </tfoot>
          </table>
        </div>
        <p className="mt-2 text-12 text-mute">Points are the signal weight (scaled so the enabled signals add up to 100) times how strong the evidence is. Weights, half-lives and stage thresholds are in config/intent.config.json.</p>
      </section>

      <section aria-label="Signal timeline">
        <h2 className="mb-2 text-16 font-medium">Signal timeline</h2>
        {dated.length === 0 && undated.length === 0 ? (
          <p className="rounded-panel border border-dashed border-line-strong p-6 text-center text-mute">No events found.</p>
        ) : (
          <ol className="relative grid gap-0 border-l border-line-strong pl-5">
            {[...dated, ...undated].slice(0, 25).map((e, i) => (
              <li key={`${e.signalId}-${i}`} className="relative pb-4">
                <span className={`absolute -left-[25px] top-1.5 size-2.5 rounded-full border-2 border-page ${e.relevant ? "bg-emerald" : "bg-k-grey"}`} />
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="num text-12 text-mute">{e.date ? `${e.date.slice(0, 10)}, ${ago(e.date, now)}` : "undated"}</span>
                  <span className="rounded-full bg-hover px-2 py-0.5 text-11 text-mute">{e.category}</span>
                  <span className="text-11 text-faint">{e.provider}</span>
                  {!e.relevant && <span className="text-11 text-faint">outside ICP</span>}
                </div>
                <div className="text-13">{e.url ? <a href={e.url} className="text-link hover:underline" rel="noreferrer">{e.title}</a> : e.title}</div>
                {e.detail && <div className="text-12 text-mute">{e.detail}</div>}
              </li>
            ))}
          </ol>
        )}
        {a.events.length > 25 && <p className="mt-1 text-12 text-mute">Showing the newest 25 of {a.events.length} events.</p>}
      </section>
    </div>
  );
}
