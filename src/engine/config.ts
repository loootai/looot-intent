import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import type { SignalId } from "./types";

const SignalConfig = z.object({
  enabled: z.boolean(),
  /** Relative weight. The weights of the enabled signals are scaled to add up to 100 points. */
  weight: z.number().min(0),
  /** Days after which an event counts half as much. */
  halfLifeDays: z.number().positive(),
  /**
   * Event signals: the weighted event count that earns the full points.
   * Snapshot metrics: the growth between two runs (0.1 is 10%) that earns the full points.
   * Direct metrics: the share of keywords moving up net of down that earns the full points.
   */
  saturation: z.number().positive(),
});

const SIGNAL_IDS = ["hiring", "funding", "news", "tech", "seo", "traffic", "ads_google", "ads_linkedin", "social_reddit", "headcount", "intent_topics"] as const;

export const ConfigSchema = z.object({
  icp: z.object({
    description: z.string(),
    /** Words that make a job ad count fully. Empty means every ad counts fully. */
    jobTitleKeywords: z.array(z.string()),
    /** Technologies that make a detection count fully. Empty means every recent detection counts fully. */
    technologies: z.array(z.string()),
    /** News categories that count fully. Other categories count at 40%. */
    newsCategories: z.array(z.string()),
  }),
  stages: z.object({
    aware: z.number().min(0).max(100),
    considering: z.number().min(0).max(100),
    deciding: z.number().min(0).max(100),
    /** A score in the deciding band needs this many categories showing real signal, or the stage stays considering. */
    decidingMinCategories: z.number().int().min(1),
  }),
  /** A category counts as showing signal when its strength is at least this. */
  activeStrength: z.number().min(0).max(1),
  /** Calls use the same idempotency key inside one window, so a re-run in the window replays and never charges twice. */
  freshnessWindow: z.enum(["day", "week", "month"]),
  concurrency: z.number().int().min(1).max(16),
  signals: z.object(Object.fromEntries(SIGNAL_IDS.map((id) => [id, SignalConfig])) as Record<SignalId, typeof SignalConfig>),
});

export type IntentConfig = z.infer<typeof ConfigSchema>;

/** Where the config lives unless --config says otherwise. */
export const DEFAULT_CONFIG_PATH = "config/intent.config.json";

/** Reads and validates a config file. Throws a readable error naming the bad field. */
export function loadConfig(file: string = DEFAULT_CONFIG_PATH): IntentConfig {
  const abs = path.resolve(file);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (e) {
    throw new Error(`Cannot read config ${file}: ${(e as Error).message}`);
  }
  return parseConfig(raw, file);
}

/** Validates a config object. */
export function parseConfig(raw: unknown, label = "config"): IntentConfig {
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Invalid ${label}: ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  }
  const c = parsed.data;
  if (!(c.stages.aware <= c.stages.considering && c.stages.considering <= c.stages.deciding)) throw new Error(`Invalid ${label}: stages must satisfy aware <= considering <= deciding`);
  return c;
}
