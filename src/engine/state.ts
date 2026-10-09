import fs from "node:fs";
import path from "node:path";
import type { RunResult, Snapshots } from "./types";

export interface State {
  /** The latest run. */
  run: RunResult | null;
  /** The last reading of each growth metric per account, for the next run to compare against. */
  snapshots: Snapshots;
}

/** Where results are kept: LOOOT_INTENT_DIR, or .looot-intent in the working directory. */
export function stateFile(env: Record<string, string | undefined> = process.env): string {
  return path.resolve(env.LOOOT_INTENT_DIR ?? ".looot-intent", "state.json");
}

/** Reads the saved state. An empty state when there is none or the file is unreadable. */
export function readState(file: string = stateFile()): State {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<State>;
    return { run: raw.run ?? null, snapshots: raw.snapshots ?? {} };
  } catch {
    return { run: null, snapshots: {} };
  }
}

/** Writes the state next to the previous one, through a temp file so a crash cannot leave half a file. */
export function writeState(state: State, file: string = stateFile()): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, file);
}
