import { createFakeOdooFetch, type RecordedOdooCall } from "@/lib/fake-odoo";
import { runSourcingThroughHired, type SourcingThroughHiredResult, type SourcingThroughHiredStep } from "@/lib/mcp-client";

/**
 * Fixture for the sourcing-to-hired demo. Names are labels, not people.
 * The run talks only to the in-repo fake Odoo. It does not call LinkedIn.
 */
export const SYNTHETIC_HIRE_FIXTURE = {
  idempotencyKey: "synthetic-fixture-hire",
  job: { name: "Fixture Platform Role", department: "Fixture Delivery" },
  applicant: { name: "Fixture Candidate North", email: "fixture.north@example.test" },
  stage: "Hired",
} as const;

export const SYNTHETIC_ODOO_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  ODOO_URL: "https://odoo.example.test/",
  ODOO_DB: "fixture",
  ODOO_USERNAME: "fixture-api",
  ODOO_API_KEY: "fixture-key",
};

export interface SyntheticHireDemo {
  fixture: {
    jobName: string;
    department: string;
    applicantName: string;
    email: string;
    provenance: "synthetic";
  };
  unset: {
    ok: boolean;
    erp: SourcingThroughHiredResult["erp"];
    linkedIn: boolean;
    steps: SourcingThroughHiredStep[];
    fetchCount: number;
  };
  hired: SourcingThroughHiredResult;
  /** Positional `execute_kw` args for the vacancy close, or null when it did not run. */
  vacancyClose: unknown;
  odooHosts: string[];
}

function rpcBodies(calls: RecordedOdooCall[]) {
  return calls.map(
    (call) => JSON.parse(String(call.init?.body ?? "{}")) as { params?: { method?: string; args?: unknown[] } },
  );
}

export async function runSyntheticHireDemo(): Promise<SyntheticHireDemo> {
  let unsetFetches = 0;
  const unset = await runSourcingThroughHired(
    SYNTHETIC_HIRE_FIXTURE,
    { NODE_ENV: "test" },
    (async () => {
      unsetFetches += 1;
      throw new Error("unset connector must not fetch");
    }) as typeof fetch,
  );

  const odoo = createFakeOdooFetch();
  const hired = await runSourcingThroughHired(SYNTHETIC_HIRE_FIXTURE, SYNTHETIC_ODOO_ENV, odoo.fetch);
  const vacancyClose =
    rpcBodies(odoo.calls).find(
      (body) => body.params?.method === "execute_kw" && body.params.args?.[3] === "hr.job" && body.params.args?.[4] === "write",
    )?.params?.args?.[5] ?? null;

  return {
    fixture: {
      jobName: SYNTHETIC_HIRE_FIXTURE.job.name,
      department: SYNTHETIC_HIRE_FIXTURE.job.department,
      applicantName: SYNTHETIC_HIRE_FIXTURE.applicant.name,
      email: SYNTHETIC_HIRE_FIXTURE.applicant.email,
      provenance: "synthetic",
    },
    unset: {
      ok: unset.ok,
      erp: unset.erp,
      linkedIn: unset.linkedIn,
      steps: unset.steps,
      fetchCount: unsetFetches,
    },
    hired,
    vacancyClose,
    odooHosts: odoo.calls.map((call) => call.url),
  };
}
