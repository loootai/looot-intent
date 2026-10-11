import { cn } from "@/lib/cn";
import type { CallStatus, Stage } from "@/engine/types";

const STAGE_STYLE: Record<Stage, string> = {
  unaware: "bg-low-soft text-low",
  aware: "bg-amber-soft text-amber",
  considering: "bg-brand-soft text-link",
  deciding: "bg-brand text-brand-ink",
};

/** The buying stage as a pill. */
export function StageChip({ stage, className }: { stage: Stage; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-12 font-medium capitalize", STAGE_STYLE[stage], className)}>{stage}</span>;
}

const STATUS_LABEL: Record<CallStatus, string> = { ok: "ok", failed: "failed", pending: "pending", skipped_cap: "skipped, cap", skipped_budget: "skipped, budget", skipped_price: "source unavailable", parse_error: "unreadable" };

/** A call status. Only the ones that need attention are drawn loud. */
export function StatusChip({ status }: { status: CallStatus }) {
  if (status === "ok") return <span className="text-12 text-faint">ok</span>;
  const tone = status === "pending" || status === "skipped_price" ? "bg-amber-soft text-amber" : "bg-high-soft text-high";
  return <span className={cn("rounded-full px-1.5 py-0.5 text-11 font-medium", tone)}>{STATUS_LABEL[status]}</span>;
}

/** A horizontal bar for a value out of a maximum. */
export function Bar({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-hover", className)} role="presentation">
      <div className="h-full rounded-full bg-emerald" style={{ width: `${pct}%` }} />
    </div>
  );
}
