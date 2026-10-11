import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main, parseArgs } from "./cli";

const dir = path.resolve(".test-out");
const lines: string[] = [];
const out = (s: string) => void lines.push(s);

beforeEach(() => {
  lines.length = 0;
  fs.mkdirSync(dir, { recursive: true });
  process.env.LOOOT_INTENT_DIR = path.join(dir, "state");
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.LOOOT_INTENT_DIR;
});

describe("parseArgs", () => {
  it("reads flags and one input file", () => {
    const a = parseArgs(["list.csv", "--max-spend", "2.5", "--format", "json,md", "--dry-run", "--column", "website"]);
    expect(a).toMatchObject({ file: "list.csv", maxSpend: 2.5, formats: ["json", "md"], dryRun: true, column: "website" });
  });
  it("rejects a typo instead of running with defaults", () => {
    expect(() => parseArgs(["--max-spnd", "1"])).toThrow(/Unknown option/);
    expect(() => parseArgs(["--max-spend"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--max-spend", "abc"])).toThrow(/dollar amount/);
    expect(() => parseArgs(["--format", "xml"])).toThrow(/Unknown format/);
  });
});

describe("main", () => {
  it("prints the quote on --dry-run and makes no run", async () => {
    const file = path.join(dir, "d.txt");
    fs.writeFileSync(file, "acme.com\nglobex.io\n");
    const code = await main([file, "--dry-run", "--offline"], {}, out);
    const text = lines.join("\n");
    expect(code).toBe(0);
    expect(text).toContain("2 accounts, 11 signals each");
    expect(text).toContain("Quoted $0.54 at list price");
    expect(text).toContain("no run was made");
    expect(text).toContain("theirstack");
    expect(text).toContain("per result");
    expect(fs.existsSync(path.join(dir, "state"))).toBe(false);
  });
  it("refuses a quote above the cap and runs nothing", async () => {
    const code = await main(["--domains", "a.com,b.com,c.com", "--max-spend", "0.2", "--offline"], { LOOOT_TOKEN: "t" }, out);
    expect(code).toBe(2);
    expect(lines.join("\n")).toContain("Refused: the quote is above the cap");
  });
  it("refuses to run without a token and points at the demo", async () => {
    const code = await main(["--domains", "a.com", "--offline", "--max-spend", "1"], {}, out);
    // --offline outside --dry-run still reads prices; the token check comes first only after the quote.
    expect(code).toBe(2);
    expect(lines.join("\n")).toContain("LOOOT_TOKEN is not set");
  });
  it("runs the demo and writes json, csv and markdown reports", async () => {
    const o = path.join(dir, "reports");
    const code = await main(["--demo", "--out", o], {}, out);
    expect(code).toBe(0);
    const files = fs.readdirSync(o).sort();
    expect(files.map((f) => path.extname(f))).toEqual([".csv", ".json", ".md"]);
    const json = JSON.parse(fs.readFileSync(path.join(o, files.find((f) => f.endsWith(".json"))!), "utf8"));
    expect(json.accounts).toHaveLength(10);
    expect(json.accounts[0].breakdown[0]).toHaveProperty("provider");
    const csv = fs.readFileSync(path.join(o, files.find((f) => f.endsWith(".csv"))!), "utf8");
    expect(csv.split("\n")[0]).toBe("rank,domain,score,stage,signals_with_data,signals_enabled,cost_usd,top_reasons");
    expect(lines.join("\n")).toContain("Spent $0.00");
  });
  it("fails on an empty input and on a missing file with a readable message", async () => {
    expect(await main(["--domains", "nope"], {}, out)).toBe(1);
    expect(await main(["missing.txt"], {}, out)).toBe(1);
    expect(lines.join("\n")).toMatch(/No valid domains|Error: ENOENT/);
  });
});
