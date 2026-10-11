import fs from "node:fs";
import path from "node:path";
import { Budget } from "../engine/budget";
import { loadConfig, DEFAULT_CONFIG_PATH } from "../engine/config";
import { DEMO_DOMAINS, DEMO_ICP, DEMO_NOW, demoRunner, demoSnapshots } from "../engine/demo";
import { buildQuote, parseCsvDomains, parseDomains, runIntent } from "../engine/engine";
import { LoootError, fetchPrices, loootFromEnv } from "../engine/looot";
import { toMicros, usd, usdPrecise } from "../engine/money";
import { toCsv, toJson, toMarkdown } from "../engine/report";
import { FALLBACK_PRICES, PRICE_UNITS } from "../engine/signals";
import { readState, writeState } from "../engine/state";
import type { Quote } from "../engine/types";

const HELP = `looot-intent: account intent scoring on looot

Usage
  npm run intent -- <domains.txt|domains.csv> [options]
  npm run intent -- --domains acme.com,globex.com [options]
  npm run intent -- --demo

Options
  --domains a.com,b.com   Domains on the command line instead of a file
  --column <name|index>   CSV column that holds the domain (default: first column or a header named domain)
  --icp "text"            ICP description. Overrides the config file
  --config <file>         Scoring config (default ${DEFAULT_CONFIG_PATH})
  --max-spend <usd>       Per-run spend cap in dollars (default 5)
  --partial               Run until the cap or the period budget even when the quote is above it
  --out <dir>             Where reports go (default ./out)
  --format json,csv,md    Report formats (default json,csv,md)
  --dry-run               Print the list-price cost and make no run
  --offline               Use the dated prices in the code and read nothing from the catalog
  --demo                  Sample data. No token, no network, no cost
  --help

Environment
  LOOOT_TOKEN             Your looot key. Not needed for --demo or --dry-run
  LOOOT_INTENT_DAILY_USD  Default daily budget until the owner saves one in the web UI (default 10)
  LOOOT_INTENT_MONTHLY_USD Default monthly budget (default 50)
  LOOOT_API_URL           Override the API base (default https://api.looot.ai)
`;

interface Args {
  file?: string;
  domains?: string;
  column?: string;
  icp?: string;
  config?: string;
  maxSpend: number;
  partial: boolean;
  out: string;
  formats: string[];
  dryRun: boolean;
  offline: boolean;
  demo: boolean;
  help: boolean;
}

/** Parses argv. Throws on an unknown flag so a typo never runs a paid job with defaults. */
export function parseArgs(argv: string[]): Args {
  const a: Args = { maxSpend: 5, partial: false, out: "out", formats: ["json", "csv", "md"], dryRun: false, offline: false, demo: false, help: false };
  const value = (i: number, flag: string) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    switch (t) {
      case "--domains": a.domains = value(i++, t); break;
      case "--column": a.column = value(i++, t); break;
      case "--icp": a.icp = value(i++, t); break;
      case "--config": a.config = value(i++, t); break;
      case "--max-spend": {
        const n = Number(value(i++, t));
        if (!Number.isFinite(n) || n < 0) throw new Error("--max-spend needs a dollar amount, for example 5");
        a.maxSpend = n;
        break;
      }
      case "--out": a.out = value(i++, t); break;
      case "--format": a.formats = value(i++, t).split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--partial": a.partial = true; break;
      case "--dry-run": a.dryRun = true; break;
      case "--offline": a.offline = true; break;
      case "--demo": a.demo = true; break;
      case "--help": case "-h": a.help = true; break;
      default:
        if (t.startsWith("--")) throw new Error(`Unknown option ${t}. Run with --help.`);
        if (a.file) throw new Error(`Only one input file is accepted, got ${a.file} and ${t}`);
        a.file = t;
    }
  }
  for (const f of a.formats) if (!["json", "csv", "md"].includes(f)) throw new Error(`Unknown format ${f}. Use json, csv or md.`);
  return a;
}

function quoteTable(q: Quote): string {
  const rows = q.lines.map((l) => `  ${l.label.padEnd(26)} ${l.provider.padEnd(14)} ${l.jobId.padEnd(26)} ${usdPrecise(l.priceMicros).padStart(9)} x ${String(l.calls).padStart(4)} = ${usdPrecise(l.totalMicros).padStart(9)}`);
  const perResult = q.lines.filter((l) => l.unit === "result").map((l) => `  ${l.label}: the price is per result. The app asks for 1 result per account, so ${usdPrecise(l.priceMicros)} is the most one account costs. The catalog says nothing found means no charge.`);
  return [...rows, `  ${"Total".padEnd(26)} ${"".padEnd(14)} ${"".padEnd(26)} ${usdPrecise(q.perAccountMicros).padStart(9)} per account ${usd(q.totalMicros).padStart(9)}`, ...perResult, `  Prices: ${q.priceSource === "catalog" ? "read from the public looot catalog" : "dated fallback in the code"}`].join("\n");
}

/** Runs the CLI. Returns the exit code: 0 done, 1 error, 2 refused (over the cap, no token). */
export async function main(argv: string[], env: Record<string, string | undefined> = process.env, out: (s: string) => void = (s) => process.stdout.write(`${s}\n`)): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    out((e as Error).message);
    return 1;
  }
  if (args.help || (argv.length === 0)) {
    out(HELP);
    return args.help ? 0 : 1;
  }

  try {
    const cfg = loadConfig(args.config);
    if (args.icp) cfg.icp.description = args.icp;
    if (args.demo && !args.icp) cfg.icp.description = DEMO_ICP;

    let domains: string[];
    let rejected: string[] = [];
    if (args.demo && !args.file && !args.domains) domains = DEMO_DOMAINS;
    else if (args.domains) ({ domains, rejected } = parseDomains(args.domains.replace(/,/g, "\n")));
    else if (args.file) {
      const text = fs.readFileSync(args.file, "utf8");
      ({ domains, rejected } = args.file.toLowerCase().endsWith(".csv") ? parseCsvDomains(text, args.column) : parseDomains(text));
    } else {
      out("Give a domains file or --domains. Run with --help.");
      return 1;
    }
    if (rejected.length) out(`Skipped ${rejected.length} lines that are not domains: ${rejected.slice(0, 5).join(", ")}${rejected.length > 5 ? ", ..." : ""}`);
    if (domains.length === 0) {
      out("No valid domains in the input.");
      return 1;
    }

    const capMicros = toMicros(args.maxSpend);
    let prices = { ...FALLBACK_PRICES };
    let priceSource: Quote["priceSource"] = "fallback";
    let unpriced: string[] = [];
    if (!args.demo && !args.offline) {
      const live = await fetchPrices(FALLBACK_PRICES, { units: PRICE_UNITS });
      prices = live.prices;
      priceSource = live.source;
      unpriced = live.unread;
    }
    if (args.demo) priceSource = "catalog";
    if (args.offline) out("Offline: using the dated prices in the code (2026-10-10), not the live catalog.");
    const quote = buildQuote(domains, cfg, prices, priceSource);
    out(`${domains.length} accounts, ${quote.lines.length} signals each.`);
    out(quoteTable(quote));
    out(`Quoted ${usd(quote.totalMicros)} at list price. Cap ${usd(capMicros)}.`);
    if (unpriced.length) out(`Source unavailable: ${unpriced.join(", ")} has no readable price in the catalog. Those calls will be skipped and shown as source unavailable.`);

    if (args.dryRun) {
      out("Dry run: no run was made and nothing was charged.");
      return 0;
    }
    if (quote.totalMicros > capMicros && !args.partial && !args.demo) {
      out(`Refused: the quote is above the cap. Raise --max-spend, score fewer accounts, or pass --partial to run until the cap.`);
      return 2;
    }

    let looot;
    if (args.demo) looot = demoRunner();
    else {
      try {
        looot = loootFromEnv(env);
      } catch (e) {
        if (e instanceof LoootError && e.code === "missing_token") {
          out("LOOOT_TOKEN is not set. Create a key at https://looot.ai, or try --demo or --dry-run.");
          return 2;
        }
        throw e;
      }
    }

    // Check order: quote, per-run cap (above), period budget, then the calls.
    const budget = args.demo ? undefined : new Budget();
    if (budget && "getRun" in looot) {
      await budget.reconcile(looot as unknown as { getRun(id: string): Promise<import("../engine/looot").LoootRun> });
      const room = await budget.status();
      out(`Budget left: ${usd(room.remainingMicros)} (${usd(room.day.remainingMicros)} today, ${usd(room.month.remainingMicros)} this month, ${usd(room.day.reservedMicros)} reserved).`);
      if (quote.totalMicros > room.remainingMicros && !args.partial) {
        out("Refused: the quote is above what is left of the period budget. Wait for the period to roll over, raise the budget on the Costs page of the web UI, or pass --partial to run until it is reached.");
        return 2;
      }
    }
    const state = readState();
    const { result, snapshots } = await runIntent({
      domains,
      config: cfg,
      looot,
      prices,
      priceSource,
      unpriced,
      capMicros,
      ledger: budget,
      snapshots: args.demo ? demoSnapshots() : state.snapshots,
      now: args.demo ? DEMO_NOW : new Date(),
      demo: args.demo,
      onProgress: (d, t, dom) => out(`  ${String(d).padStart(String(t).length)}/${t} ${dom}`),
    });

    fs.mkdirSync(args.out, { recursive: true });
    const base = path.join(args.out, `intent-${result.runId}`);
    const written: string[] = [];
    if (args.formats.includes("json")) {
      fs.writeFileSync(`${base}.json`, toJson(result));
      written.push(`${base}.json`);
    }
    if (args.formats.includes("csv")) {
      fs.writeFileSync(`${base}.csv`, toCsv(result));
      written.push(`${base}.csv`);
    }
    if (args.formats.includes("md")) {
      fs.writeFileSync(`${base}.md`, toMarkdown(result));
      written.push(`${base}.md`);
    }
    if (!args.demo) writeState({ run: result, snapshots });

    out("");
    result.accounts.slice(0, 10).forEach((a, i) => out(`${String(i + 1).padStart(3)}  ${String(a.score).padStart(3)}  ${a.stage.padEnd(11)} ${a.domain}`));
    out(`Spent ${usd(result.spentMicros)} of ${usd(capMicros)} cap.${result.pendingCalls ? ` ${result.pendingCalls} calls pending, run again to collect them without a second charge.` : ""}${result.skippedByCap ? ` ${result.skippedByCap} calls skipped by the cap.` : ""}${result.failedCalls ? ` ${result.failedCalls} calls failed.` : ""}`);
    if (result.skippedByBudget) out(`${result.skippedByBudget} calls skipped. ${result.budgetMessage ?? ""}`);
    if (result.aborted) out(result.aborted);
    for (const w of written) out(`Wrote ${w}`);
    return result.aborted ? 1 : 0;
  } catch (e) {
    out(`Error: ${(e as Error).message}`);
    return 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
