"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { Quote } from "@/engine/types";
import { usd, usdPrecise } from "@/engine/money";
import { StatusChip } from "./chips";

interface QuoteReply {
  quote: Quote;
  rejected: string[];
  domains: string[];
  unpriced: string[];
}

/** Domains, ICP and a spend cap in. Shows the quote before anything is bought, then runs the engine. */
export function RunPanel({ initialDomains, initialIcp, demo, canRun }: { initialDomains: string; initialIcp: string; demo: boolean; canRun: boolean }) {
  const router = useRouter();
  const [domains, setDomains] = useState(initialDomains);
  const [icp, setIcp] = useState(initialIcp);
  const [cap, setCap] = useState("5");
  const [reply, setReply] = useState<QuoteReply | null>(null);
  const [quotedFor, setQuotedFor] = useState("");
  const [busy, setBusy] = useState<"quote" | "run" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const capNum = Number(cap);
  const quoteTotal = reply?.quote.totalMicros ?? 0;
  const fresh = reply !== null && quotedFor === domains;
  const overCap = fresh && quoteTotal > capNum * 1_000_000;

  async function getQuote() {
    setBusy("quote");
    setError(null);
    try {
      const res = await fetch("/api/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domains }) });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`);
      setReply((await res.json()) as QuoteReply);
      setQuotedFor(domains);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function run() {
    setBusy("run");
    setError(null);
    try {
      const res = await fetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domains, icp, capUsd: capNum }) });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section id="run" className="scroll-mt-20 rounded-panel border border-line bg-panel p-4" aria-label="Score accounts">
      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr_auto]">
        <label className="grid gap-1">
          <span className="text-12 font-medium text-mute">Company domains, one per line</span>
          <textarea value={domains} onChange={(e) => setDomains(e.target.value)} rows={6} spellCheck={false} className="num w-full resize-y rounded-control border border-line-strong bg-page p-2 text-12 leading-5" />
        </label>
        <label className="grid gap-1">
          <span className="text-12 font-medium text-mute">ICP description</span>
          <textarea value={icp} onChange={(e) => setIcp(e.target.value)} rows={6} className="w-full resize-y rounded-control border border-line-strong bg-page p-2 text-13" />
          <span className="text-11 text-faint">Job title words, technologies and news categories that count fully are in config/intent.config.json.</span>
        </label>
        <div className="grid content-start gap-3 lg:w-48">
          <label className="grid gap-1">
            <span className="text-12 font-medium text-mute">Spend cap, USD</span>
            <input value={cap} onChange={(e) => setCap(e.target.value)} inputMode="decimal" className="num w-full rounded-control border border-line-strong bg-page px-2 py-1.5 text-13" />
          </label>
          <button type="button" onClick={getQuote} disabled={busy !== null} className="rounded-control border border-line-strong bg-panel px-3 py-1.5 font-medium hover:bg-hover disabled:opacity-50">
            {busy === "quote" ? <Loader2 className="mx-auto size-4 animate-spin" /> : "Get quote"}
          </button>
          <button type="button" onClick={run} disabled={busy !== null || !fresh || overCap || !Number.isFinite(capNum) || (!demo && !canRun)} className="rounded-control bg-brand px-3 py-1.5 font-medium text-brand-ink hover:opacity-90 disabled:opacity-40">
            {busy === "run" ? <Loader2 className="mx-auto size-4 animate-spin" /> : demo ? "Run on sample data" : "Run"}
          </button>
        </div>
      </div>

      {error && <p role="alert" className="mt-3 rounded-control bg-high-soft px-3 py-2 text-high">{error}</p>}
      {!demo && !canRun && <p className="mt-3 text-12 text-mute">LOOOT_TOKEN is not set on the server, so the quote works and the run is off. Start with npm run demo to see sample data.</p>}

      {reply && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-12">
            <thead className="text-mute">
              <tr><th className="py-1 pr-3 font-medium">Signal</th><th className="py-1 pr-3 font-medium">Provider</th><th className="py-1 pr-3 font-medium">looot job</th><th className="py-1 pr-3 text-right font-medium">Price</th><th className="py-1 pr-3 text-right font-medium">Calls</th><th className="py-1 text-right font-medium">Total</th></tr>
            </thead>
            <tbody>
              {reply.quote.lines.map((l) => (
                <tr key={l.signalId} className="border-t border-line">
                  <td className="py-1 pr-3">{l.label}{reply.unpriced.includes(l.endpointId) && <> <StatusChip status="skipped_price" /></>}</td><td className="py-1 pr-3 text-mute">{l.provider}</td><td className="num py-1 pr-3 text-mute">{l.jobId}</td>
                  <td className="num py-1 pr-3 text-right">{usdPrecise(l.priceMicros)}</td><td className="num py-1 pr-3 text-right">{l.calls}</td><td className="num py-1 text-right">{usdPrecise(l.totalMicros)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-13">
            <strong className="num">{usd(quoteTotal)}</strong> for {reply.quote.accounts} accounts at list price, {usdPrecise(reply.quote.perAccountMicros)} each. Prices {reply.quote.priceSource === "catalog" ? "read from the public catalog" : "from the dated fallback"}.
            {demo && " Demo mode charges nothing."}
            {overCap && <span className="ml-2 text-high">Above your {usd(capNum * 1_000_000)} cap. Raise the cap or remove accounts.</span>}
            {!fresh && <span className="ml-2 text-amber">The list changed. Get a new quote.</span>}
          </p>
          {reply.rejected.length > 0 && <p className="text-12 text-mute">Skipped, not domains: {reply.rejected.slice(0, 5).join(", ")}</p>}
          {reply.unpriced.length > 0 && <p role="status" className="text-12 text-amber">Source unavailable: {reply.unpriced.join(", ")} has no readable price in the looot catalog. Those calls will be skipped and the signal scores zero.</p>}
        </div>
      )}
    </section>
  );
}
