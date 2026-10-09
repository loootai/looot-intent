import { loadConfig, type IntentConfig } from "@/engine/config";
import { DEMO_DOMAINS, DEMO_ICP, DEMO_NOW, demoRunner, demoSnapshots } from "@/engine/demo";
import { buildQuote, parseDomains, runIntent } from "@/engine/engine";
import { fetchPrices, hasLoootToken, loootFromEnv } from "@/engine/looot";
import { toMicros } from "@/engine/money";
import { FALLBACK_PRICES } from "@/engine/signals";
import { readState, writeState, type State } from "@/engine/state";
import type { Quote, RunResult } from "@/engine/types";

/** true when the app runs on sample data: no token, no network, no cost. */
export function isDemo(): boolean {
  return process.env.LOOOT_INTENT_DEMO === "1";
}

export function canRunLive(): boolean {
  return hasLoootToken();
}

declare global {
  var __intentDemoState: State | undefined;
}

/** The config the app scores with. The demo swaps in the sample ICP. */
export function appConfig(): IntentConfig {
  const cfg = loadConfig(process.env.LOOOT_INTENT_CONFIG);
  if (isDemo()) cfg.icp.description = DEMO_ICP;
  return cfg;
}

/** The latest run. In demo mode it is computed once from the sample accounts and kept in memory. */
export async function getState(): Promise<State> {
  if (!isDemo()) return readState();
  if (!globalThis.__intentDemoState) {
    const { result, snapshots } = await runIntent({ config: appConfig(), domains: DEMO_DOMAINS, looot: demoRunner(), prices: FALLBACK_PRICES, capMicros: 5_000_000, snapshots: demoSnapshots(), now: DEMO_NOW, demo: true });
    globalThis.__intentDemoState = { run: result, snapshots };
  }
  return globalThis.__intentDemoState;
}

export interface QuoteReply {
  quote: Quote;
  rejected: string[];
  domains: string[];
  unpriced: string[];
}

/** Quote for a pasted domain list. Reads prices from the public catalog (free) unless in demo mode. */
export async function quoteFor(domainText: string): Promise<QuoteReply> {
  const { domains, rejected } = parseDomains(domainText);
  const cfg = appConfig();
  if (isDemo()) return { quote: buildQuote(domains, cfg, FALLBACK_PRICES, "catalog"), rejected, domains, unpriced: [] };
  const live = await fetchPrices(FALLBACK_PRICES);
  return { quote: buildQuote(domains, cfg, live.prices, live.source), rejected, domains, unpriced: live.unread };
}

/** Runs the engine for the UI and saves the result. The UI never sees the token. */
export async function runFor(input: { domains: string; icp?: string; capUsd: number }): Promise<RunResult> {
  const { domains } = parseDomains(input.domains);
  if (domains.length === 0) throw new Error("No valid domains.");
  if (domains.length > 500) throw new Error("At most 500 domains per run.");
  const cfg = appConfig();
  if (input.icp?.trim()) cfg.icp.description = input.icp.trim();
  const capMicros = toMicros(input.capUsd);
  if (isDemo()) {
    const { result, snapshots } = await runIntent({ config: cfg, domains, looot: demoRunner(), prices: FALLBACK_PRICES, capMicros, snapshots: globalThis.__intentDemoState?.snapshots ?? demoSnapshots(), now: DEMO_NOW, demo: true });
    globalThis.__intentDemoState = { run: result, snapshots };
    return result;
  }
  const looot = loootFromEnv();
  const live = await fetchPrices(FALLBACK_PRICES);
  const quote = buildQuote(domains, cfg, live.prices, live.source);
  if (quote.totalMicros > capMicros) throw new Error(`The quote ($${(quote.totalMicros / 1e6).toFixed(2)}) is above the cap ($${input.capUsd.toFixed(2)}). Raise the cap or score fewer accounts.`);
  const state = readState();
  const { result, snapshots } = await runIntent({ config: cfg, domains, looot, prices: live.prices, priceSource: live.source, unpriced: live.unread, capMicros, snapshots: state.snapshots });
  writeState({ run: result, snapshots });
  return result;
}
