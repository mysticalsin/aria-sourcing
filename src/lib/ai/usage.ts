/* ============================================================================
   Claude spend ledger and budget gate (server-only, no content stored).

   Every Anthropic response reports its token usage. We price it, keep running
   totals for the current UTC day and month, and refuse new calls once a cap is
   reached; callers then use their deterministic fallback, so the app keeps
   working without AI.

   Caps (USD, server env): AI_MONTHLY_BUDGET_USD (default 30) and
   AI_DAILY_BUDGET_USD (default 6, so one heavy demo day cannot spend the month).

   The totals live in this server instance's memory and restart from zero with
   the process. This is a soft guard; the hard ceiling is the spend limit set
   on the Anthropic workspace in the Console.
   ========================================================================== */

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

export function estimateCostUsd(model: string, usage: AnthropicUsage | null | undefined): number {
  if (!usage) return 0;
  const price = PRICE_PER_MTOK[model] ?? FALLBACK_PRICE;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
  return (
    (n(usage.input_tokens) * price.input +
      n(usage.cache_creation_input_tokens) * price.input * 1.25 +
      n(usage.cache_read_input_tokens) * price.cacheRead +
      n(usage.output_tokens) * price.output) /
    1_000_000
  );
}

interface Ledger {
  month: string;
  day: string;
  monthUsd: number;
  dayUsd: number;
  calls: number;
}

const LEDGER_KEY = Symbol.for("aria.ai.usageLedger");

function ledger(now: Date): Ledger {
  const store = globalThis as unknown as Record<symbol, Ledger | undefined>;
  const day = now.toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  let current = store[LEDGER_KEY];
  if (!current || current.month !== month) {
    current = { month, day, monthUsd: 0, dayUsd: 0, calls: 0 };
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
  console.info(
    JSON.stringify({
      event: "ai_usage",
      task: entry.task,
      model: entry.model,
      inputTokens: entry.usage?.input_tokens ?? 0,
      outputTokens: entry.usage?.output_tokens ?? 0,
      cacheReadTokens: entry.usage?.cache_read_input_tokens ?? 0,
      costUsd: Number(cost.toFixed(6)),
      monthUsd: Number(current.monthUsd.toFixed(4)),
    }),
  );
  return cost;
}

export function resetAiUsageForTests(): void {
  delete (globalThis as unknown as Record<symbol, Ledger | undefined>)[LEDGER_KEY];
}
