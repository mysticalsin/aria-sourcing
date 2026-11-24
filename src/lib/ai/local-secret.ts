/* ============================================================================
   Local AI credentials file (`.secret` at the repo root, gitignored and kept
   out of the Docker build context).

   Lets a developer machine run the AI layer without writing .env.local. The
   file holds either a bare Anthropic key on its first line, or KEY=VALUE lines.
   Only the allow-listed variables below are read; anything else is ignored so
   the file can never smuggle arbitrary process configuration. A value already
   present in the real environment always wins.

   Node-only (fs). Loaded once at server start from src/instrumentation.ts.
   ========================================================================== */

import { readFileSync } from "node:fs";
import path from "node:path";

export const LOCAL_SECRET_FILE = ".secret";

export const LOCAL_SECRET_VARS = ["ANTHROPIC_API_KEY", "ANTHROPIC_WORKSPACE_ID"] as const;
export type LocalSecretVar = (typeof LOCAL_SECRET_VARS)[number];

/** Parse the file body. Never throws; unknown or malformed lines are dropped. */
export function parseLocalSecret(text: string): Partial<Record<LocalSecretVar, string>> {
  const out: Partial<Record<LocalSecretVar, string>> = {};
  const allowed = new Set<string>(LOCAL_SECRET_VARS);
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) {
      // A bare Anthropic key, as pasted straight from the console.
      if (/^sk-ant-[A-Za-z0-9_-]+$/.test(line) && !out.ANTHROPIC_API_KEY) out.ANTHROPIC_API_KEY = line;
      continue;
    }
    const name = line.slice(0, eq).trim().replace(/^export\s+/, "");
    const value = line.slice(eq + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
    if (allowed.has(name) && value) out[name as LocalSecretVar] = value;
  }
  return out;
}

/**
 * Copy the file's allow-listed values into `env` where they are not already
 * set. Returns the names applied (never the values). Missing file → [].
 */
export function applyLocalSecret(
  env: NodeJS.ProcessEnv = process.env,
  file = path.join(process.cwd(), LOCAL_SECRET_FILE),
): LocalSecretVar[] {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const applied: LocalSecretVar[] = [];
  for (const [name, value] of Object.entries(parseLocalSecret(text)) as [LocalSecretVar, string][]) {
    if (env[name]) continue;
    env[name] = value;
    applied.push(name);
  }
  return applied;
}
