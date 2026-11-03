/* ============================================================================
   Claude spend ledger and budget gate (server-only, no content stored).

   Every Anthropic response reports its token usage. We price it, keep running
   totals for the current UTC day and month (overall, per task + model and per
   business activity), and refuse new calls once a cap is reached; callers
   then use their deterministic fallback, so the app keeps working without AI.
   A day and month history feeds the AI costs page.

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
import { defaultActivityForTask, isAiActivity, type AiActivity } from "./activities";

export interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  /** Server tools run at Anthropic; web search is billed per search. */
  server_tool_use?: { web_search_requests?: number };
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
/** USD per web search, on top of the tokens that read its results. */
export const WEB_SEARCH_PRICE_USD = 0.01;

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
      1_000_000 +
    tokens(usage.server_tool_use?.web_search_requests) * WEB_SEARCH_PRICE_USD
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

/** Month-to-date spend for one business activity (see activities.ts). */
export interface ActivityUsage {
  activity: AiActivity;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  /** Calls per model id, to show which tier the activity really used. */
  models: Record<string, number>;
}

export interface DayUsage {
  costUsd: number;
  calls: number;
  /** Cost per activity id. */
  byActivity: Record<string, number>;
}

interface Ledger {
  month: string;
  day: string;
  monthUsd: number;
  dayUsd: number;
  calls: number;
  /** Month-to-date, keyed "task model". */
  byTask: Record<string, TaskUsage>;
  /** Month-to-date, keyed by activity id. */
  byActivity: Record<string, ActivityUsage>;
  /** Day history across months (UTC "YYYY-MM-DD"), pruned to HISTORY_DAYS. */
  days: Record<string, DayUsage>;
  /** Month totals across months ("YYYY-MM"), the current one included. */
  months: Record<string, { costUsd: number; calls: number }>;
}

const HISTORY_DAYS = 92;
const HISTORY_MONTHS = 12;

const LEDGER_KEY = Symbol.for("aria.ai.usageLedger");
type LedgerStore = Record<symbol, Ledger | undefined>;

export function usageFilePath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.AI_USAGE_FILE?.trim()) return env.AI_USAGE_FILE.trim();
  if (existsSync("/app/config")) return "/app/config/ai-usage.json";
  return path.join(process.cwd(), "var", "ai-usage.json");
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function readPersisted(file: string): Ledger | undefined {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<Ledger>;
    if (typeof raw.month !== "string" || typeof raw.day !== "string") return undefined;
    const ledgerValue: Ledger = {
      month: raw.month,
      day: raw.day,
      monthUsd: tokens(raw.monthUsd),
      dayUsd: tokens(raw.dayUsd),
      calls: tokens(raw.calls),
      byTask: isRecord(raw.byTask) ? (raw.byTask as Record<string, TaskUsage>) : {},
      byActivity: isRecord(raw.byActivity) ? (raw.byActivity as Record<string, ActivityUsage>) : {},
      days: isRecord(raw.days) ? (raw.days as Record<string, DayUsage>) : {},
      months: isRecord(raw.months) ? (raw.months as Record<string, { costUsd: number; calls: number }>) : {},
    };
    // A file written before activities existed: keep its totals, honestly
    // labelled, so the month still adds up.
    if (!isRecord(raw.byActivity) && ledgerValue.monthUsd > 0) {
      const rows = Object.values(ledgerValue.byTask);
      ledgerValue.byActivity.untracked = {
        activity: "untracked",
        calls: ledgerValue.calls,
        inputTokens: rows.reduce((sum, r) => sum + tokens(r.inputTokens), 0),
        outputTokens: rows.reduce((sum, r) => sum + tokens(r.outputTokens), 0),
        cacheReadTokens: rows.reduce((sum, r) => sum + tokens(r.cacheReadTokens), 0),
        costUsd: ledgerValue.monthUsd,
        models: Object.fromEntries(rows.map((r) => [r.model, tokens(r.calls)])),
      };
      ledgerValue.days[ledgerValue.day] ??= {
        costUsd: ledgerValue.dayUsd,
        // The old format kept no per-day call count; when the whole month
        // happened today, the month count is today's.
        calls: ledgerValue.dayUsd === ledgerValue.monthUsd ? ledgerValue.calls : 0,
        byActivity: { untracked: ledgerValue.dayUsd },
      };
    }
    ledgerValue.months[ledgerValue.month] ??= { costUsd: ledgerValue.monthUsd, calls: ledgerValue.calls };
    return ledgerValue;
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

function pruneHistory(ledgerValue: Ledger, now: Date): void {
  const oldestDay = new Date(now.getTime() - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
  for (const day of Object.keys(ledgerValue.days)) if (day < oldestDay) delete ledgerValue.days[day];
  const months = Object.keys(ledgerValue.months).sort();
  for (const month of months.slice(0, Math.max(0, months.length - HISTORY_MONTHS))) delete ledgerValue.months[month];
}

function ledger(now: Date): Ledger {
  const store = globalThis as unknown as LedgerStore;
  const day = now.toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  let current = store[LEDGER_KEY];
  if (!current && process.env.AI_USAGE_PERSIST !== "off") current = readPersisted(usageFilePath());
  if (!current || current.month !== month) {
    // New month: the running totals restart, the history carries over.
    current = {
      month,
      day,
      monthUsd: 0,
      dayUsd: 0,
      calls: 0,
      byTask: {},
      byActivity: {},
      days: current?.days ?? {},
      months: current?.months ?? {},
    };
    pruneHistory(current, now);
  } else if (current.day !== day) {
    current = { ...current, day, dayUsd: 0 };
    pruneHistory(current, now);
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

/** Add one response's usage to the ledger and log it (task, activity, model,
 *  tokens, cost only). Returns the call's estimated cost in USD. */
export function recordAiUsage(
  entry: { task: string; model: string; usage: AnthropicUsage | null | undefined; activity?: AiActivity },
  now = new Date(),
): number {
  const cost = estimateCostUsd(entry.model, entry.usage);
  const activity = isAiActivity(entry.activity) ? entry.activity : defaultActivityForTask(entry.task);
  const inputTokens = tokens(entry.usage?.input_tokens);
  const outputTokens = tokens(entry.usage?.output_tokens);
  const cacheReadTokens = tokens(entry.usage?.cache_read_input_tokens);
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
  row.inputTokens += inputTokens;
  row.outputTokens += outputTokens;
  row.cacheReadTokens += cacheReadTokens;
  row.costUsd += cost;

  const act = (current.byActivity[activity] ??= {
    activity,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    costUsd: 0,
    models: {},
  });
  act.calls += 1;
  act.inputTokens += inputTokens;
  act.outputTokens += outputTokens;
  act.cacheReadTokens += cacheReadTokens;
  act.costUsd += cost;
  act.models[entry.model] = (act.models[entry.model] ?? 0) + 1;

  const dayRow = (current.days[current.day] ??= { costUsd: 0, calls: 0, byActivity: {} });
  dayRow.costUsd += cost;
  dayRow.calls += 1;
  dayRow.byActivity[activity] = (dayRow.byActivity[activity] ?? 0) + cost;
  const monthRow = (current.months[current.month] ??= { costUsd: 0, calls: 0 });
  monthRow.costUsd += cost;
  monthRow.calls += 1;

  persist(current);
  console.info(
    JSON.stringify({
      event: "ai_usage",
      task: entry.task,
      activity,
      model: entry.model,
      inputTokens,
      outputTokens,
      cacheReadTokens,
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
  /** Most expensive first. */
  byActivity: ActivityUsage[];
  /** The last 30 UTC days, oldest first, zero-filled. */
  daily: ({ day: string } & DayUsage)[];
  /** Up to 12 months, oldest first, the current one included. */
  months: { month: string; costUsd: number; calls: number }[];
  /** Month-to-date spend extended at the same daily pace to month end. */
  projectedMonthUsd: number;
  /** First day with recorded history, or null when nothing was spent yet. */
  trackedSince: string | null;
}

/** Month-to-date snapshot for the AI costs page and the Settings usage card. */
export function aiUsageReport(now = new Date(), env: NodeJS.ProcessEnv = process.env): AiUsageReport {
  const status = aiBudgetStatus(now, env);
  const current = ledger(now);
  const daily = Array.from({ length: 30 }, (_, i) => {
    const day = new Date(now.getTime() - (29 - i) * 86_400_000).toISOString().slice(0, 10);
    const row = current.days[day];
    return { day, costUsd: row?.costUsd ?? 0, calls: row?.calls ?? 0, byActivity: { ...(row?.byActivity ?? {}) } };
  });
  const dayOfMonth = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const trackedDays = Object.keys(current.days).sort();
  return {
    ...status,
    month: current.month,
    day: current.day,
    calls: current.calls,
    byTask: Object.values(current.byTask).sort((a, b) => b.costUsd - a.costUsd),
    byActivity: Object.values(current.byActivity).sort((a, b) => b.costUsd - a.costUsd),
    daily,
    months: Object.entries(current.months)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, row]) => ({ month, costUsd: row.costUsd, calls: row.calls })),
    projectedMonthUsd: (current.monthUsd / dayOfMonth) * daysInMonth,
    trackedSince: trackedDays[0] ?? null,
  };
}

export function resetAiUsageForTests(): void {
  delete (globalThis as unknown as LedgerStore)[LEDGER_KEY];
}
