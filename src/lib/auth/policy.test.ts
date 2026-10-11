import { describe, expect, it } from "vitest";
import { adminPolicy, isAuthConfigured, maxRunUsd } from "./policy";

const PW = "a-long-enough-password";

describe("adminPolicy", () => {
  it("demo with no token and no saved run is open", () => {
    expect(adminPolicy({ LOOOT_INTENT_DEMO: "1" }, false)).toEqual({ mode: "open-demo" });
  });
  it("demo next to a real token or saved run refuses, unless a password is set", () => {
    expect(adminPolicy({ LOOOT_INTENT_DEMO: "1" }, true)).toEqual({ mode: "setup", reason: "demo_with_real_data" });
    expect(adminPolicy({ LOOOT_INTENT_DEMO: "1", LOOOT_INTENT_ADMIN_PASSWORD: PW }, true).mode).toBe("login");
  });
  it("a normal run with no password is setup, not open", () => {
    expect(adminPolicy({}, false)).toEqual({ mode: "setup", reason: "no_password" });
    expect(adminPolicy({}, true).mode).toBe("setup");
  });
  it("a short password counts as not set", () => {
    expect(adminPolicy({ LOOOT_INTENT_ADMIN_PASSWORD: "short" }, false)).toEqual({ mode: "setup", reason: "short_password" });
    expect(isAuthConfigured({ LOOOT_INTENT_ADMIN_PASSWORD: "short" })).toBe(false);
  });
  it("a password or a hash turns on login", () => {
    expect(adminPolicy({ LOOOT_INTENT_ADMIN_PASSWORD: PW }, false).mode).toBe("login");
    expect(adminPolicy({ LOOOT_INTENT_ADMIN_PASSWORD_HASH: "scrypt$aa$bb" }, false).mode).toBe("login");
  });
});

describe("maxRunUsd", () => {
  it("defaults to 5 and ignores bad values", () => {
    expect(maxRunUsd({})).toBe(5);
    expect(maxRunUsd({ LOOOT_INTENT_MAX_RUN_USD: "abc" })).toBe(5);
    expect(maxRunUsd({ LOOOT_INTENT_MAX_RUN_USD: "-3" })).toBe(5);
    expect(maxRunUsd({ LOOOT_INTENT_MAX_RUN_USD: "0.5" })).toBe(0.5);
  });
});
