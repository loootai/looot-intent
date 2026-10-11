import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/auth/guard";
import { quoteFor } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = await requireAdminRoute(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { domains?: unknown };
  if (typeof body.domains !== "string") return NextResponse.json({ error: "domains must be a string" }, { status: 400 });
  return NextResponse.json(await quoteFor(body.domains), { headers: { "Cache-Control": "no-store" } });
}
