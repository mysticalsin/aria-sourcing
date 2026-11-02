/* ============================================================================
   Claude spend ledger and budget gate (server-only, no content stored).

   Every Anthropic response reports its token usage. We price it, keep running
   totals for the current UTC day and month (overall and per task + model),
   and refuse new calls once a cap is reached; callers then use their
   deterministic fallback, so the app keeps working without AI.

   Caps (USD, server env): AI_MONTHLY_BUDGET_USD (default 30) and
   AI_DAILY_BUDGET_USD (default 6, so one heavy demo day cannot spend the month).

   The cap is about the Anthropic key, which is global to the server, so the
   ledger is too. It is kept in memory and written through to a small JSON
   file so a restart does not reset it: AI_USAGE_FILE, else /app/config (the
   container's durable volume) when present, else var/ in the working tree.
   Persistence is best effort; on a read-only disk the totals stay in memory.
   The hard ceiling remains the spend limit set on the Anthropic workspace.
   ========================================================================== */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface Price {
  input: number;
  output: number;
  cacheRead: number;
}

/** USD per million tokens. Cache writes cost 1.25x input. Unknown ids are
 *  priced as Opus so an unlisted model can only overestimate. */
const PRICE_PER_MTOK: Record<string, Price> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
};
const FALLBACK_PRICE: Price = { input: 5, output: 25, cacheRead: 0.5 };

export const DEFAULT_MONTHLY_BUDGET_USD = 30;
export const DEFAULT_DAILY_BUDGET_USD = 6;

const tokens = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

export function estimateCostUsd(model: string, usage: AnthropicUsage | null | undefined): number {
  if (!usage) return 0;
  const price = PRICE_PER_MTOK[model] ?? FALLBACK_PRICE;
  return (
    (tokens(usage.input_tokens) * price.input +
      tokens(usage.cache_creation_input_tokens) * price.input * 1.25 +
      tokens(usage.cache_read_input_tokens) * price.cacheRead +
      tokens(usage.output_tokens) * price.output) /
    1_000_000
  );
}

export interface TaskUsage {
  task: string;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
}

interface Ledger {
  month: string;
  day: string;
  monthUsd: number;
  dayUsd: number;
  calls: number;
  /** Month-to-date, keyed "task model". */
  byTask: Record<string, TaskUsage>;
}

const LEDGER_KEY = Symbol.for("aria.ai.usageLedger");
type LedgerStore = Record<symbol, Ledger | undefined>;

export function usageFilePath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.AI_USAGE_FILE?.trim()) return env.AI_USAGE_FILE.trim();
  if (existsSync("/app/config")) return "/app/config/ai-usage.json";
  return path.join(process.cwd(), "var", "ai-usage.json");
}

function readPersisted(file: string): Ledger | undefined {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<Ledger>;
    if (typeof raw.month !== "string" || typeof raw.day !== "string") return undefined;
    return {
      month: raw.month,
      day: raw.day,
      monthUsd: tokens(raw.monthUsd),
      dayUsd: tokens(raw.dayUsd),
      calls: tokens(raw.calls),
      byTask: raw.byTask && typeof raw.byTask === "object" ? raw.byTask : {},
    };
  } catch {
    return undefined;
  }
}

/** Write-then-rename so a crash never leaves a half-written file. */
function persist(ledgerValue: Ledger): boolean {
  if (process.env.AI_USAGE_PERSIST === "off") return false;
  const file = usageFilePath();
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(ledgerValue));
    renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

function ledger(now: Date): Ledger {
  const store = globalThis as unknown as LedgerStore;
  const day = now.toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  let current = store[LEDGER_KEY];
  if (!current && process.env.AI_USAGE_PERSIST !== "off") current = readPersisted(usageFilePath());
  if (!current || current.month !== month) {
    current = { month, day, monthUsd: 0, dayUsd: 0, calls: 0, byTask: {} };
  } else if (current.day !== day) {
    current = { ...current, day, dayUsd: 0 };
  }
  store[LEDGER_KEY] = current;
  return current;
}

function capFromEnv(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return raw !== undefined && raw.trim() !== "" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

export interface AiBudgetStatus {
  ok: boolean;
  reason?: string;
  monthUsd: number;
  dayUsd: number;
  monthlyLimitUsd: number;
  dailyLimitUsd: number;
}

export function aiBudgetStatus(now = new Date(), env: NodeJS.ProcessEnv = process.env): AiBudgetStatus {
  const current = ledger(now);
  const monthlyLimitUsd = capFromEnv(env.AI_MONTHLY_BUDGET_USD, DEFAULT_MONTHLY_BUDGET_USD);
  const dailyLimitUsd = capFromEnv(env.AI_DAILY_BUDGET_USD, DEFAULT_DAILY_BUDGET_USD);
  const base = { monthUsd: current.monthUsd, dayUsd: current.dayUsd, monthlyLimitUsd, dailyLimitUsd };
  if (current.monthUsd >= monthlyLimitUsd) return { ok: false, reason: "Monthly AI budget reached.", ...base };
  if (current.dayUsd >= dailyLimitUsd) return { ok: false, reason: "Daily AI budget reached.", ...base };
  return { ok: true, ...base };
}

/** Add one response's usage to the ledger and log it (task, model, tokens,
 *  cost only). Returns the call's estimated cost in USD. */
export function recordAiUsage(
  entry: { task: string; model: string; usage: AnthropicUsage | null | undefined },
  now = new Date(),
): number {
  const cost = estimateCostUsd(entry.model, entry.usage);
  const current = ledger(now);
  current.monthUsd += cost;
  current.dayUsd += cost;
  current.calls += 1;
  const key = `${entry.task} ${entry.model}`;
  const row = (current.byTask[key] ??= {
    task: entry.task,
    model: entry.model,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    costUsd: 0,
  });
  row.calls += 1;
  row.inputTokens += tokens(entry.usage?.input_tokens);
  row.outputTokens += tokens(entry.usage?.output_tokens);
  row.cacheReadTokens += tokens(entry.usage?.cache_read_input_tokens);
  row.costUsd += cost;
  persist(current);
  console.info(
    JSON.stringify({
      event: "ai_usage",
      task: entry.task,
      model: entry.model,
      inputTokens: tokens(entry.usage?.input_tokens),
      outputTokens: tokens(entry.usage?.output_tokens),
      cacheReadTokens: tokens(entry.usage?.cache_read_input_tokens),
      costUsd: Number(cost.toFixed(6)),
      monthUsd: Number(current.monthUsd.toFixed(4)),
    }),
  );
  return cost;
}

export interface AiUsageReport extends AiBudgetStatus {
  month: string;
  day: string;
  calls: number;
  byTask: TaskUsage[];
}

/** Month-to-date snapshot for the admin usage panel. */
export function aiUsageReport(now = new Date(), env: NodeJS.ProcessEnv = process.env): AiUsageReport {
  const status = aiBudgetStatus(now, env);
  const current = ledger(now);
  return {
    ...status,
    month: current.month,
    day: current.day,
    calls: current.calls,
    byTask: Object.values(current.byTask).sort((a, b) => b.costUsd - a.costUsd),
  };
}

export function resetAiUsageForTests(): void {
  delete (globalThis as unknown as LedgerStore)[LEDGER_KEY];
}
