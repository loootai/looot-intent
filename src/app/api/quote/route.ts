import { NextResponse } from "next/server";
import { quoteFor } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { domains?: unknown };
  if (typeof body.domains !== "string") return NextResponse.json({ error: "domains must be a string" }, { status: 400 });
  return NextResponse.json(await quoteFor(body.domains));
}
