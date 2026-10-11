import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { POST as quote } from "@/app/api/quote/route";
import { POST as run } from "@/app/api/run/route";
import { proxy } from "@/proxy";
import { resetLimits } from "./limits";
import { csrfToken, verifySession } from "./session";

const PW = "test-password-123456";
const H = { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json", "x-forwarded-for": "198.51.100.7" };
const KEYS = ["LOOOT_INTENT_ADMIN_PASSWORD", "LOOOT_INTENT_DIR", "LOOOT_INTENT_DEMO", "LOOOT_INTENT_MAX_RUN_USD", "LOOOT_TOKEN"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

const post = (url: string, body: unknown, headers: Record<string, string> = {}) => new Request(`http://localhost:3000${url}`, { method: "POST", headers: { ...H, ...headers }, body: JSON.stringify(body) });
const cookieOf = (res: Response) => /intent_session=[^;]+/.exec(res.headers.get("set-cookie") ?? "")?.[0] ?? "";
const DOMAINS = Array.from({ length: 60 }, (_, i) => `acme${i}.example`).join("\n");

beforeEach(() => {
  process.env.LOOOT_INTENT_DIR = ".vitest/no-such-dir";
  process.env.LOOOT_INTENT_ADMIN_PASSWORD = PW;
  delete process.env.LOOOT_INTENT_DEMO;
  delete process.env.LOOOT_INTENT_MAX_RUN_USD;
  delete process.env.LOOOT_TOKEN;
  resetLimits();
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function session() {
  const res = await login(post("/api/auth/login", { password: PW }));
  const cookie = cookieOf(res);
  const s = (await verifySession(process.env, cookie.split("=")[1]))!;
  return { cookie, token: await csrfToken(process.env, s.sid) };
}

describe("sign in", () => {
  it("a wrong password gets 401 and no cookie", async () => {
    const res = await login(post("/api/auth/login", { password: "nope-nope-nope-nope" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
  it("the right password sets a hardened cookie that opens admin pages", async () => {
    const res = await login(post("/api/auth/login", { password: PW }));
    expect(res.status).toBe(200);
    const sc = res.headers.get("set-cookie")!;
    expect(sc).toMatch(/HttpOnly/);
    expect(sc).toMatch(/SameSite=Lax/);
    expect(sc).toMatch(/Max-Age=/);
    const page = await proxy(new NextRequest("http://localhost:3000/", { headers: { cookie: cookieOf(res) } }));
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toBe("no-store");
  });
  it("a form post redirects to the page asked for, and never off site", async () => {
    const form = (next: string) => new Request("http://localhost:3000/api/auth/login", { method: "POST", headers: { host: H.host, origin: H.origin, "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": H["x-forwarded-for"] }, body: new URLSearchParams({ password: PW, next }) });
    expect((await login(form("/accounts/acme.example"))).headers.get("location")).toBe("/accounts/acme.example");
    expect((await login(form("//evil.example"))).headers.get("location")).toBe("/");
    expect((await login(form("https://evil.example"))).headers.get("location")).toBe("/");
  });
  it("locks the address after 5 wrong passwords, and the right password does not help until the window ends", async () => {
    for (let i = 0; i < 5; i++) expect((await login(post("/api/auth/login", { password: `wrong-password-${i}-xx` }))).status).toBe(401);
    const locked = await login(post("/api/auth/login", { password: PW }));
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(locked.headers.get("set-cookie")).toBeNull();
  });
  it("refuses a sign-in posted from another site", async () => {
    expect((await login(post("/api/auth/login", { password: PW }, { origin: "https://evil.example" }))).status).toBe(403);
  });
  it("answers 503 when no password is set", async () => {
    delete process.env.LOOOT_INTENT_ADMIN_PASSWORD;
    expect((await login(post("/api/auth/login", { password: PW }))).status).toBe(503);
  });
  it("sign out clears the cookie, and only for a same-site request", async () => {
    expect((await logout(post("/api/auth/logout", {}))).headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect((await logout(post("/api/auth/logout", {}, { origin: "https://evil.example" }))).status).toBe(403);
  });
});

describe("CSRF on state-changing admin requests", () => {
  it("rejects a cross-site origin even with a valid session", async () => {
    const { cookie, token } = await session();
    expect((await quote(post("/api/quote", { domains: "a.example" }, { cookie, "x-intent-csrf": token, origin: "https://evil.example" }))).status).toBe(403);
  });
  it("rejects a same-origin request without the token, or with someone else's", async () => {
    const { cookie } = await session();
    expect((await quote(post("/api/quote", { domains: "a.example" }, { cookie }))).status).toBe(403);
    expect((await quote(post("/api/quote", { domains: "a.example" }, { cookie, "x-intent-csrf": "AAAA" }))).status).toBe(403);
  });
  it("a request with no Origin and no fetch metadata is refused", async () => {
    const { cookie, token } = await session();
    const res = await quote(new Request("http://localhost:3000/api/quote", { method: "POST", headers: { host: H.host, cookie, "x-intent-csrf": token }, body: "{}" }));
    expect(res.status).toBe(403);
  });
  it("accepts a same-origin request with the session token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { cookie, token } = await session();
    const res = await quote(post("/api/quote", { domains: "a.example" }, { cookie, "x-intent-csrf": token }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("the spend cap belongs to the server", () => {
  async function paidRun(body: unknown) {
    const f = vi.fn().mockRejectedValue(new Error("no network in tests"));
    vi.stubGlobal("fetch", f);
    process.env.LOOOT_TOKEN = "lt_fake_token_for_tests";
    const { cookie, token } = await session();
    const res = await run(post("/api/run", body, { cookie, "x-intent-csrf": token }));
    return { res, json: (await res.json()) as { error?: string }, fetchCalls: f.mock.calls.map((c) => String(c[0])) };
  }
  it("ignores a capUsd sent by the caller", async () => {
    const { res, json, fetchCalls } = await paidRun({ domains: DOMAINS, capUsd: 100000, confirmedMaxMicros: 100_000_000_000 });
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/per-run cap/);
    expect(fetchCalls.some((u) => u.includes("/v1/runs"))).toBe(false);
  });
  it("a huge confirmedMaxMicros cannot raise the server cap", async () => {
    process.env.LOOOT_INTENT_MAX_RUN_USD = "1";
    const { res, json } = await paidRun({ domains: DOMAINS, confirmedMaxMicros: 999_000_000 });
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/\$1\.00/);
  });
  it("refuses when the price is above the quote the caller confirmed", async () => {
    const { res, json } = await paidRun({ domains: "a.example", confirmedMaxMicros: 1 });
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/above the quote you confirmed/);
  });
  it("refuses a run with no confirmed quote", async () => {
    const { res } = await paidRun({ domains: "a.example", capUsd: 5 });
    expect(res.status).toBe(400);
  });
  it("rate limits runs per session", async () => {
    process.env.LOOOT_TOKEN = "lt_fake_token_for_tests";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { cookie, token } = await session();
    const go = () => run(post("/api/run", { domains: DOMAINS, confirmedMaxMicros: 1 }, { cookie, "x-intent-csrf": token }));
    for (let i = 0; i < 6; i++) expect((await go()).status).toBe(400);
    const limited = await go();
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    const other = await session();
    expect((await run(post("/api/run", { domains: DOMAINS, confirmedMaxMicros: 1 }, { cookie: other.cookie, "x-intent-csrf": other.token }))).status).toBe(400);
  });
});

describe("demo mode", () => {
  it("is open with no sign-in, runs on sample data, and still refuses cross-site posts", async () => {
    delete process.env.LOOOT_INTENT_ADMIN_PASSWORD;
    process.env.LOOOT_INTENT_DEMO = "1";
    const res = await run(post("/api/run", { domains: "a.example\nb.example", confirmedMaxMicros: 1_000_000 }));
    expect(res.status).toBe(200);
    expect((await run(post("/api/run", { domains: "a.example", confirmedMaxMicros: 1_000_000 }, { origin: "https://evil.example" }))).status).toBe(403);
  });
  it("refuses to open next to a real token", async () => {
    delete process.env.LOOOT_INTENT_ADMIN_PASSWORD;
    process.env.LOOOT_INTENT_DEMO = "1";
    process.env.LOOOT_TOKEN = "lt_real_looking_token";
    expect((await run(post("/api/run", { domains: "a.example", confirmedMaxMicros: 1_000_000 }))).status).toBe(503);
  });
});
