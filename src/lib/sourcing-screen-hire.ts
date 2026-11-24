import { createFakeOdooFetch, type RecordedOdooCall } from "@/lib/fake-odoo";
import { fetchPublicUrl } from "@/lib/api/public-fetch";
import {
  connectorRuntimeConfigured,
  hireEnvForRoute,
  runSourcingThroughHired,
  type SourcingThroughHiredStep,
} from "@/lib/mcp-client";

/**
 * Sourcing screens call the same hire function as POST /api/hire.
 * With no live connector configured, the call stays on the in-repo fake Odoo.
 * A complete runtime connector uses the public HTTPS transport. No host is guessed.
 */
export const SOURCING_SCREENS = ["search", "shortlist", "candidate", "command"] as const;
export type SourcingScreen = (typeof SOURCING_SCREENS)[number];

export interface SourcingScreenHireInput {
  screen: SourcingScreen;
  idempotencyKey: string;
  job: { name: string; department?: string };
  applicant: { name: string; email?: string };
  stage: string;
}

export interface SourcingScreenHireResult {
  ok: boolean;
  erp: "odoo" | "smart" | "api" | "mcp" | "skipped";
  linkedIn: boolean;
  screen: SourcingScreen;
  transport: "fake" | "live";
  steps: SourcingScreenHireStep[];
  vacancyClose: unknown;
  vacancyKwargs: unknown;
  hrJobStateSent: boolean;
  error?: string;
}

export interface SourcingScreenHireStep {
  action: SourcingThroughHiredStep["action"];
  model: string;
  method: string;
  ok: boolean;
  id?: string;
  skipped?: boolean;
  reason?: string;
}

type HireFetch = (url: string, init?: RequestInit) => Promise<Response>;

const FAKE_ODOO_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  ODOO_URL: "https://odoo.example.test/",
  ODOO_DB: "fixture",
  ODOO_USERNAME: "fixture-api",
  ODOO_API_KEY: "fixture-key",
};

function shownStep(step: SourcingThroughHiredStep): SourcingScreenHireStep {
  return {
    action: step.action,
    model: step.model,
    method: step.method,
    ok: step.ok,
    id: step.id,
    skipped: step.skipped,
    reason: step.reason,
  };
}

function rpcBodies(calls: RecordedOdooCall[]) {
  return calls.map(
    (call) => JSON.parse(String(call.init?.body ?? "{}")) as { params?: { method?: string; args?: unknown[] } },
  );
}

function hasStateKey(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => hasStateKey(item));
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => key === "state" || hasStateKey(child));
}

function vacancyFacts(calls: RecordedOdooCall[]): { close: unknown; kwargs: unknown; stateSent: boolean } {
  const bodies = rpcBodies(calls);
  const write = bodies.find(
    (body) => body.params?.method === "execute_kw" && body.params.args?.[3] === "hr.job" && body.params.args?.[4] === "write",
  );
  const stateSent = bodies.some((body) => hasStateKey(body.params?.args?.[5]) || hasStateKey(body.params?.args?.[6]));
  return {
    close: write?.params?.args?.[5] ?? null,
    kwargs: write?.params?.args?.[6] ?? null,
    stateSent,
  };
}

export function isSourcingScreen(value: string): value is SourcingScreen {
  return (SOURCING_SCREENS as readonly string[]).includes(value);
}

export async function hireFromSourcingScreen(
  input: SourcingScreenHireInput,
  env: NodeJS.ProcessEnv = process.env,
  liveFetch: HireFetch = fetchPublicUrl,
): Promise<SourcingScreenHireResult> {
  if (!isSourcingScreen(input.screen)) {
    return {
      ok: false,
      erp: "skipped",
      linkedIn: true,
      screen: "command",
      transport: "fake",
      steps: [],
      vacancyClose: null,
      vacancyKwargs: null,
      hrJobStateSent: false,
      error: "Unknown sourcing screen.",
    };
  }
  const payload = {
    idempotencyKey: input.idempotencyKey,
    job: input.job,
    applicant: input.applicant,
    stage: input.stage,
  };
  if (!connectorRuntimeConfigured(env)) {
    const fake = createFakeOdooFetch();
    const hired = await runSourcingThroughHired(payload, FAKE_ODOO_ENV, fake.fetch);
    const vacancy = vacancyFacts(fake.calls);
    return {
      ok: hired.ok,
      erp: hired.erp,
      linkedIn: hired.linkedIn,
      screen: input.screen,
      transport: "fake",
      steps: hired.steps.map(shownStep),
      vacancyClose: vacancy.close,
      vacancyKwargs: vacancy.kwargs,
      hrJobStateSent: vacancy.stateSent,
      error: hired.error,
    };
  }
  const hired = await runSourcingThroughHired(payload, hireEnvForRoute(env, false), liveFetch);
  return {
    ok: hired.ok,
    erp: hired.erp,
    linkedIn: hired.linkedIn,
    screen: input.screen,
    transport: "live",
    steps: hired.steps.map(shownStep),
    vacancyClose: null,
    vacancyKwargs: null,
    hrJobStateSent: false,
    error: hired.error,
  };
}
