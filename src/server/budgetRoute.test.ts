import { mkdirSync, mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as budgetGet, PUT as budgetPut } from "@/app/api/budget/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as quote } from "@/app/api/quote/route";
import { POST as run } from "@/app/api/run/route";
import { resetLimits } from "@/lib/auth/limits";
import { getState } from "@/server/runtime";
import { CSRF_HEADER, csrfToken, verifySession } from "@/lib/auth/session";

const PW = "test-password-123456";
const KEYS = ["LOOOT_TOKEN", "LOOOT_API_URL", "LOOOT_INTENT_DIR", "LOOOT_INTENT_MAX_RUN_USD", "LOOOT_INTENT_ADMIN_PASSWORD", "LOOOT_INTENT_CONFIG", "LOOOT_INTENT_DEMO"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
let server: Server;
let paidRuns = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.method === "GET" && req.url?.startsWith("/v1/public-catalog/")) return void res.end(JSON.stringify({ price: { state: "known", amountMicros: 2_000, unit: "call" } }));
    if (req.method === "POST") paidRuns++;
    res.statusCode = req.method === "POST" ? 200 : 404;
    res.end(JSON.stringify({ runId: "r", status: "completed", result: {}, actualCost: 0.002 }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.LOOOT_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
beforeEach(() => {
  mkdirSync(join(process.cwd(), ".vitest"), { recursive: true });
  const dir = mkdtempSync(join(process.cwd(), ".vitest", "budget-route-"));
  process.env.LOOOT_INTENT_DIR = dir;
  process.env.LOOOT_INTENT_ADMIN_PASSWORD = PW;
  process.env.LOOOT_TOKEN = "lt_test_token";
  delete process.env.LOOOT_INTENT_DEMO;
  delete process.env.LOOOT_INTENT_MAX_RUN_USD;
  paidRuns = 0;
  resetLimits();
});

const H = { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json", "x-forwarded-for": "198.51.100.7" };
async function session() {
  const res = await login(new Request("http://localhost:3000/api/auth/login", { method: "POST", headers: H, body: JSON.stringify({ password: PW }) }));
  const cookie = /intent_session=[^;]+/.exec(res.headers.get("set-cookie") ?? "")![0];
  const s = (await verifySession(process.env, cookie.split("=")[1]))!;
  return { cookie, token: await csrfToken(process.env, s.sid) };
}
type S = Awaited<ReturnType<typeof session>>;
const call = (fn: typeof run, method: string, path: string, body: unknown, s: S) => fn(new Request(`http://localhost:3000${path}`, { method, headers: { ...H, cookie: s.cookie, [CSRF_HEADER]: s.token }, body: body === undefined ? undefined : JSON.stringify(body) }));
const RUN = { domains: "acme.com", confirmedMaxMicros: 1_000_000_000 };

describe("budget over HTTP", () => {
  it("shows used, reserved and remaining", async () => {
    const s = await session();
    const res = await budgetGet(new Request("http://localhost:3000/api/budget", { headers: { ...H, cookie: s.cookie } }));
    const j = (await res.json()) as { day: { limitMicros: number; usedMicros: number; reservedMicros: number; remainingMicros: number } };
    expect(res.status).toBe(200);
    expect(j.day.remainingMicros).toBe(j.day.limitMicros);
  });

  it("refuses to change the budget without the session", async () => {
    const res = await budgetPut(new Request("http://localhost:3000/api/budget", { method: "PUT", headers: H, body: JSON.stringify({ dailyUsd: 1000, monthlyUsd: 5000 }) }));
    expect(res.status).toBe(401);
  });

  it("lets the signed-in owner change the budget", async () => {
    const s = await session();
    const res = await call(budgetPut as typeof run, "PUT", "/api/budget", { dailyUsd: 1, monthlyUsd: 3 }, s);
    expect(res.status).toBe(200);
    const j = (await (await budgetGet(new Request("http://localhost:3000/api/budget", { headers: { ...H, cookie: s.cookie } }))).json()) as { limits: { dailyMicros: number; monthlyMicros: number } };
    expect(j.limits).toEqual({ dailyMicros: 1_000_000, monthlyMicros: 3_000_000 });
  });

  it("ignores a budget sent in a run request", async () => {
    const s = await session();
    await call(budgetPut as typeof run, "PUT", "/api/budget", { dailyUsd: 0.001, monthlyUsd: 0.002 }, s);
    const res = await call(run, "POST", "/api/run", { ...RUN, dailyUsd: 1e9, monthlyUsd: 1e9, budget: { dailyUsd: 1e9 }, limits: { dailyMicros: 1e15 } }, s);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/budget/i);
    expect(paidRuns).toBe(0);
    const j = (await (await budgetGet(new Request("http://localhost:3000/api/budget", { headers: { ...H, cookie: s.cookie } }))).json()) as { limits: { dailyMicros: number } };
    expect(j.limits.dailyMicros).toBe(1_000);
  });

  it("does not charge a repeated identical run twice", async () => {
    const s = await session();
    expect((await call(run, "POST", "/api/run", RUN, s)).status).toBe(200);
    const after1 = paidRuns;
    expect(after1).toBeGreaterThan(0);
    const again = await call(run, "POST", "/api/run", RUN, s);
    expect(again.status).toBe(200);
    expect(paidRuns).toBe(after1);
  });

  it("ignores a cap sent by the caller", async () => {
    process.env.LOOOT_INTENT_MAX_RUN_USD = "0.001";
    const s = await session();
    const res = await call(run, "POST", "/api/run", { ...RUN, capUsd: 1000, maxRunUsd: 1000, capMicros: 1e12 }, s);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/cap/i);
    expect(paidRuns).toBe(0);
  });

  it("does not let a confirmed amount lower or raise the cap, only the server sets it", async () => {
    process.env.LOOOT_INTENT_MAX_RUN_USD = "2";
    const s = await session();
    const q = (await (await call(quote, "POST", "/api/quote", { domains: "acme.com" }, s)).json()) as { quote: { totalMicros: number } };
    expect(q.quote.totalMicros).toBeGreaterThan(0);
    const res = await call(run, "POST", "/api/run", { domains: "acme.com", confirmedMaxMicros: q.quote.totalMicros }, s);
    expect(res.status).toBe(200);
    expect((await getState()).run?.capMicros).toBe(2_000_000);
  });
});
