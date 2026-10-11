import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/auth/guard";
import { allow, retryAfter } from "@/lib/auth/limits";
import { SESSION_COOKIE, cookieFrom } from "@/lib/auth/session";
import { canRunLive, isDemo, runFor } from "@/server/runtime";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Spending runs allowed per session in the window. */
export const RUN_LIMIT = 6;
export const RUN_WINDOW_MS = 10 * 60_000;

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Admin only. A paid run.
 * The spend ceiling comes from the server (LOOOT_INTENT_MAX_RUN_USD). The caller sends the quote total it saw as
 * confirmedMaxMicros, which can only lower the ceiling. A "capUsd" field in the body is ignored.
 */
export async function POST(req: Request) {
  const denied = await requireAdminRoute(req);
  if (denied) return denied;
  const key = `run:${cookieFrom(req.headers.get("cookie"), SESSION_COOKIE)?.split(".")[1] ?? "demo"}`;
  if (!allow(key, RUN_LIMIT, RUN_WINDOW_MS)) return NextResponse.json({ error: "Too many runs from this session. Wait a few minutes." }, { status: 429, headers: { ...NO_STORE, "Retry-After": String(retryAfter(key)) } });
  const body = (await req.json().catch(() => ({}))) as { domains?: unknown; icp?: unknown; confirmedMaxMicros?: unknown };
  if (typeof body.domains !== "string") return NextResponse.json({ error: "domains must be a string" }, { status: 400, headers: NO_STORE });
  const confirmedMaxMicros = Number(body.confirmedMaxMicros);
  if (!Number.isFinite(confirmedMaxMicros) || confirmedMaxMicros < 0) return NextResponse.json({ error: "confirmedMaxMicros must be the quote total in micro-dollars. Get a quote first." }, { status: 400, headers: NO_STORE });
  if (!isDemo() && !canRunLive()) return NextResponse.json({ error: "LOOOT_TOKEN is not set on the server. Set it, or start the demo with npm run demo." }, { status: 503, headers: NO_STORE });
  try {
    const run = await runFor({ domains: body.domains, icp: typeof body.icp === "string" ? body.icp : undefined, confirmedMaxMicros });
    return NextResponse.json({ runId: run.runId, spentMicros: run.spentMicros, accounts: run.accounts.length }, { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400, headers: NO_STORE });
  }
}
