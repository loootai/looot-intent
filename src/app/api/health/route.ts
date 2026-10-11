export const dynamic = "force-dynamic";

/** Public by design: a host health check. Returns no data. */
export function GET() {
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
