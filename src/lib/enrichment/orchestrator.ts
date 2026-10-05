// Server-only waterfall orchestrator for the unified enrichment engine
// (docs/superpowers/plans/2026-07-15-enrichment-orchestrator.md, "Waterfall
// orchestrator"). Ties the registry (enrichment/registry.ts), the runners
// (enrichment/runners.ts) and the merge logic (enrichment/merge.ts) together:
// given a candidate and a set of wanted fields, it runs every eligible
// provider — cheapest first — until the fields are covered, the providers are
// exhausted, the budget runs out, or a wall-clock deadline is hit (see
// ORCH_DEADLINE_MS below), then re-scores the candidate.

import type { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/server";
import type { Candidate, EnrichableField, EnrichmentAttempt, JobAnalysis, ScoringWeights, SourcePlatform } from "@/lib/types";
import { ENRICHMENT_PROVIDERS } from "@/lib/enrichment/registry";
import { computeCoverage, mergeEnrichment, recordEnrichmentAttempt } from "@/lib/enrichment/merge";
import { apolloRunner, devFusionRunner, githubTechStackRunner, POLL_BUDGET_MS, seamlessRunner, sillageRunner, type EnrichmentRunner } from "@/lib/enrichment/runners";
import { scoreCandidate } from "@/lib/scoring";

/** Wall-clock budget for the whole waterfall, well under the platform's 60s
 *  route cap (vercel.json's `maxDuration`) — a request that ran right up to
 *  60s would 504 and strand every already-spent cheap-provider result with
 *  no response ever reaching the client. Checked before invoking EVERY
 *  provider (not just the slow ones): once exceeded, nothing further runs. */
const ORCH_DEADLINE_MS = 45_000;

/** Providers whose runner is a bounded async poller (Seamless research,
 *  Sillage account mapping) rather than a single fast request/response call —
 *  these are the ones that can still burn most of `POLL_BUDGET_MS` before
 *  reporting back, so they need their own pre-flight runway check in
 *  addition to the shared hard deadline below. */
const SLOW_POLL_PROVIDERS: ReadonlySet<SourcePlatform> = new Set(["Seamless", "Sillage"]);

type Session = NonNullable<Awaited<ReturnType<typeof getServerSupabase>>>;

type BudgetClaim =
  | { ok: true; ledgerId: string }
  | { ok: false; reason: string };

async function resolveWorkspaceId(session: Session): Promise<string | null> {
  const result = await session.rpc("current_workspace_id");
  return typeof result.data === "string" && result.data ? result.data : null;
}

async function claimProviderBudget(
  workspaceId: string,
  provider: SourcePlatform,
  candidateId: string,
  amount: number,
): Promise<BudgetClaim> {
  if (amount <= 0) return { ok: true, ledgerId: "" };
  const svc = getServiceSupabase();
  if (!svc) return { ok: false, reason: "budget_authority_unavailable" };
  const period = new Date().toISOString().slice(0, 7);
  const idempotencyKey = `enrich:${candidateId}:${provider}:${new Date().toISOString()}`;
  const claim = await svc.rpc("claim_enrichment_budget", {
    p_workspace_id: workspaceId,
    p_period: period,
    p_idempotency_key: idempotencyKey,
    p_amount_cents: amount,
    p_provider: provider,
  });
  const body = claim.data as { allowed?: boolean; reason?: string; ledger_id?: string } | null;
  if (claim.error || body?.allowed !== true || typeof body.ledger_id !== "string") {
    return { ok: false, reason: body?.reason ?? claim.error?.code ?? "budget_refused" };
  }
  return { ok: true, ledgerId: body.ledger_id };
}

async function settleProviderBudget(ledgerId: string, amount: number): Promise<void> {
  if (!ledgerId) return;
  const svc = getServiceSupabase();
  await svc?.rpc("settle_enrichment_spend", { p_ledger_id: ledgerId, p_actual_cents: Math.max(0, amount) });
}

async function releaseProviderBudget(ledgerId: string): Promise<void> {
  if (!ledgerId) return;
  const svc = getServiceSupabase();
  await svc?.rpc("release_enrichment_claim", { p_ledger_id: ledgerId });
}

/** One server-only runner per registry provider id. A registry entry with no
 *  matching runner here is simply never invoked (defensive — every provider
 *  the design calls for is wired below). */
const RUNNERS: Partial<Record<SourcePlatform, EnrichmentRunner>> = {
  Apify: devFusionRunner,
  GitHub: githubTechStackRunner,
  Apollo: apolloRunner,
  Seamless: seamlessRunner,
  Sillage: sillageRunner,
};

export interface OrchestrateEnrichmentInput {
  session: Session;
  candidate: Candidate;
  /** Fields the caller wants filled — the waterfall stops once every one of
   *  these is covered, even if other providers could still run. */
  want: EnrichableField[];
  /** Spend budget in registry cost units, shared across every provider call
   *  in this run. A provider is skipped (not_configured-style, recorded as
   *  `"budget_exceeded"`) once this hits zero rather than ever going negative. */
  budgetRemaining: number;
  /** Campaign job analysis + weights for the final `scoreCandidate` pass.
   *  Optional: omit when the caller doesn't have the campaign loaded (e.g. a
   *  bare candidate-key enrich call) — the candidate is still enriched, just
   *  not re-scored. */
  jd?: JobAnalysis;
  weights?: ScoringWeights;
}

export interface OrchestrateEnrichmentResult {
  candidate: Candidate;
  attempts: EnrichmentAttempt[];
  /** Total cost units actually spent across every provider call this run. */
  spend: number;
}

/** `want` fields not yet present on the candidate, per the same coverage rule
 *  `mergeEnrichment` uses (homed fields read live off the candidate; the
 *  three homeless fields fall back to recorded provenance). */
function missingFields(candidate: Candidate, want: EnrichableField[]): EnrichableField[] {
  const coverage = new Set(computeCoverage(candidate));
  return want.filter((field) => !coverage.has(field));
}

/** Replace the most recently appended attempt's `costUnits`/`detail` with the
 *  runner's own reported values. `mergeEnrichment` always records `costUnits:
 *  0` on its attempt (it only knows about fields, not spend) and never sees a
 *  runner's `detail` (e.g. Seamless/Sillage's "pending") — this reconciles the
 *  ledger with what the provider actually reported, immutably. */
function patchLastAttempt(candidate: Candidate, patch: Partial<Pick<EnrichmentAttempt, "costUnits" | "detail">>): Candidate {
  const enrichment = candidate.enrichment;
  if (!enrichment || enrichment.attempts.length === 0) return candidate;
  const attempts = [...enrichment.attempts];
  const last = attempts.length - 1;
  attempts[last] = { ...attempts[last], ...patch };
  return { ...candidate, enrichment: { ...enrichment, attempts } };
}

/**
 * Run the cross-provider enrichment waterfall for one candidate. Selects
 * every registered provider that (a) can fill at least one `want` field and
 * (b) can resolve an identity for this candidate (`keyField(candidate) !=
 * null`), orders them cheapest-first, then runs each in turn — merging real
 * results into the candidate, recording every attempt whether it filled data
 * or not, and stopping early once `want` is fully covered, the budget is
 * spent, or the wall-clock deadline (`ORCH_DEADLINE_MS`) is reached. A
 * provider skipped for time is recorded as `"deferred"` rather than run —
 * this keeps the whole request comfortably under the platform's 60s route
 * cap and never throws away an earlier, already-spent provider's result to
 * do it: only providers that haven't started yet are ever deferred. Never
 * throws: every runner is itself defensive, and a missing runner for a
 * registry entry is simply skipped.
 */
export async function orchestrateEnrichment(input: OrchestrateEnrichmentInput): Promise<OrchestrateEnrichmentResult> {
  const { session, want, jd, weights } = input;
  let candidate = input.candidate;
  let budgetRemaining = input.budgetRemaining;
  const attempts: EnrichmentAttempt[] = [];
  let spend = 0;
  const start = Date.now();
  const workspaceId = await resolveWorkspaceId(session);

  const providers = ENRICHMENT_PROVIDERS.filter(
    (provider) => want.some((field) => provider.enriches.includes(field)) && provider.keyField(candidate) != null,
  ).sort((a, b) => a.costUnits - b.costUnits);

  for (const provider of providers) {
    const missing = missingFields(candidate, want);
    if (missing.length === 0) break;
    if (!missing.some((field) => provider.enriches.includes(field))) continue; // an earlier provider already covered everything this one offers

    const at = new Date().toISOString();

    // Time-budget gate — checked before touching this provider at all, so a
    // provider skipped here never starts a single network call. A slow async
    // poller (Seamless, Sillage) is deferred as soon as the remaining runway
    // can't cover its own worst-case poll budget, even if the overall
    // deadline hasn't technically passed yet — starting it anyway would just
    // run it into the hard cutoff mid-poll for no benefit. Cheap/sync
    // providers already ran and returned before this check ever stops them;
    // nothing already spent is lost, only not-yet-started work is deferred.
    const elapsed = Date.now() - start;
    const remaining = ORCH_DEADLINE_MS - elapsed;
    const isSlowPoller = SLOW_POLL_PROVIDERS.has(provider.id);
    if (elapsed >= ORCH_DEADLINE_MS || (isSlowPoller && remaining < POLL_BUDGET_MS)) {
      const attempt: EnrichmentAttempt = {
        provider: provider.id,
        at,
        status: "deferred",
        fieldsFilled: [],
        costUnits: 0,
        detail: "time budget — re-run to continue",
      };
      candidate = recordEnrichmentAttempt(candidate, attempt);
      attempts.push(attempt);
      continue;
    }

    if (budgetRemaining <= 0) {
      const attempt: EnrichmentAttempt = { provider: provider.id, at, status: "budget_exceeded", fieldsFilled: [], costUnits: 0 };
      candidate = recordEnrichmentAttempt(candidate, attempt);
      attempts.push(attempt);
      continue;
    }

    const runner = RUNNERS[provider.id];
    if (!runner) continue;

    if (!workspaceId) {
      const attempt: EnrichmentAttempt = {
        provider: provider.id,
        at,
        status: "error",
        fieldsFilled: [],
        costUnits: 0,
        detail: "workspace authority unavailable",
      };
      candidate = recordEnrichmentAttempt(candidate, attempt);
      attempts.push(attempt);
      continue;
    }

    const claim = await claimProviderBudget(workspaceId, provider.id, candidate.id, provider.costUnits);
    if (!claim.ok) {
      const attempt: EnrichmentAttempt = {
        provider: provider.id,
        at,
        status: "budget_exceeded",
        fieldsFilled: [],
        costUnits: 0,
        detail: claim.reason,
      };
      candidate = recordEnrichmentAttempt(candidate, attempt);
      attempts.push(attempt);
      continue;
    }

    const result = await runner(session, candidate);

    if (result.externalId) {
      candidate = { ...candidate, externalIds: { ...candidate.externalIds, [provider.id]: result.externalId } };
    }

    if (result.status === "ok") {
      candidate = mergeEnrichment(candidate, provider.id, result.fields, at);
      candidate = patchLastAttempt(candidate, { costUnits: result.costUnits, detail: result.detail });
    } else {
      const attempt: EnrichmentAttempt = {
        provider: provider.id,
        at,
        status: result.status,
        fieldsFilled: [],
        costUnits: result.costUnits,
        detail: result.detail,
      };
      candidate = recordEnrichmentAttempt(candidate, attempt);
    }

    attempts.push(candidate.enrichment!.attempts[candidate.enrichment!.attempts.length - 1]);
    if (result.status === "ok" || result.status === "no_data") await settleProviderBudget(claim.ledgerId, result.costUnits);
    else await releaseProviderBudget(claim.ledgerId);
    budgetRemaining -= result.costUnits;
    spend += result.costUnits;
  }

  if (jd) {
    const { score, breakdown } = scoreCandidate(candidate, jd, weights);
    candidate = { ...candidate, matchScore: score, matchBreakdown: breakdown };
  }

  return { candidate, attempts, spend };
}
