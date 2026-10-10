import { CostPanel } from "@/components/CostPanel";
import { RankedTable } from "@/components/RankedTable";
import { RunPanel } from "@/components/RunPanel";
import { usd } from "@/engine/money";
import { SIGNAL_BY_ID } from "@/engine/signals";
import { appConfig, canRunLive, getState, isDemo } from "@/server/runtime";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { run } = await getState();
  const cfg = appConfig();
  const demo = isDemo();
  const unavailable = run ? [...new Set(run.accounts.flatMap((a) => a.breakdown.filter((b) => b.status === "skipped_price").map((b) => SIGNAL_BY_ID[b.signalId].label)))] : [];
  const initialDomains = run ? run.accounts.map((a) => a.domain).join("\n") : "";
  return (
    <div className="grid grid-cols-1 gap-6">
      <div>
        <h1 className="text-20 font-medium tracking-tight">Account intent</h1>
        <p className="mt-1 max-w-3xl text-mute">
          Score a list of company domains for buying intent. Each score is built from signals looot fetched from named providers, with the weight and cost of each one shown. The quote comes before the run.
        </p>
      </div>
      <RunPanel initialDomains={initialDomains} initialIcp={run?.icp ?? cfg.icp.description} demo={demo} canRun={canRunLive()} />
      {run ? (
        <>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-12 text-mute">
            <span>Last run {run.finishedAt.slice(0, 16).replace("T", " ")} UTC</span>
            <span>{run.accounts.length} accounts</span>
            <span>{usd(run.spentMicros)} spent{run.demo ? " (demo)" : ""}</span>
            <span>Stages: aware at {cfg.stages.aware}, considering at {cfg.stages.considering}, deciding at {cfg.stages.deciding}</span>
          </div>
          {unavailable.length > 0 && (
            <p role="status" className="rounded-panel border border-line-strong bg-amber-soft px-3 py-2 text-13 text-amber">
              Source unavailable: {unavailable.join(", ")}. The looot catalog has no readable price for the endpoint, so those calls were not made and the signal scored zero for every account.
            </p>
          )}
          <RankedTable accounts={run.accounts} />
          <CostPanel run={run} />
        </>
      ) : (
        <p className="rounded-panel border border-dashed border-line-strong p-8 text-center text-mute">No run yet. Paste domains above, get a quote, then run.</p>
      )}
    </div>
  );
}
