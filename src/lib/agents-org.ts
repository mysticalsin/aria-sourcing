/* ============================================================================
   TAnIA Agent Org — two-tier taxonomy (Coordinator + 6 Managers + sub-agents).
   Pure data + types, no React. Powers the /architecture trust surface.

   The org is deliberately honest: each Manager "fronts" real functions that
   already exist in the app (sourcing, campaigns, outreach queue, candidates,
   calendar, reports, memory / #Vivier). The guardrails below encode the
   "Human Always Decides" contract — the actions TAnIA never takes alone.
   Ref: "TAnIA Architecture & Candidate Journey" v6.0 (Mantu / Amaris).
   ========================================================================== */

import type { LeadSource, TaniaStage } from "./types";

/** Design-token colour families available to the org viz (globals.css). */
export type OrgColor =
  | "electric"
  | "violet"
  | "tangerine"
  | "aqua"
  | "mantu-yellow"
  | "success";

/** A sub-agent's scope — a specific lead source, or "All" (cross-source). */
export type SubAgentSource = LeadSource | "All";

export interface SubAgent {
  name: string;
  whatItDoes: string;
  /** Optional scope tag. Specific sources render a SourceBadge; "All" a chip. */
  source?: SubAgentSource;
  /** Roadmap item, not live yet. */
  future?: boolean;
}

export interface ManagerAgent {
  id: string;
  name: string;
  /** Human label for the funnel scope, e.g. "Stage 0 + I — LEADS". */
  stageScope: string;
  /** One-line mission. */
  mission: string;
  /** Design-token colour (distinct per manager). */
  color: OrgColor;
  /** Honest, light note on which existing app function this manager fronts. */
  poweredBy: string;
  /** Funnel stages this manager touches (drives the legend). */
  stages: TaniaStage[];
  /** True when the manager operates across the whole funnel (#Vivier). */
  crossStage?: boolean;
  subAgents: SubAgent[];
}

export interface Coordinator {
  id: string;
  name: string;
  role: string;
  mission: string;
  /** Which part of the app the coordinator maps to. */
  mapsTo: string;
  /** Operating principles — how it behaves, always. */
  principles: string[];
}

/** A single sentence for the header — the whole page in one line. */
export const HUMAN_PRINCIPLE =
  "Human Always Decides. TAnIA does the work; the recruiter makes every call that touches a person, a brand, or a contract.";

/* ---- Tier 1 — the Coordinator -------------------------------------------- */

export const COORDINATOR: Coordinator = {
  id: "coordinator",
  name: "TAnIA Coordinator",
  role: "Orchestrator",
  mission:
    "The single orchestrator. It reads each lead's source and funnel stage, routes the work to the right manager, and holds the line on human sign-off.",
  mapsTo: "Maps to Aria's master brain and guardrails (see Soul).",
  principles: [
    "Knows every lead's source and funnel stage before it acts.",
    "Delegates each task to the right manager — it never freelances.",
    "Always confirms with the recruiter before anything leaves the building.",
  ],
};

/* ---- Tier 2 — the six Managers ------------------------------------------- */

export const MANAGERS: ManagerAgent[] = [
  {
    id: "sourcing-lead",
    name: "Sourcing & Lead Manager",
    stageScope: "Stage 0 + I — LEADS",
    mission:
      "Turns a validated need into a live job ad and a qualified stream of leads across every source.",
    color: "electric",
    poweredBy: "Fronts the Sourcing agent + the Campaigns workspace.",
    stages: ["Need", "Leads"],
    subAgents: [
      {
        name: "Job Offer Creator",
        whatItDoes: "Drafts the job ad and runs the Knight M brand check before it goes live.",
      },
      {
        name: "Sourcing Planner",
        whatItDoes: "Designs the search strategy — boolean strings and semantic queries per role.",
      },
      {
        name: "Database Scout",
        whatItDoes: "Sweeps the SMART DB and Cvtheque across every source for existing matches.",
        source: "All",
      },
      {
        name: "Lead Agent",
        whatItDoes: "Identifies outbound targets worth headhunting.",
        source: "Outbound",
      },
      {
        name: "Job Offer Manager",
        whatItDoes: "Monitors live ads and recommends when to close one.",
      },
    ],
  },
  {
    id: "candidate-intelligence",
    name: "Candidate Intelligence Manager",
    stageScope: "Stage I → II — QUALIFY",
    mission:
      "Assesses each lead against the brief and turns raw applicants into ranked, prequal-ready candidates.",
    color: "violet",
    poweredBy: "Fronts the Candidates workspace + match scoring.",
    stages: ["Leads", "Candidates"],
    subAgents: [
      {
        name: "Applicant Screener",
        whatItDoes: "Screens inbound applications against the brief.",
        source: "Applicant",
      },
      {
        name: "Referral Evaluator",
        whatItDoes: "Assesses referred candidates with extra care.",
        source: "Referral",
      },
      {
        name: "Lead Candidate Assessor",
        whatItDoes: "Qualifies headhunted leads before outreach.",
        source: "Outbound",
      },
      {
        name: "Job Fit Assessor",
        whatItDoes: "Builds a comparative scorecard across the shortlist.",
        source: "All",
      },
      {
        name: "Prequal Call Prep",
        whatItDoes: "Preps the 5 prequal questions, a tone guide and the post-call form.",
      },
    ],
  },
  {
    id: "process",
    name: "Process Manager",
    stageScope: "Stages I → III — KEEP IT MOVING",
    mission:
      "Watches the whole pipeline so nothing stalls — surfaces the next step and chases missing feedback.",
    color: "aqua",
    poweredBy: "Fronts the Command Center attention cards + SLA timers.",
    stages: ["Leads", "Candidates", "Offered"],
    subAgents: [
      {
        name: "Pipeline Monitor",
        whatItDoes: "Daily scan for candidates with no feedback, stalled, or overdue.",
      },
      {
        name: "Next Step Advisor",
        whatItDoes: "Recommends the next move — Intw1/2/3, QM, offer or reject.",
      },
      {
        name: "Follow-up Agent",
        whatItDoes: "Drafts a T+48h nudge and escalates at T+5d.",
      },
      {
        name: "HM Feedback Tracker",
        whatItDoes: "Sends the post-interview form and reminds the HM at T+24h.",
      },
      {
        name: "Job Offer Monitor",
        whatItDoes: "Tracks ad volume and quality and flags close recommendations.",
      },
    ],
  },
  {
    id: "candidate-experience",
    name: "Candidate Experience Expert",
    stageScope: "Stages I → III — EVERY TOUCH",
    mission:
      "Owns how every candidate feels — the right message, the right tone, at the right moment.",
    color: "tangerine",
    poweredBy: "Fronts the Outreach approval queue + Replies.",
    stages: ["Leads", "Candidates", "Offered"],
    subAgents: [
      {
        name: "Outreach Agent",
        whatItDoes: "Writes outreach in the right tone per source, for batch approval.",
      },
      {
        name: "Keep Warm Agent",
        whatItDoes: "Sends status updates and alerts when HM feedback is missing.",
      },
      {
        name: "Rejection Agent",
        whatItDoes: "Individual notes for referrals, batched for applicants.",
      },
      {
        name: "Interview Reminders",
        whatItDoes: "Reminders at T-24h and T-1h.",
      },
      {
        name: "Status Comms",
        whatItDoes: "Candidate-facing updates at every step.",
      },
    ],
  },
  {
    id: "onboarding",
    name: "Onboarding Manager",
    stageScope: "Stages III → IV — LAND WELL",
    mission:
      "Carries a signed offer through to a settled new joiner — registration, pre-boarding and the first months.",
    color: "success",
    poweredBy: "Fronts Calendar bookings + the Reports close-out.",
    stages: ["Offered", "Employees"],
    subAgents: [
      {
        name: "SMART Registration Bot",
        whatItDoes: "Registers the hire in SMART.",
      },
      {
        name: "Offered Candidate Agent",
        whatItDoes: "Prepares the offer letter and package.",
      },
      {
        name: "Pre-boarding Coordinator",
        whatItDoes: "Runs the checklist and moves the candidate to the employee portal.",
      },
      {
        name: "Need Closure Agent",
        whatItDoes: "Files the post-fill report and closes the need.",
      },
      {
        name: "OneStart Liaison",
        whatItDoes: "Books the TA buddy calls at 1, 3 and 6 months.",
      },
    ],
  },
  {
    id: "talent-pool",
    name: "Talent Pool & Community Manager",
    stageScope: "#Vivier — CROSS-STAGE",
    mission:
      "Keeps every strong near-miss warm and re-engages the talent community when a new fit opens.",
    color: "mantu-yellow",
    poweredBy: "Fronts the Candidates #Vivier filter + Memory.",
    stages: ["Leads", "Candidates", "Offered", "Employees"],
    crossStage: true,
    subAgents: [
      {
        name: "Silver Medalist Tracker",
        whatItDoes: "Keeps strong near-misses visible for the next role.",
      },
      {
        name: "Re-contact Agent",
        whatItDoes: "Reaches back out to pooled talent when a fit opens.",
      },
      {
        name: "Warm Pipeline Alert",
        whatItDoes: "Signals when a pooled candidate matches a new need.",
      },
      {
        name: "Community Manager Bot",
        whatItDoes: "Nurtures the wider talent community.",
        future: true,
      },
      {
        name: "DNA Extractor",
        whatItDoes: "Extracts skills and traits to enrich the pool's DNA.",
      },
    ],
  },
];

/* ---- The "Human Always Decides" contract --------------------------------- */

export interface GatedAction {
  /** The action TAnIA never takes alone. */
  action: string;
  /** One line on why a human owns it. */
  why: string;
}

/** Six actions TAnIA never does alone — always recruiter-gated. */
export const NEVER_ALONE: GatedAction[] = [
  {
    action: "Run a search",
    why: "A live search spends sourcing credits and shapes the whole funnel — the recruiter picks the strategy first.",
  },
  {
    action: "Contact a lead",
    why: "Every first touch carries the Mantu brand — a human approves the message and the target.",
  },
  {
    action: "Send a rejection",
    why: "A 'no' lands on a real person and the employer brand — it is reviewed, never automated.",
  },
  {
    action: "Make a prequal or interview decision",
    why: "Advancing or holding a candidate is a hiring judgement that stays with the recruiter and hiring manager.",
  },
  {
    action: "Send or sign an offer",
    why: "An offer is a legal and financial commitment — only a human can issue or sign it.",
  },
  {
    action: "Register a hire",
    why: "Creating an employee record touches payroll and systems of record — a person confirms it.",
  },
];

export interface GuardrailException {
  action: string;
  why: string;
  /** The safeguards that keep the exception safe. */
  safeguards: string[];
}

/** The single exception — still recruiter-confirmed, always pooled. */
export const GATED_EXCEPTION: GuardrailException = {
  action: "Auto-reject on a self-declared hard disqualifier (Applicants only)",
  why: "When an applicant states a non-negotiable blocker — no obtainable work authorisation, or unwilling to relocate for an on-site-only role — TAnIA may pre-file the rejection to save the recruiter time.",
  safeguards: [
    "Applicants only — never referrals or outbound leads.",
    "The recruiter still confirms before it sends.",
    "The candidate is always added to #Vivier.",
  ],
};
