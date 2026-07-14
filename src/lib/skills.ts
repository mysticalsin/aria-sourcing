import type {
  AgentSkill,
  AgentSkillParams,
  Candidate,
  HermesState,
  OutreachTone,
  ScoringWeights,
  SkillKey,
  SkillUpdate,
  SourcePlatform,
} from "./types";
import { OUTREACH_TONES } from "./types";
import { genId, round } from "./utils";
import { stageRank } from "./metrics";

/* ============================================================================
   ARIA SKILLS — the agent's editable, versioned playbooks. The agent learns
   from real sourcing outcomes: it analyses what actually converted, proposes
   concrete changes, and (on accept) updates the skill params, which feed back
   into scoring, outreach, sourcing and reply classification.
   ========================================================================== */

export const SKILL_ORDER: SkillKey[] = [
  "outreach_skill",
  "sourcing_skill",
  "scoring_skill",
  "reply_classification_skill",
];

export function defaultSkills(now = new Date("2026-06-26T09:00:00Z").toISOString()): AgentSkill[] {
  return [
    {
      key: "outreach_skill",
      filename: "outreach_skill.md",
      title: "Outreach composition",
      description: "How Aria writes first-touch and follow-up messages.",
      content: [
        "# Outreach skill",
        "",
        "- Lead with the candidate's most recent concrete work, not the company pitch.",
        "- One specific personalization point minimum; reference real profile data.",
        "- Lead with value, soft CTA, never the ask first.",
        "- Respect tone selection; keep messages short and human.",
        "- Never send the same message twice; always dry-run until approved.",
      ].join("\n"),
      version: 1,
      params: { preferredTone: "Casual Professional", leadWithArtifact: true },
      metrics: { applied: 0, outcomeSignal: 0 },
      updatedAt: now,
      history: [{ version: 1, summary: "Initial playbook", at: now }],
    },
    {
      key: "sourcing_skill",
      filename: "sourcing_skill.md",
      title: "Sourcing strategy",
      description: "Where and how Aria finds candidates.",
      content: [
        "# Sourcing skill",
        "",
        "- Build platform-specific queries from required skills + geo.",
        "- Prefer platforms where the role's signal is strongest (code → GitHub).",
        "- Dedupe ruthlessly; respect excluded + current companies.",
        "- Official APIs only; never scrape or bypass login walls or rate limits.",
      ].join("\n"),
      version: 1,
      params: { preferredPlatforms: ["GitHub", "LinkedIn"] },
      metrics: { applied: 0, outcomeSignal: 0 },
      updatedAt: now,
      history: [{ version: 1, summary: "Initial playbook", at: now }],
    },
    {
      key: "scoring_skill",
      filename: "scoring_skill.md",
      title: "Candidate scoring",
      description: "How Aria weights the composite match score.",
      content: [
        "# Scoring skill",
        "",
        "- Composite of skills, experience, company-stage, industry, location, activity.",
        "- Skills dominate; experience second. Re-weight as outcomes teach us.",
        "- Candidates below the contact floor are never approved for outreach.",
      ].join("\n"),
      version: 1,
      params: { weights: {} },
      metrics: { applied: 0, outcomeSignal: 0 },
      updatedAt: now,
      history: [{ version: 1, summary: "Initial playbook", at: now }],
    },
    {
      key: "reply_classification_skill",
      filename: "reply_classification_skill.md",
      title: "Reply classification",
      description: "How Aria reads and routes replies.",
      content: [
        "# Reply classification skill",
        "",
        "- INTERESTED > 0.85, QUALIFIED_INTEREST 0.70–0.85, NEGATIVE > 0.80.",
        "- Salary/comp questions count as qualified interest, not unclear.",
        "- NEGATIVE → stop immediately, suppress, escalate. OOO → pause sequence.",
        "- 15-minute SLA on hot replies.",
      ].join("\n"),
      version: 1,
      params: { qualifiedInterestFloor: 0.7 },
      metrics: { applied: 0, outcomeSignal: 0 },
      updatedAt: now,
      history: [{ version: 1, summary: "Initial playbook", at: now }],
    },
  ];
}

export function getSkill(skills: AgentSkill[], key: SkillKey): AgentSkill | undefined {
  return skills.find((s) => s.key === key);
}

/* ---- Outcome analysis (the "experience" Aria learns from) --------------- */

export interface OutcomeAnalysis {
  toneRates: { tone: OutreachTone; sent: number; positive: number; rate: number }[];
  bestTone: OutreachTone | null;
  topDimension: { key: keyof ScoringWeights; avg: number } | null;
  unclearRate: number;
  converted: number; // candidates that reached Interested+
  contacted: number;
}

export function analyzeOutcomes(state: HermesState): OutcomeAnalysis {
  const candById = new Map(state.candidates.map((c) => [c.id, c]));

  // tone → conversion (a sent message whose candidate later showed positive intent)
  const toneAgg = new Map<OutreachTone, { sent: number; positive: number }>();
  for (const t of OUTREACH_TONES) toneAgg.set(t, { sent: 0, positive: 0 });
  for (const msg of state.outreach) {
    if (msg.status !== "Scheduled" && msg.status !== "Approved") continue;
    const agg = toneAgg.get(msg.tone);
    if (!agg) continue;
    agg.sent += 1;
    const cand = candById.get(msg.candidateId);
    if (cand && stageRank(cand.stage) >= 3 && cand.stage !== "Not Interested") agg.positive += 1;
  }
  const toneRates = OUTREACH_TONES.map((tone) => {
    const a = toneAgg.get(tone)!;
    return { tone, sent: a.sent, positive: a.positive, rate: a.sent ? a.positive / a.sent : 0 };
  });
  const eligible = toneRates.filter((t) => t.sent >= 3);
  const bestTone = eligible.length
    ? eligible.reduce((best, t) => (t.rate > best.rate ? t : best)).tone
    : null;

  // which score dimension is strongest among converters
  const converters = state.candidates.filter(
    (c) => stageRank(c.stage) >= 3 && c.stage !== "Not Interested",
  );
  const dimSum = new Map<keyof ScoringWeights, { sum: number; n: number }>();
  for (const c of converters) {
    for (const b of c.matchBreakdown) {
      const cur = dimSum.get(b.key) ?? { sum: 0, n: 0 };
      cur.sum += b.score;
      cur.n += 1;
      dimSum.set(b.key, cur);
    }
  }
  let topDimension: OutcomeAnalysis["topDimension"] = null;
  for (const [key, v] of dimSum) {
    const avg = v.n ? v.sum / v.n : 0;
    if (!topDimension || avg > topDimension.avg) topDimension = { key, avg: round(avg) };
  }

  const totalReplies = state.replies.length || 1;
  const unclearRate = state.replies.filter((r) => r.intent === "UNCLEAR").length / totalReplies;

  return {
    toneRates,
    bestTone,
    topDimension,
    unclearRate,
    converted: converters.length,
    contacted: state.candidates.filter((c) => stageRank(c.stage) >= 1).length,
  };
}

/* ---- Proposals (concrete, data-backed) ----------------------------------- */

function rankedWinTones(state: HermesState): { tone: OutreachTone; wins: number }[] {
  const counts = new Map<OutreachTone, number>();
  for (const win of state.wins ?? []) {
    const tone = win.messageTraits.tone;
    if (!tone) continue;
    counts.set(tone, (counts.get(tone) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tone, wins]) => ({ tone, wins }))
    .sort((a, b) => b.wins - a.wins);
}

function rankedWinPlatforms(state: HermesState): SourcePlatform[] {
  const counts = new Map<SourcePlatform, number>();
  for (const win of state.wins ?? []) {
    counts.set(win.sourcePlatform, (counts.get(win.sourcePlatform) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([platform]) => platform);
}

export function proposeSkillUpdates(state: HermesState): SkillUpdate[] {
  const a = analyzeOutcomes(state);
  const now = new Date().toISOString();
  const out: SkillUpdate[] = [];

  if (a.bestTone) {
    const cur = getSkill(state.skills, "outreach_skill")?.params.preferredTone ?? "Casual Professional";
    if (a.bestTone !== cur) {
      const r = a.toneRates.find((t) => t.tone === a.bestTone)!;
      out.push(mk("outreach_skill", `Default to a ${a.bestTone.toLowerCase()} tone`,
        `${a.bestTone} converted ${(r.rate * 100).toFixed(0)}% of ${r.sent} sends, the best of the tested tones.`,
        `Default tone: ${cur}.`, `Default tone: ${a.bestTone}.`, "+ projected reply lift", now));
    }
  }
  if (a.topDimension && a.topDimension.key !== "skills") {
    out.push(mk("scoring_skill", `Increase the weight of "${a.topDimension.key}"`,
      `Converters average ${a.topDimension.avg} on ${a.topDimension.key}, under-weighted today.`,
      `Standard weights.`, `Nudge ${a.topDimension.key} up by ~6 points.`, "Better recall on real converters", now));
  } else {
    out.push(mk("scoring_skill", "Hold scoring weights",
      "Skills remains the strongest predictor of conversion: keep it dominant.",
      "Skills weight 34%.", "Skills weight 34% (held).", "Stable precision", now));
  }
  if (a.unclearRate > 0.15) {
    out.push(mk("reply_classification_skill", "Lower the qualified-interest floor",
      `${(a.unclearRate * 100).toFixed(0)}% of replies landed UNCLEAR: too many hot leads to manual review.`,
      "Qualified-interest floor 0.70.", "Qualified-interest floor 0.66.", "Fewer hot leads lost", now));
  }
  out.push(mk("sourcing_skill", "Lead queries with the top required skill",
    "First-skill-led queries surfaced the highest-scoring candidates this cycle.",
    "Balanced multi-skill queries.", "Top-skill-led queries first.", "Higher top-of-funnel quality", now));

  return out;
}

function mk(skill: SkillKey, title: string, rationale: string, before: string, after: string, impact: string, at: string): SkillUpdate {
  return { id: genId("skill"), skill, title, rationale, before, after, impact, status: "proposed", createdAt: at };
}

/* ---- Applying a learning (the feedback into behavior) --------------------- */

/** Compute the empirically-best params for a skill from current outcomes. */
export function learnedParamsFor(key: SkillKey, state: HermesState): AgentSkillParams {
  const a = analyzeOutcomes(state);
  const winTones = rankedWinTones(state);
  const bestWinTone = winTones[0]?.wins >= 2 ? winTones[0].tone : null;
  const winPlatforms = rankedWinPlatforms(state).slice(0, 3);
  switch (key) {
    case "outreach_skill":
      return { preferredTone: bestWinTone ?? a.bestTone ?? "Casual Professional", leadWithArtifact: true };
    case "scoring_skill": {
      const cur = getSkill(state.skills, "scoring_skill")?.params.weights ?? {};
      if (a.topDimension && a.topDimension.key !== "skills") {
        return { weights: { ...cur, [a.topDimension.key]: (cur[a.topDimension.key] ?? defaultWeight(a.topDimension.key)) + 6 } };
      }
      return { weights: cur };
    }
    case "reply_classification_skill":
      return { qualifiedInterestFloor: a.unclearRate > 0.15 ? 0.66 : 0.7 };
    case "sourcing_skill":
      return {
        preferredPlatforms:
          winPlatforms.length > 0
            ? winPlatforms
            : getSkill(state.skills, "sourcing_skill")?.params.preferredPlatforms ?? ["GitHub", "LinkedIn"],
      };
    default:
      return {};
  }
}

function defaultWeight(key: keyof ScoringWeights): number {
  const d: ScoringWeights = { skills: 34, experience: 22, companyStage: 12, industry: 12, location: 10, activity: 10 };
  return d[key];
}

/** Return a new skill version with params merged + a history entry. */
export function applyLearning(skill: AgentSkill, patch: AgentSkillParams, summary: string): AgentSkill {
  const now = new Date().toISOString();
  const version = skill.version + 1;
  return {
    ...skill,
    version,
    params: { ...skill.params, ...patch, weights: { ...skill.params.weights, ...patch.weights } },
    metrics: { applied: skill.metrics.applied + 1, outcomeSignal: round(skill.metrics.outcomeSignal + 0.5, 1) },
    updatedAt: now,
    content: `${skill.content}\n\n<!-- v${version} (${now.slice(0, 10)}): ${summary} -->`,
    history: [{ version, summary, at: now }, ...skill.history],
  };
}

/** Effective scoring weights = base defaults overlaid with the learned scoring skill. */
export function effectiveWeights(base: ScoringWeights, skills: AgentSkill[]): ScoringWeights {
  const learned = getSkill(skills, "scoring_skill")?.params.weights ?? {};
  return { ...base, ...learned };
}

export function effectiveTone(skills: AgentSkill[], fallback: OutreachTone = "Casual Professional"): OutreachTone {
  return getSkill(skills, "outreach_skill")?.params.preferredTone ?? fallback;
}
