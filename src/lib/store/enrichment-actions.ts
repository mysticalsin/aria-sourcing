import type { Candidate, EnrichableField, EnrichmentAttempt, HermesState } from "../types";
import { candidateEnrichmentBlocker } from "../candidate-review";
import { enrichmentBasis, enrichmentOutcome, type EnrichmentPatch } from "../enrichment/result";
import { campaignSourcingBasis } from "../sourcing/unified-contract";

interface Dependencies {
  allowed(): boolean;
  scope(): string;
  current(): HermesState;
  persist(update: (state: HermesState) => HermesState): Promise<boolean>;
  fetch: typeof fetch;
  defaults: EnrichableField[];
  decorate(state: HermesState, candidate: Candidate, attempts: EnrichmentAttempt[], spend: number): HermesState;
}

export function createCandidateEnrichment(deps: Dependencies) {
  const pending = new Set<string>();
  // The shared workspace is a single optimistic-concurrency document. Serialize
  // enrichment transactions in this store so batch workers don't reject each
  // other's save-before-egress. This is not cross-process paid-call authority.
  let queue = Promise.resolve();
  return async (candidateId: string, opts?: { want?: EnrichableField[] }) => {
    const failure = (detail: string) => ({ ok: false, filled: [] as EnrichableField[], spend: 0, detail });
    if (!deps.allowed()) return failure("Enrichment requires an available live workspace and sourcing permission.");
    if (pending.has(candidateId)) return failure("Enrichment is already in progress for this candidate.");
    pending.add(candidateId);
    const scope = deps.scope();
    const previous = queue;
    let release!: () => void;
    queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      if (!deps.allowed() || deps.scope() !== scope) return failure("The workspace session changed before enrichment started. No provider request was made.");
      // Provider access must see the same saved evidence the recruiter reviewed.
      if (!(await deps.persist((state) => ({ ...state })))) return failure("Save or reload the workspace before enrichment. No provider request was made.");
      if (!deps.allowed() || deps.scope() !== scope) return failure("The workspace session changed while saving. No provider request was made.");
      const state = deps.current();
      const candidate = state.candidates.find((c) => c.id === candidateId);
      if (!candidate) return failure("Candidate not found.");
      const campaign = state.campaigns.find((c) => c.id === candidate.campaignId);
      const blocker = candidateEnrichmentBlocker(candidate, campaign);
      if (blocker || !campaign) return failure(blocker ?? "Campaign unavailable.");
      const basis = JSON.stringify(enrichmentBasis(candidate));
      const campaignBasis = JSON.stringify(campaignSourcingBasis(campaign));
      const want = opts?.want ?? deps.defaults;
      const cap = state.enrichmentBudgetUnits ?? 1000;
      const spent = (state.enrichmentLedger ?? []).reduce((sum, e) => sum + e.units, 0);
      const response = await deps.fetch("/api/source/enrich", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId, want, budgetRemaining: Math.max(0, cap - spent) }) });
      const out = await response.json().catch(() => null) as {
        ok?: boolean; patch?: EnrichmentPatch; attempts?: EnrichmentAttempt[]; spend?: number; error?: string;
      } | null;
      if (!response.ok || !out?.ok || !out.patch) return failure(out?.error ?? "Enrichment failed. Check the provider before retrying.");
      if (!deps.allowed() || deps.scope() !== scope) return failure("The workspace session changed. Reload and review before another paid request.");
      const patch = out.patch;
      const attempts = out.attempts ?? [];
      const spend = out.spend ?? 0;
      let applied = false;
      const persisted = await deps.persist((latest) => {
        const current = latest.candidates.find((c) => c.id === candidateId);
        const currentCampaign = latest.campaigns.find((c) => c.id === current?.campaignId);
        if (!current || !currentCampaign || candidateEnrichmentBlocker(current, currentCampaign)
          || JSON.stringify(enrichmentBasis(current)) !== basis
          || JSON.stringify(campaignSourcingBasis(currentCampaign)) !== campaignBasis
          || JSON.stringify(latest.skills) !== JSON.stringify(state.skills)) return latest;
        applied = true;
        const next = { ...latest, candidates: latest.candidates.map((c) => c.id === candidateId ? { ...c, ...patch } : c),
          enrichmentLedger: [...(latest.enrichmentLedger ?? []), ...attempts.map((a) => ({ provider: a.provider, candidateId, units: a.costUnits, at: a.at }))] };
        return deps.decorate(next, candidate, attempts, spend);
      });
      if (!persisted || !applied) return { ok: false, filled: [] as EnrichableField[], spend,
        detail: "Provider request finished, but the results were not saved because the workspace changed or saving failed. Reload and review before another paid request." };
      return { ...enrichmentOutcome(attempts), spend };
    } catch {
      return failure("Enrichment was interrupted. Check the provider and workspace before another paid request; no automatic retry was made.");
    } finally {
      pending.delete(candidateId);
      release();
    }
  };
}
