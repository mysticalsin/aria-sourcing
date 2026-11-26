// ARIA <-> Odoo integration (ADR 0003, docs/odoo.md): the JSON-2 client, the
// pure mapping, the Odoo operations, and the routes against an in-memory Odoo
// and an in-memory service-role database. Synthetic data only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mock, test } from "node:test";
import { NextRequest } from "next/server";
import { buildSeedState } from "../src/lib/seed";
import type { WorkspaceState } from "../src/lib/types";

const url = (path: string) => new URL(`../${path}`, import.meta.url).href;

/* ---- In-memory Odoo (JSON-2) ---------------------------------------------- */

type Row = Record<string, unknown>;
const ODOO = "https://odoo.test";
const ODOO_KEY = "odoo-test-key-0123456789";

/** PostgreSQL ILIKE, as Odoo's "=ilike" runs it: % and _ are wildcards, \ escapes. */
function ilike(actual: string, pattern: string): boolean {
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!;
    if (char === "\\" && i + 1 < pattern.length) source += pattern[++i]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    else if (char === "%") source += ".*";
    else if (char === "_") source += ".";
    else source += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`, "is").test(actual);
}

function odooNow(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString().slice(0, 19).replace("T", " ");
}

function m2o(id: unknown, names: Map<number, string>): unknown {
  return typeof id === "number" && id > 0 ? [id, names.get(id) ?? `#${id}`] : false;
}

class FakeOdoo {
  major = 20;
  calls: { model: string; method: string; body: Row }[] = [];
  hosts: string[] = [];
  failWith: { model: string; method: string; status: number } | null = null;
  stages = [
    { id: 1, name: "New", sequence: 0, hired_stage: false },
    { id: 2, name: "Qualification", sequence: 1, hired_stage: false },
    { id: 3, name: "First Interview", sequence: 2, hired_stage: false },
    { id: 5, name: "Contract Proposal", sequence: 4, hired_stage: false },
    { id: 6, name: "Contract Signed", sequence: 5, hired_stage: true },
  ];
  jobs: Row[] = [
    { id: 7, name: "Murex Support", description: "<p>Front <b>office</b> support</p><ul><li>Murex</li></ul>", requirements: "5 years", department_id: 2, no_of_recruitment: 1, recruiter_id: 4, active: true, skill_ids: [11], application_count: 0 },
    { id: 8, name: "Archived role", active: false, skill_ids: [] },
  ];
  applicants: Row[] = [];
  sources: Row[] = [];
  notes: { applicantId: number; body: string; html: boolean }[] = [];
  refuseReasons = new Map([[6, "Refused by applicant: salary"], [1, "Does not fit the job requirements"]]);
  hasCandidateModel = false;
  partners: Row[] = [];
  privacyLog: Row[] = [];
  automations: Row[] = [];
  down = false;
  automationForbidden = false;
  privacyLogForbidden = false;
  private nextId = 100;

  creates(model: string): number {
    return this.calls.filter((c) => c.model === model && c.method === "create").length;
  }

  private names(): Map<number, string> {
    return new Map<number, string>([
      [2, "Finance"],
      [4, "Lisa Recruiter"],
      ...this.stages.map((s) => [s.id, s.name] as [number, string]),
      ...this.jobs.map((j) => [j.id as number, j.name as string] as [number, string]),
      ...this.sources.map((s) => [s.id as number, s.name as string] as [number, string]),
      ...[...this.refuseReasons].map(([id, name]) => [id, name] as [number, string]),
      ...this.partners.map((p) => [p.id as number, p.name as string] as [number, string]),
      [2, "ARIA Integration"],
      [3, "Someone Else"],
    ]);
  }

  private match(row: Row, domain: unknown[], activeTest: boolean): boolean {
    if (activeTest && row.active === false) return false;
    return domain.every((clause) => {
      const [field, op, value] = clause as [string, string, unknown];
      const actual = row[field];
      if (op === "=") return actual === value;
      if (op === "=ilike") return typeof actual === "string" && typeof value === "string" && ilike(actual, value);
      if (op === "in") return Array.isArray(value) && value.includes(actual);
      throw new Error(`fake odoo: unsupported operator ${op}`);
    });
  }

  private read(rows: Row[], fields: string[] | undefined): Row[] {
    const names = this.names();
    const many2one = new Set(["department_id", "recruiter_id", "stage_id", "job_id", "source_id", "refuse_reason_id", "partner_id", "create_uid"]);
    return rows.map((row) => {
      const out: Row = { id: row.id };
      for (const field of fields ?? Object.keys(row)) out[field] = many2one.has(field) ? m2o(row[field], names) : (row[field] ?? false);
      return out;
    });
  }

  private answer(model: string, method: string, body: Row): [number, unknown] {
    const activeTest = (body.context as Row | undefined)?.active_test !== false;
    const domain = (body.domain as unknown[]) ?? [];
    const key = `${model}/${method}`;
    switch (key) {
      case "res.users/context_get":
        return [200, { lang: "en_US", uid: 2 }];
      case "res.users/read":
        return [200, [{ id: 2, name: "ARIA Integration" }]];
      case "ir.model/search_count":
        return [200, 1];
      case "hr.recruitment.stage/search_read":
        return [200, this.stages];
      case "hr.job/fields_get":
        return [200, Object.fromEntries(["name", "description", "requirements", "department_id", "no_of_recruitment", "recruiter_id", "skill_ids", "application_count", "active"].map((f) => [f, { type: "char" }]))];
      case "hr.job/search_read":
        return [200, this.read(this.jobs.filter((j) => this.match(j, domain, activeTest)), body.fields as string[])];
      case "hr.skill/read":
        return [200, [{ id: 11, name: "Murex" }]];
      case "hr.employee/read":
        return [200, [{ id: 4, work_email: "lisa.recruiter@example.com" }]];
      case "hr.applicant/fields_get": {
        const fields: Row = Object.fromEntries(
          ["partner_name", "email_from", "partner_phone", "linkedin_profile", "job_id", "source_id", "priority", "stage_id", "application_status", "refuse_reason_id", "active", "partner_id", "employee_id", "create_date", "create_uid"].map((f) => [f, { type: "char", required: false }]),
        );
        if (this.hasCandidateModel) fields.candidate_id = { type: "many2one", required: true };
        return [200, fields];
      }
      case "utm.source/search":
        return [200, this.sources.filter((s) => this.match(s, domain, true)).map((s) => s.id)];
      case "utm.source/create": {
        const id = this.nextId++;
        this.sources.push({ id, ...((body.vals_list as Row[])[0]) });
        return [200, [id]];
      }
      case "hr.applicant/search":
        return [200, this.applicants.filter((a) => this.match(a, domain, activeTest)).map((a) => a.id).slice(0, (body.limit as number) ?? 1000)];
      case "hr.applicant/create": {
        const vals = (body.vals_list as Row[])[0]!;
        const id = this.nextId++;
        const now = odooNow();
        // Like Odoo: reuse the contact with that email, else create one now.
        let partner = this.partners.find((p) => typeof vals.email_from === "string" && p.email === vals.email_from);
        if (!partner) {
          partner = { id: this.nextId++, name: vals.partner_name, email: vals.email_from ?? false, create_date: now, create_uid: 2, user_ids: [] };
          this.partners.push(partner);
        }
        this.applicants.push({ id, stage_id: 1, application_status: "ongoing", active: true, partner_id: partner.id, create_date: now, create_uid: 2, ...vals });
        return [200, [id]];
      }
      case "hr.applicant/unlink":
        this.applicants = this.applicants.filter((a) => !(body.ids as number[]).includes(a.id as number));
        return [200, true];
      case "hr.applicant/search_count":
        return [200, this.applicants.filter((a) => this.match(a, domain, activeTest)).length];
      case "res.partner/search_read":
        return [200, this.read(this.partners.filter((p) => this.match(p, domain, false)), body.fields as string[])];
      case "res.partner/unlink":
        this.partners = this.partners.filter((p) => !(body.ids as number[]).includes(p.id as number));
        return [200, true];
      case "privacy.log/create":
        if (this.privacyLogForbidden) return [403, { name: "odoo.exceptions.AccessError", message: "You are not allowed to create 'Privacy Log'" }];
        this.privacyLog.push((body.vals_list as Row[])[0]!);
        return [200, [this.privacyLog.length]];
      case "ir.model/search":
        if (this.automationForbidden) return [403, { name: "odoo.exceptions.AccessError", message: "You are not allowed to access 'Model' (ir.model) records." }];
        return [200, [1573]];
      case "ir.model.fields/search":
        return [200, [4731, 4746, 4770]];
      case "base.automation/create": {
        const vals = (body.vals_list as Row[])[0]!;
        const id = this.automations.length + 1;
        const action = ((vals.action_server_ids as unknown[][])[0]![2]) as Row;
        this.automations.push({ id, action_server_ids: [300 + id], webhook_url: action.webhook_url, filter_domain: vals.filter_domain, active: true });
        return [200, [id]];
      }
      case "base.automation/search_read":
        return [200, this.automations.filter((a) => this.match(a, domain, false)).map((a) => ({ id: a.id, action_server_ids: a.action_server_ids }))];
      case "base.automation/write":
        return [200, true];
      case "ir.actions.server/write":
        for (const a of this.automations) if ((a.action_server_ids as number[]).some((x) => (body.ids as number[]).includes(x))) a.webhook_url = (body.vals as Row).webhook_url;
        return [200, true];
      case "base.automation/unlink":
        this.automations = this.automations.filter((a) => !(body.ids as number[]).includes(a.id as number));
        return [200, true];
      case "hr.applicant/message_post":
        for (const id of body.ids as number[]) this.notes.push({ applicantId: id, body: String(body.body), html: body.body_is_html === true });
        return [200, [900]];
      case "hr.applicant/search_read":
        return [200, this.read(this.applicants.filter((a) => this.match(a, domain, activeTest)), body.fields as string[])];
      default:
        return [404, { name: "werkzeug.exceptions.NotFound", message: `The method '${model}.${method}' does not exist`, debug: "Traceback (most recent call last): fake" }];
    }
  }

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const target = new URL(String(input));
    this.hosts.push(target.host);
    assert.equal(init?.redirect, "manual", "the Odoo client never follows redirects");
    if (target.origin !== ODOO || this.down) throw new TypeError("fetch failed");
    if (target.pathname === "/web/version") {
      return Response.json({ version_info: [this.major, 0, 0, "final", 0, ""], version: `${this.major}.0-test` });
    }
    const match = /^\/json\/2\/([a-z0-9_.]+)\/([a-z0-9_]+)$/.exec(target.pathname);
    if (!match || init?.method !== "POST") return new Response("not found", { status: 404 });
    const [, model, method] = match as unknown as [string, string, string];
    const headers = new Headers(init.headers);
    if (headers.get("authorization") !== `bearer ${ODOO_KEY}`) {
      return Response.json({ name: "werkzeug.exceptions.Unauthorized", message: "Invalid apikey", debug: "Traceback (most recent call last): secret internals" }, { status: 401 });
    }
    const body = JSON.parse(String(init.body)) as Row;
    this.calls.push({ model, method, body });
    if (this.failWith && this.failWith.model === model && this.failWith.method === method) {
      return Response.json({ name: "builtins.ValueError", message: "Invalid field 'x'\n(Record: hr.applicant(1,), User: 2)", debug: "Traceback (most recent call last): /usr/lib/python3/odoo SECRET_PATH" }, { status: this.failWith.status });
    }
    const [status, payload] = this.answer(model, method, body);
    return Response.json(payload, { status });
  };
}

let odoo = new FakeOdoo();
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => odoo.fetch(input, init)) as typeof fetch;

/* ---- In-memory service-role database -------------------------------------- */

class Query {
  private op: "select" | "upsert" | "update" | "delete" = "select";
  private filters: [string, unknown][] = [];
  private payload: Row = {};
  private conflict: string[] = [];
  private ignoreDuplicates = false;
  private returning = false;
  private singleRow = false;
  constructor(private db: FakeDb, private table: string) {}
  select() {
    if (this.op !== "select") this.returning = true;
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }
  not() {
    return this;
  }
  limit() {
    return this;
  }
  maybeSingle() {
    this.singleRow = true;
    return this;
  }
  single() {
    this.singleRow = true;
    return this;
  }
  upsert(row: Row, options: { onConflict: string; ignoreDuplicates?: boolean }) {
    this.op = "upsert";
    this.payload = row;
    this.conflict = options.onConflict.split(",");
    this.ignoreDuplicates = options.ignoreDuplicates === true;
    return this;
  }
  update(values: Row) {
    this.op = "update";
    this.payload = values;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  private rows(): Row[] {
    return (this.db.tables[this.table] ??= []);
  }
  private run(): unknown {
    const result = this.runAll();
    return this.singleRow && Array.isArray(result) ? (result[0] ?? null) : result;
  }
  private runAll(): unknown {
    const rows = this.rows();
    const hit = (row: Row) => this.filters.every(([column, value]) => row[column] === value);
    if (this.op === "select") return rows.filter(hit).map((row) => ({ ...row }));
    if (this.op === "upsert") {
      const existing = rows.find((row) => this.conflict.every((column) => row[column] === this.payload[column]));
      if (existing) {
        if (this.ignoreDuplicates) return [];
        Object.assign(existing, this.payload);
        return [{ ...existing }];
      }
      const row = { state: "pending", ...this.payload };
      rows.push(row);
      return [{ ...row }];
    }
    if (this.op === "update") {
      const changed = rows.filter(hit);
      for (const row of changed) {
        Object.assign(row, this.payload);
        // workspace_state.updated_at is the optimistic-concurrency token (DB trigger).
        if (this.table === "workspace_state") row.updated_at = `v${++this.db.versions}`;
      }
      return this.returning ? changed.map((row) => ({ ...row })) : null;
    }
    const kept = rows.filter((row) => !hit(row));
    this.db.tables[this.table] = kept;
    return null;
  }
  then<A, B>(resolve?: ((value: { data: unknown; error: null }) => A) | null, reject?: ((reason: unknown) => B) | null) {
    return Promise.resolve().then(() => ({ data: this.run(), error: null })).then(resolve, reject);
  }
}

const seed = buildSeedState();
const seedCandidate = seed.candidates[0]!;
const seedCampaign = seed.campaigns[0]!;

class FakeDb {
  tables: Record<string, Row[]> = {};
  versions = 0;
  constructor() {
    const state: WorkspaceState = {
      ...seed,
      settings: { ...seed.settings, confidentialityMode: false },
      campaigns: [{ ...seedCampaign, id: "camp_1", title: "Murex Support Montreal", activities: [] }],
      candidates: [],
      activities: [],
    };
    this.tables.workspace_state = [{ workspace_id: "ws-1", state, updated_at: "v0" }];
  }
  get state(): WorkspaceState {
    return this.tables.workspace_state![0]!.state as WorkspaceState;
  }
  set state(next: WorkspaceState) {
    this.tables.workspace_state![0]!.state = next;
  }
  get candidates(): Row[] {
    return this.state.candidates as unknown as Row[];
  }
  set candidates(rows: Row[]) {
    this.state = { ...this.state, candidates: rows.map((row) => ({ ...seedCandidate, notes: [], ...row })) as unknown as WorkspaceState["candidates"] };
  }
  from(table: string) {
    assert.match(table, /^(odoo_|workspace_state$)/, "Odoo code only touches the odoo_* tables and the workspace document");
    return new Query(this, table);
  }
  async rpc(name: string, args: Row) {
    assert.equal(name, "odoo_candidate_record");
    assert.equal(args.p_workspace_id, "ws-1");
    const state = this.state;
    const candidate = state.candidates.find((c) => c.id === args.p_candidate_id);
    if (!candidate) return { data: null, error: null };
    const reveals = state.activities
      .filter((a) => a.linkedEntityId === candidate.id && a.title === "Candidate PII revealed")
      .map((a) => a.createdAt)
      .sort();
    return {
      data: {
        candidate,
        campaignTitle: state.campaigns.find((c) => c.id === candidate.campaignId)?.title ?? null,
        confidentialityMode: state.settings.confidentialityMode === true,
        lastRevealAt: reveals[reveals.length - 1] ?? null,
      },
      error: null,
    };
  }
}

let db = new FakeDb();
let role: string | null = "admin";
let userId = "user-1";
const session = {
  auth: { getUser: async () => ({ data: { user: role ? { id: userId, email: "recruiter@example.com" } : null } }) },
  rpc: async (name: string) => ({ data: name === "current_profile_role" ? role : "ws-1", error: null }),
};
const afterTasks: Promise<unknown>[] = [];
mock.module("server-only", { namedExports: {} });
mock.module(url("src/lib/integrations/odoo/after-response.ts"), {
  namedExports: { afterResponse: (task: () => Promise<unknown>) => void afterTasks.push(task()) },
});
mock.module(url("src/lib/supabase/config.ts"), { namedExports: { supabaseEnabled: true, prodFailClosed: () => null } });
mock.module(url("src/lib/supabase/server.ts"), {
  namedExports: { getServerSupabase: async () => session, getServiceSupabase: () => db, requireAdmin: async () => ({ ok: true, role: "admin" }) },
});

// The integration is off unless the server opts in (src/lib/integrations/odoo/feature.ts).
process.env.ODOO_ENABLED = "true";

const client = await import("../src/lib/integrations/odoo/client");
const mapping = await import("../src/lib/integrations/odoo/mapping");
const service = await import("../src/lib/integrations/odoo/service");
const configRoute = await import("../src/app/api/integrations/odoo/config/route");
const checkRoute = await import("../src/app/api/integrations/odoo/check/route");
const jobsRoute = await import("../src/app/api/integrations/odoo/jobs/route");
const linksRoute = await import("../src/app/api/integrations/odoo/links/route");
const applicantsRoute = await import("../src/app/api/integrations/odoo/applicants/route");
const syncRoute = await import("../src/app/api/integrations/odoo/sync/route");
const pushRoute = await import("../src/app/api/integrations/odoo/push/route");
const erasuresRoute = await import("../src/app/api/integrations/odoo/erasures/route");
const webhookRoute = await import("../src/app/api/webhooks/odoo/[token]/route");
const { eraseFromOdoo } = await import("../src/lib/integrations/odoo/erasure");

const APP = "http://aria.test";
function request(path: string, init: { method?: string; body?: unknown; origin?: string | null } = {}): NextRequest {
  const headers = new Headers({ host: "aria.test", "x-real-ip": crypto.randomUUID() });
  if (init.origin !== null) headers.set("origin", init.origin ?? APP);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(`${APP}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

function candidate(overrides: Row = {}): Row {
  return {
    id: "cand_1",
    campaignId: "camp_1",
    name: "Ada Example",
    email: "ada@example.com",
    linkedinUrl: "https://www.linkedin.com/in/ada-example",
    githubUrl: "",
    currentTitle: "Murex <b>consultant</b>",
    currentCompany: "Example & Co",
    location: "Montréal",
    matchScore: 81,
    matchBreakdown: [{ label: "Skills", score: 90, rationale: "<img src=x onerror=alert(1)> Murex MX.3" }],
    techStack: ["Murex"],
    stage: "Interested",
    sourcePlatform: "LinkedIn",
    provenance: "live",
    lawfulBasis: "legitimate_interest",
    complianceFlags: { doNotContact: false, suppressed: false, unsubscribed: false, anonymized: false },
    starRating: undefined,
    ...overrides,
  };
}

function reset(): void {
  odoo = new FakeOdoo();
  db = new FakeDb();
  role = "admin";
  userId = crypto.randomUUID();
}

async function connect(): Promise<void> {
  const res = await configRoute.PUT(request("/api/integrations/odoo/config", { method: "PUT", body: { baseUrl: `${ODOO}/`, database: "aria", apiKey: ODOO_KEY } }));
  assert.equal(res.status, 200, await res.clone().text());
}

async function json(res: Response): Promise<Row> {
  return (await res.json()) as Row;
}

/* ---- Client ---------------------------------------------------------------- */

test("the Odoo address must be https, without credentials, query or app path", () => {
  const strict = { allowHttp: false };
  assert.deepEqual(client.normalizeOdooBaseUrl(" https://odoo.example.com/ ", strict), { ok: true, url: "https://odoo.example.com" });
  assert.deepEqual(client.normalizeOdooBaseUrl("https://example.com/erp", strict), { ok: true, url: "https://example.com/erp" });
  for (const bad of ["http://odoo.example.com", "https://u:p@odoo.example.com", "https://odoo.example.com/?db=x", "https://odoo.example.com/web", "https://odoo.example.com/odoo/action-1", "javascript:alert(1)", "ftp://odoo", ""]) {
    assert.equal(client.normalizeOdooBaseUrl(bad, strict).ok, false, bad);
  }
  assert.equal(client.normalizeOdooBaseUrl("http://localhost:8069", { allowHttp: true }).ok, true);
  assert.equal(client.odooHttpAllowed({ ODOO_ALLOW_HTTP: "true" }), true);
  assert.equal(client.odooHttpAllowed({}), false);
});

test("JSON-2 calls carry the bearer key and database, and refuse redirects", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const c = client.createOdooClient({ baseUrl: ODOO, database: "prod", apiKey: ODOO_KEY }, {
    fetchImpl: async (input, init) => {
      seen.push({ url: input, init });
      return Response.json([1, 2]);
    },
  });
  assert.deepEqual(await c.call("hr.job", "search", { domain: [] }), [1, 2]);
  const headers = new Headers(seen[0]!.init.headers);
  assert.equal(seen[0]!.url, `${ODOO}/json/2/hr.job/search`);
  assert.equal(headers.get("authorization"), `bearer ${ODOO_KEY}`);
  assert.equal(headers.get("x-odoo-database"), "prod");
  assert.equal(seen[0]!.init.redirect, "manual");

  const redirecting = client.createOdooClient({ baseUrl: ODOO, database: "prod", apiKey: ODOO_KEY }, {
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://elsewhere.test/" } }),
  });
  await assert.rejects(redirecting.call("hr.job", "search"), (e: unknown) => client.isOdooError(e) && e.code === "redirect_refused");
});

test("Odoo errors become codes with Odoo's first line, never the traceback", async () => {
  const cases: [number, string][] = [[401, "unauthorized"], [403, "forbidden"], [404, "not_found"], [422, "rejected"], [500, "server_error"]];
  for (const [status, code] of cases) {
    const c = client.createOdooClient({ baseUrl: ODOO, database: "prod", apiKey: ODOO_KEY }, {
      fetchImpl: async () => Response.json({ name: "odoo.exceptions.X", message: "Short reason\n(Record: hr.applicant(9,), User: 2)", debug: "Traceback SECRET" }, { status }),
    });
    await assert.rejects(c.call("hr.applicant", "write"), (e: unknown) => {
      assert.ok(client.isOdooError(e));
      assert.equal(e.code, code);
      assert.doesNotMatch(e.message, /Traceback|SECRET|Record:/);
      return true;
    });
  }
});

test("names, keys and response sizes are checked before anything is trusted", async () => {
  let fetched = 0;
  const fetchImpl = async () => {
    fetched++;
    return new Response("x".repeat(2_000));
  };
  const c = client.createOdooClient({ baseUrl: ODOO, database: "prod", apiKey: ODOO_KEY }, { fetchImpl, maxBytes: 1_000 });
  await assert.rejects(c.call("hr.job", "_private"), (e: unknown) => client.isOdooError(e) && e.code === "invalid_config");
  await assert.rejects(c.call("../web", "x"), (e: unknown) => client.isOdooError(e) && e.code === "invalid_config");
  assert.equal(fetched, 0);
  await assert.rejects(c.call("hr.job", "search"), (e: unknown) => client.isOdooError(e) && e.code === "bad_response");
  assert.throws(() => client.createOdooClient({ baseUrl: ODOO, database: "prod", apiKey: "key\r\nX-Injected: 1" }));
  assert.throws(() => client.createOdooClient({ baseUrl: ODOO, database: "prod; drop", apiKey: ODOO_KEY }));
  const slow = client.createOdooClient({ baseUrl: ODOO, database: "prod", apiKey: ODOO_KEY }, {
    fetchImpl: async () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    },
  });
  await assert.rejects(slow.call("hr.job", "search"), (e: unknown) => client.isOdooError(e) && e.code === "timeout");
});

/* ---- Mapping --------------------------------------------------------------- */

test("an Odoo job becomes an intake brief the parser already reads", () => {
  const job = mapping.jobFromOdoo(
    { id: 7, name: "Murex Support", description: "<p>Front &amp; back <b>office</b></p><script>x()</script><ul><li>Pricing</li></ul>", department_id: [2, "Finance"], recruiter_id: [4, "Lisa R"], no_of_recruitment: 2, salary_min: 70000, salary_max: 90000, currency_id: [1, "CAD"] },
    { skillNames: ["Murex", "SQL"], recruiterEmail: "lisa@example.com" },
  );
  assert.ok(job);
  assert.equal(job.descriptionText, "Front & back office\n\n- Pricing");
  const brief = mapping.jobToBrief(job);
  assert.match(brief.email, /^From: Lisa R <lisa@example.com>/);
  assert.match(brief.email, /Position: Murex Support/);
  assert.match(brief.email, /Department: Finance/);
  assert.match(brief.email, /Openings: 2/);
  assert.match(brief.email, /Salary: 70k CAD - 90k CAD/);
  assert.match(brief.email, /Required skills: Murex, SQL/);
  assert.doesNotMatch(brief.email, /Recruiter:|Key required skills|this need is now/i, "must not switch the parser to the Mantu format");
  assert.equal(mapping.jobFromOdoo({ id: 3, name: "Older", user_id: [9, "Old Recruiter"] })?.recruiter, "Old Recruiter");
  assert.equal(mapping.jobFromOdoo({ id: 0, name: "x" }), null);
});

test("the intake parser reads an Odoo brief: title, salary, contract, place and skills", async () => {
  const { parseEmailAndJD } = await import("../src/lib/mock-ai");
  const job = mapping.jobFromOdoo(
    {
      id: 7,
      name: "Senior Python Backend Engineer",
      description: "<p>Full-time permanent position, <b>hybrid</b> in Paris. 5+ years with Python and Django.</p>",
      address_id: [3, "Paris"],
      salary_min: 65000,
      salary_max: 80000,
      currency_id: [1, "EUR"],
      payment_interval: "monthly",
    },
    { skillNames: ["Python", "Django", "React"] },
  )!;
  const brief = mapping.jobToBrief(job);
  assert.match(brief.email, /Salary: €65k - €80k$/m);
  assert.doesNotMatch(brief.email, /monthly/, "Odoo's default pay interval is not stated");
  const parsed = parseEmailAndJD(brief);
  assert.equal(parsed.jobAnalysis.title, "Senior Python Backend Engineer");
  assert.equal(parsed.jobAnalysis.employmentType, "Full-time");
  assert.equal(parsed.jobAnalysis.locationType, "Hybrid");
  assert.equal(parsed.jobAnalysis.location, "Paris");
  assert.equal(parsed.jobAnalysis.salaryMin, 65000);
  assert.equal(parsed.jobAnalysis.salaryMax, 80000);
  assert.equal(parsed.jobAnalysis.currency, "EUR");
  assert.equal(parsed.jobAnalysis.minYearsExperience, 5);
  for (const skill of ["Python", "Django", "React"]) assert.ok(parsed.jobAnalysis.requiredSkills.includes(skill), skill);
  const dayRate = mapping.jobToBrief({ ...job, payInterval: "daily", salaryMin: 550, salaryMax: 650 });
  assert.match(dayRate.email, /Day rate: €550 - €650/);
});

test("the hand-off note escapes every candidate string and keeps http links only", () => {
  const parsed = mapping.HandoffCandidateSchema.parse(candidate({ githubUrl: "javascript:alert(1)", sourceUrl: "https://example.com/p?a=1&b=\"2\"" }));
  const html = mapping.handoffNoteHtml(parsed, { campaignTitle: "<i>Murex</i>", sentBy: "rec@example.com", sentAt: "2026-11-23T10:00:00Z" });
  assert.doesNotMatch(html, /<img|<i>Murex|javascript:/, "no live markup from candidate data");
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /Murex &lt;b&gt;consultant&lt;\/b&gt; @ Example &amp; Co/);
  assert.match(html, /<a href="https:\/\/www\.linkedin\.com\/in\/ada-example">LinkedIn<\/a>/);
  assert.match(html, /href="https:\/\/example\.com\/p\?a=1&amp;b=%222%22"/);
  assert.match(html, /GitHub/, "an unsafe URL is shown as text, not linked");
  assert.match(html, /Contact basis recorded in ARIA: legitimate interest/);
});

test("applicant values keep only safe data and fields this Odoo has", () => {
  const parsed = mapping.HandoffCandidateSchema.parse(candidate({ email: "not an email", phone: "+1 514 555 0100", linkedinUrl: "javascript:x" }));
  const all = new Set(["partner_name", "email_from", "partner_phone", "linkedin_profile", "job_id", "source_id", "priority"]);
  assert.deepEqual(mapping.applicantValues(parsed, { jobId: 7, sourceId: 3 }, all), {
    partner_name: "Ada Example",
    job_id: 7,
    partner_phone: "+1 514 555 0100",
    source_id: 3,
    priority: "2",
  });
  assert.deepEqual(Object.keys(mapping.applicantValues(parsed, { jobId: 7, sourceId: 3 }, new Set(["job_id"]))).sort(), ["job_id", "partner_name"]);
  assert.equal(mapping.priorityFor(mapping.HandoffCandidateSchema.parse(candidate({ starRating: "TopGun", matchScore: 10 }))), "3");
  assert.equal(mapping.priorityFor(mapping.HandoffCandidateSchema.parse(candidate({ matchScore: 40 }))), "0");
});

test("blocked, anonymized and synthetic candidates are never handed off", () => {
  const block = (overrides: Row) => mapping.handoffBlock(mapping.HandoffCandidateSchema.parse(candidate(overrides)));
  assert.equal(block({}), null);
  assert.match(block({ complianceFlags: { anonymized: true } })!, /anonymized/);
  assert.match(block({ complianceFlags: { doNotContact: true } })!, /do-not-contact/);
  assert.match(block({ complianceFlags: { unsubscribed: true } })!, /unsubscribed/);
  assert.match(block({ stage: "Suppressed" })!, /suppression/);
  assert.match(block({ provenance: "synthetic" })!, /Synthetic/);
});

test("Odoo stages map to ARIA stages, and ARIA only moves forward", () => {
  const stages = odoo.stages.map((s) => mapping.stageFromOdoo(s)!);
  const target = (name: string) => mapping.defaultStageTarget(stages.find((s) => s.name === name)!, stages);
  assert.equal(target("New"), "ignore");
  assert.equal(target("Qualification"), "Interested");
  assert.equal(target("First Interview"), "Interviewed");
  assert.equal(target("Contract Proposal"), "Offer");
  assert.equal(target("Contract Signed"), "Hired");
  const custom = (name: string) => mapping.defaultStageTarget({ id: 40, name, sequence: 3, hiredStage: false }, stages);
  assert.equal(custom("Intw2 - Manager"), "Interviewed");
  assert.equal(custom("Prequal call"), "Interested");
  assert.equal(custom("Entretien technique"), "Interviewed");

  const at = (status: string, stageId: number | null, refuseReason = "") => ({
    status: status as "ongoing",
    stage: stageId ? stages.find((s) => s.id === stageId)! : null,
    refuseReason,
  });
  assert.equal(mapping.ariaStageForApplicant(at("hired", 6), stages, {}), "Hired");
  assert.equal(mapping.ariaStageForApplicant(at("refused", 1, "Refused by applicant: salary"), stages, {}), "Not Interested");
  assert.equal(mapping.ariaStageForApplicant(at("refused", 1, "Does not fit"), stages, {}), "Rejected");
  assert.equal(mapping.ariaStageForApplicant(at("archived", 1), stages, {}), null);
  assert.equal(mapping.ariaStageForApplicant(at("deleted", null), stages, {}), null);
  assert.equal(mapping.ariaStageForApplicant(at("ongoing", 1), stages, {}), null);
  assert.equal(mapping.ariaStageForApplicant(at("ongoing", 2), stages, { "2": "Booked" }), "Booked");
  assert.equal(mapping.ariaStageForApplicant(at("ongoing", 3), stages, { "3": "ignore" }), null);

  assert.equal(mapping.stageUpdate("Interested", "Interviewed"), "Interviewed");
  assert.equal(mapping.stageUpdate("Booked", "Interested"), null, "never back to a stage already passed");
  assert.equal(mapping.stageUpdate("Interviewed", "Rejected"), "Rejected");
  assert.equal(mapping.stageUpdate("Rejected", "Offer"), "Offer", "Odoo reopened the application");
  assert.equal(mapping.stageUpdate("Suppressed", "Hired"), null, "compliance wins");
  assert.equal(mapping.stageUpdate("Hired", "Hired"), null);
  assert.equal(mapping.StageMapSchema.safeParse({ "2": "Interviewed" }).success, true);
  assert.equal(mapping.StageMapSchema.safeParse({ "2": "Suppressed" }).success, false);
  assert.equal(mapping.StageMapSchema.safeParse({ abc: "Offer" }).success, false);
});

test("Odoo's outcome lands in the workspace once: stage, note, refuse reason, activity, metrics", () => {
  const base = new FakeDb();
  base.candidates = [candidate({ stage: "Interviewed", maxStageRank: 5 }), candidate({ id: "cand_b", stage: "Offer" })];
  const at = "2026-11-24T10:00:00.000Z";
  const update = { candidateId: "cand_1", applicantId: 7, ariaStage: "Rejected" as const, odooStage: "First Interview", status: "refused" as const, refuseReason: "Does not fit" };
  const first = mapping.applyOdooUpdates(base.state, [update, { ...update, candidateId: "cand_b", ariaStage: "Interested" as const, status: "ongoing" as const, refuseReason: null }], at);
  assert.deepEqual(first.changes, [{ candidateId: "cand_1", from: "Interviewed", to: "Rejected", odooStage: "First Interview", status: "refused" }]);
  const moved = first.state.candidates.find((c) => c.id === "cand_1")!;
  assert.equal(moved.stage, "Rejected");
  assert.equal(moved.maxStageRank, 5, "the funnel keeps how far the candidate got");
  assert.equal(moved.rejectionReason, "Odoo: Does not fit");
  assert.match(moved.notes![0]!.text, /^Odoo: First Interview \(refused, Does not fit\)\. ARIA stage Interviewed → Rejected\.$/);
  assert.equal(first.state.candidates.find((c) => c.id === "cand_b")!.stage, "Offer", "never moved back");
  assert.equal(first.state.activities[0]!.linkedEntityId, "cand_1");
  assert.equal(first.state.campaigns[0]!.activities[0]!.title, `Odoo moved ${moved.name} to Rejected`);
  const again = mapping.applyOdooUpdates(first.state, [update], at);
  assert.equal(again.changes.length, 0);
  assert.equal(again.state, first.state, "a replayed update changes nothing");
});

test("a confidential profile needs a logged reveal from the last 24 hours, unless outreach started", () => {
  const now = Date.parse("2026-11-24T12:00:00Z");
  const block = (overrides: Partial<{ confidentialityMode: boolean; stage: "Sourced" | "Interested"; lastRevealAt: string | null }>) =>
    mapping.confidentialityBlock({ confidentialityMode: true, stage: "Sourced", lastRevealAt: null, ...overrides }, now);
  assert.match(block({})!, /Reveal it first/);
  assert.equal(block({ confidentialityMode: false }), null);
  assert.equal(block({ stage: "Interested" }), null);
  assert.equal(block({ lastRevealAt: "2026-11-24T09:00:00Z" }), null);
  assert.match(block({ lastRevealAt: "2026-11-23T11:00:00Z" })!, /Reveal/, "older than 24 h");
  assert.match(block({ lastRevealAt: "2026-11-25T12:00:00Z" })!, /Reveal/, "a reveal from the future is not trusted");
  assert.match(block({ lastRevealAt: "not a date" })!, /Reveal/);
});

/* ---- Service --------------------------------------------------------------- */

test("an Odoo older than 19 (no JSON-2) or an unknown database is refused clearly", async () => {
  reset();
  odoo.major = 18;
  const c = client.createOdooClient({ baseUrl: ODOO, database: "aria", apiKey: ODOO_KEY });
  await assert.rejects(service.checkOdoo(c), /needs Odoo 19 or later/);
  odoo.major = 20;
  const wrongDb = client.createOdooClient({ baseUrl: ODOO, database: "aria", apiKey: ODOO_KEY }, {
    fetchImpl: async (input, init) => (input.endsWith("/context_get") ? Response.json({ name: "NotFound", message: "x" }, { status: 404 }) : odoo.fetch(input, init)),
  });
  await assert.rejects(service.checkOdoo(wrongDb), /did not find this database/);
});

test("Odoo 18's separate candidate records are reported as unsupported, not half-written", async () => {
  reset();
  odoo.hasCandidateModel = true;
  const c = client.createOdooClient({ baseUrl: ODOO, database: "aria", apiKey: ODOO_KEY });
  const parsed = mapping.HandoffCandidateSchema.parse(candidate());
  await assert.rejects(service.createOrFindApplicant(c, parsed, 7), /not supported/);
  assert.equal(odoo.creates("hr.applicant"), 0);
});

/* ---- Routes ---------------------------------------------------------------- */

test("routes refuse anonymous users, the wrong roles and cross-site writes before any Odoo call", async () => {
  reset();
  role = null;
  assert.equal((await configRoute.GET(request("/api/integrations/odoo/config"))).status, 401);
  assert.equal((await jobsRoute.GET(request("/api/integrations/odoo/jobs"))).status, 401);
  role = "member";
  assert.equal((await configRoute.PUT(request("/api/integrations/odoo/config", { method: "PUT", body: { baseUrl: ODOO, database: "aria", apiKey: ODOO_KEY } }))).status, 403);
  assert.equal((await checkRoute.POST(request("/api/integrations/odoo/check", { method: "POST" }))).status, 403);
  assert.equal((await configRoute.DELETE(request("/api/integrations/odoo/config", { method: "DELETE" }))).status, 403);
  role = "viewer";
  assert.equal((await applicantsRoute.POST(request("/api/integrations/odoo/applicants", { method: "POST", body: { candidateId: "cand_1" } }))).status, 403);
  assert.equal((await linksRoute.POST(request("/api/integrations/odoo/links", { method: "POST", body: { campaignId: "camp_1", jobId: 7 } }))).status, 403);
  role = "admin";
  for (const origin of ["https://evil.test", null]) {
    const res = await applicantsRoute.POST(request("/api/integrations/odoo/applicants", { method: "POST", body: { candidateId: "cand_1" }, origin }));
    assert.equal(res.status, 403);
  }
  assert.equal(odoo.calls.length + odoo.hosts.length, 0);
});

test("connecting tests Odoo first, stores the key, and never returns it", async () => {
  reset();
  const insecure = await configRoute.PUT(request("/api/integrations/odoo/config", { method: "PUT", body: { baseUrl: "http://odoo.test", database: "aria", apiKey: ODOO_KEY } }));
  assert.equal(insecure.status, 400);
  const badKey = await configRoute.PUT(request("/api/integrations/odoo/config", { method: "PUT", body: { baseUrl: ODOO, database: "aria", apiKey: "wrong-key" } }));
  assert.equal(badKey.status, 502);
  assert.doesNotMatch(await badKey.text(), /Traceback|internals/);
  assert.equal(db.tables.odoo_connections?.length ?? 0, 0, "nothing saved when the test fails");

  await connect();
  const row = db.tables.odoo_connections![0]!;
  assert.equal(row.base_url, ODOO);
  assert.equal(row.api_key_last4, "6789");
  assert.equal(row.odoo_user_name, "ARIA Integration");
  role = "viewer";
  const view = await configRoute.GET(request("/api/integrations/odoo/config"));
  const text = await view.text();
  assert.equal(view.status, 200);
  assert.doesNotMatch(text, new RegExp(ODOO_KEY));
  assert.match(text, /"configured":true/);
});

test("the stored key never goes to a new address: changing it requires the key again and clears links", async () => {
  reset();
  await connect();
  db.tables.odoo_job_links = [{ workspace_id: "ws-1", campaign_id: "camp_1", job_id: 7, job_name: "Murex Support" }];
  odoo.hosts = [];
  const moved = await configRoute.PUT(request("/api/integrations/odoo/config", { method: "PUT", body: { baseUrl: "https://attacker.test", database: "aria" } }));
  assert.equal(moved.status, 400);
  assert.match((await json(moved)).error as string, /API key of this Odoo/);
  assert.deepEqual(odoo.hosts, [], "no request left for the new address");

  const sameWithoutKey = await configRoute.PUT(request("/api/integrations/odoo/config", { method: "PUT", body: { baseUrl: ODOO, database: "aria", stageMap: { "2": "Booked" } } }));
  assert.equal(sameWithoutKey.status, 200);
  assert.deepEqual(db.tables.odoo_connections![0]!.stage_map, { "2": "Booked" });
  assert.equal(db.tables.odoo_job_links!.length, 1, "same instance keeps its links");

  const otherDb = await configRoute.PUT(request("/api/integrations/odoo/config", { method: "PUT", body: { baseUrl: ODOO, database: "other", apiKey: ODOO_KEY } }));
  assert.equal(otherDb.status, 200);
  assert.equal(db.tables.odoo_job_links!.length, 0, "another database: the Odoo ids no longer mean anything");
});

test("jobs list open positions; links accept only jobs Odoo has", async () => {
  reset();
  role = "member";
  const notConnected = await jobsRoute.GET(request("/api/integrations/odoo/jobs"));
  assert.equal(notConnected.status, 409);
  role = "admin";
  await connect();
  role = "member";
  const list = await json(await jobsRoute.GET(request("/api/integrations/odoo/jobs")));
  assert.deepEqual((list.jobs as Row[]).map((j) => j.name), ["Murex Support"]);
  const detail = await json(await jobsRoute.GET(request("/api/integrations/odoo/jobs?id=7")));
  assert.match((detail.brief as Row).email as string, /Required skills: Murex/);
  assert.match((detail.brief as Row).email as string, /From: Lisa Recruiter <lisa\.recruiter@example\.com>/);
  assert.equal((await jobsRoute.GET(request("/api/integrations/odoo/jobs?id=8"))).status, 404, "archived job");
  assert.equal((await jobsRoute.GET(request("/api/integrations/odoo/jobs?id=1;drop"))).status, 400);

  assert.equal((await linksRoute.POST(request("/api/integrations/odoo/links", { method: "POST", body: { campaignId: "camp_1", jobId: 999 } }))).status, 404);
  const linked = await linksRoute.POST(request("/api/integrations/odoo/links", { method: "POST", body: { campaignId: "camp_1", jobId: 7 } }));
  assert.equal(linked.status, 200);
  const links = await json(await linksRoute.GET(request("/api/integrations/odoo/links")));
  assert.deepEqual(links.links, [{ campaignId: "camp_1", jobId: 7, jobName: "Murex Support", linkedAt: (links.links as Row[])[0]!.linkedAt, url: `${ODOO}/odoo/hr.job/7` }]);
});

async function readyForHandoff(): Promise<void> {
  reset();
  await connect();
  db.tables.odoo_job_links = [{ workspace_id: "ws-1", campaign_id: "camp_1", job_id: 7, job_name: "Murex Support", linked_at: "2026-11-23T00:00:00Z" }];
  db.candidates = [candidate()];
  role = "member";
}

const handoff = (candidateId = "cand_1") =>
  applicantsRoute.POST(request("/api/integrations/odoo/applicants", { method: "POST", body: { candidateId } }));

test("hand-off creates one applicant from the server's copy, with the ARIA source and an escaped note", async () => {
  await readyForHandoff();
  const res = await handoff();
  const body = await json(res);
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.status, "created");
  assert.equal(odoo.applicants.length, 1);
  const applicant = odoo.applicants[0]!;
  assert.equal(applicant.partner_name, "Ada Example");
  assert.equal(applicant.email_from, "ada@example.com");
  assert.equal(applicant.job_id, 7);
  assert.equal(applicant.priority, "2");
  assert.deepEqual(odoo.sources.map((s) => s.name), ["ARIA"]);
  assert.equal(applicant.source_id, odoo.sources[0]!.id);
  assert.equal(odoo.notes.length, 1);
  assert.equal(odoo.notes[0]!.html, true);
  assert.doesNotMatch(odoo.notes[0]!.body, /<img/);
  assert.match(odoo.notes[0]!.body, /sent to Odoo by recruiter@example\.com/);
  const link = db.tables.odoo_applicant_links![0]!;
  assert.equal(link.state, "linked");
  assert.equal(link.applicant_id, applicant.id);
  assert.equal(link.odoo_stage, "New");
  assert.equal((body.applicant as Row).url, `${ODOO}/odoo/hr.applicant/${applicant.id}`);

  const again = await json(await handoff());
  assert.equal(again.status, "already_in_odoo");
  assert.equal(odoo.creates("hr.applicant"), 1);
  assert.equal(odoo.creates("utm.source"), 1);
});

test("two hand-off clicks at once create exactly one applicant", async () => {
  await readyForHandoff();
  const results = await Promise.all([handoff(), handoff(), handoff()]);
  const bodies = await Promise.all(results.map((r) => json(r)));
  // The losers either see the claim in flight (409) or, if they read after the
  // winner finished, the finished link; never a second creation.
  assert.ok(results.every((r) => r.status === 200 || r.status === 409));
  assert.equal(bodies.filter((b) => b.status === "created").length, 1);
  assert.ok(results.some((r) => r.status === 409), "the claim turned a concurrent click away");
  assert.equal(odoo.creates("hr.applicant"), 1);
});

test("a hand-off that died mid-way is recovered without a duplicate", async () => {
  await readyForHandoff();
  odoo.applicants.push({ id: 55, partner_name: "Ada Example", email_from: "ADA@example.com", job_id: 7, stage_id: 2, application_status: "ongoing", active: true });
  db.tables.odoo_applicant_links = [{ workspace_id: "ws-1", candidate_id: "cand_1", campaign_id: "camp_1", job_id: 7, state: "pending", claimed_at: new Date().toISOString() }];
  assert.equal((await handoff()).status, 409, "a fresh claim is in flight");
  db.tables.odoo_applicant_links[0]!.claimed_at = new Date(Date.now() - 10 * 60_000).toISOString();
  const res = await json(await handoff());
  assert.equal(res.status, "linked_existing");
  assert.equal((res.applicant as Row).id, 55);
  assert.equal(odoo.creates("hr.applicant"), 0);
  assert.match(odoo.notes[0]!.body, /already in Odoo and linked it/);
});

test("email matching is literal: an underscore is not a wildcard", async () => {
  assert.equal(service.ilikeLiteral("jean_du%pont\\x@example.com"), "jean\\_du\\%pont\\\\x@example.com");
  await readyForHandoff();
  db.candidates = [candidate({ email: "jean_dupont@example.com", linkedinUrl: "" })];
  odoo.applicants.push({ id: 61, partner_name: "Someone Else", email_from: "jeanXdupont@example.com", job_id: 7, stage_id: 1, application_status: "ongoing", active: true });
  const res = await json(await handoff());
  assert.equal(res.status, "created", "another person's application is not linked");
  odoo.applicants = odoo.applicants.filter((a) => a.id === 61);
  odoo.applicants.push({ id: 62, partner_name: "Jean", email_from: "JEAN_DUPONT@example.com", job_id: 7, stage_id: 1, application_status: "ongoing", active: true });
  db.tables.odoo_applicant_links = [];
  const again = await json(await handoff());
  assert.equal(again.status, "linked_existing");
  assert.equal((again.applicant as Row).id, 62, "same email, other case: linked");
});

test("an applicant deleted in Odoo can be handed off again", async () => {
  await readyForHandoff();
  assert.equal((await handoff()).status, 200);
  const first = db.tables.odoo_applicant_links![0]!.applicant_id;
  assert.equal((await json(await handoff())).status, "already_in_odoo");
  odoo.applicants = [];
  const res = await json(await handoff());
  assert.equal(res.status, "created");
  assert.notEqual((res.applicant as Row).id, first);
  assert.equal(db.tables.odoo_applicant_links!.length, 1);
  assert.equal(odoo.creates("hr.applicant"), 2);
});

test("the hand-off refuses blocked candidates and unlinked campaigns, and releases its claim on Odoo errors", async () => {
  await readyForHandoff();
  db.candidates = [candidate({ complianceFlags: { doNotContact: true } })];
  const blocked = await handoff();
  assert.equal(blocked.status, 409);
  assert.equal((await json(blocked)).code, "blocked");
  assert.equal((await handoff("cand_missing")).status, 404);

  db.candidates = [candidate()];
  db.tables.odoo_job_links = [];
  const unlinked = await handoff();
  assert.equal((await json(unlinked)).code, "no_job");
  assert.equal(odoo.creates("hr.applicant"), 0);

  db.tables.odoo_job_links = [{ workspace_id: "ws-1", campaign_id: "camp_1", job_id: 7, job_name: "Murex Support" }];
  odoo.failWith = { model: "hr.applicant", method: "create", status: 500 };
  const failed = await handoff();
  assert.equal(failed.status, 502);
  const text = await failed.text();
  assert.doesNotMatch(text, /Traceback|SECRET_PATH|Record:/);
  assert.equal(db.tables.odoo_applicant_links?.length ?? 0, 0, "the claim is released so the recruiter can retry");
  odoo.failWith = null;
  assert.equal((await handoff()).status, 200);
});

test("sync reads Odoo's outcome back as ARIA stages, honouring the admin mapping", async () => {
  await readyForHandoff();
  db.candidates = [candidate(), candidate({ id: "cand_2", email: "bo@example.com", linkedinUrl: "" }), candidate({ id: "cand_3", email: "cy@example.com", linkedinUrl: "" })];
  for (const id of ["cand_1", "cand_2", "cand_3"]) assert.equal((await handoff(id)).status, 200);
  const [a, b, c] = odoo.applicants as [Row, Row, Row];
  a.stage_id = 6;
  a.application_status = "hired";
  b.application_status = "refused";
  b.refuse_reason_id = 6;
  b.active = false;
  odoo.applicants = [a, b];
  void c;
  db.tables.odoo_connections![0]!.stage_map = { "2": "Booked" };

  role = "viewer";
  const res = await json(await applicantsRoute.GET(request("/api/integrations/odoo/applicants?campaignId=camp_1")));
  const byCandidate = new Map((res.applicants as Row[]).map((row) => [row.candidateId, row]));
  assert.equal(byCandidate.get("cand_1")!.ariaStage, "Hired");
  assert.equal(byCandidate.get("cand_1")!.stage, "Contract Signed");
  assert.equal(byCandidate.get("cand_2")!.ariaStage, "Not Interested");
  assert.equal(byCandidate.get("cand_2")!.refuseReason, "Refused by applicant: salary");
  assert.equal(byCandidate.get("cand_3")!.status, "deleted");
  assert.equal(byCandidate.get("cand_3")!.ariaStage, null);
  const stored = db.tables.odoo_applicant_links!.find((row) => row.candidate_id === "cand_1")!;
  assert.equal(stored.odoo_status, "hired");

  odoo.applicants[0]!.stage_id = 2;
  odoo.applicants[0]!.application_status = "ongoing";
  const mapped = await json(await applicantsRoute.GET(request("/api/integrations/odoo/applicants?campaignId=camp_1")));
  assert.equal((mapped.applicants as Row[]).find((row) => row.candidateId === "cand_1")!.ariaStage, "Booked");
  assert.equal((await applicantsRoute.GET(request("/api/integrations/odoo/applicants?campaignId=x%20y"))).status, 400);
});

test("disconnecting forgets the connection and every link", async () => {
  await readyForHandoff();
  assert.equal((await handoff()).status, 200);
  role = "admin";
  assert.equal((await configRoute.DELETE(request("/api/integrations/odoo/config", { method: "DELETE" }))).status, 200);
  assert.equal(db.tables.odoo_connections!.length, 0);
  assert.equal(db.tables.odoo_job_links!.length, 0);
  assert.equal(db.tables.odoo_applicant_links!.length, 0);
  assert.equal(odoo.applicants.length, 1, "nothing is deleted in Odoo");
});

test("the server refuses to hand off a confidential profile nobody revealed, and logs the hand-off", async () => {
  await readyForHandoff();
  db.state = { ...db.state, settings: { ...db.state.settings, confidentialityMode: true } };
  db.candidates = [candidate({ stage: "Sourced" })];
  const masked = await handoff();
  assert.equal(masked.status, 409);
  assert.equal((await json(masked)).code, "confidential");
  assert.equal(odoo.calls.filter((c) => c.model === "hr.applicant").length, 0, "nothing reached Odoo");

  db.state = {
    ...db.state,
    activities: [{ id: "act_r", type: "compliance", title: "Candidate PII revealed", notes: "", outcome: "Access logged", campaignId: "camp_1", linkedEntityType: "candidate", linkedEntityId: "cand_1", createdAt: new Date().toISOString() }, ...db.state.activities],
  };
  const sent = await handoff();
  assert.equal(sent.status, 200, await sent.clone().text());
  const after = db.candidates.find((c) => c.id === "cand_1") as unknown as WorkspaceState["candidates"][number];
  assert.match(after.notes![0]!.text, /^Sent to Odoo: applicant #\d+ on “Murex Support”, by recruiter@example\.com\.$/);
  assert.equal(db.state.activities[0]!.outcome, "Handed off to Odoo");
});

test("a campaign sync applies Odoo's outcome on the server, once", async () => {
  await readyForHandoff();
  assert.equal((await handoff()).status, 200);
  const applicant = odoo.applicants[0]!;
  applicant.stage_id = 3;
  const sync = () => syncRoute.POST(request("/api/integrations/odoo/sync", { method: "POST", body: { campaignId: "camp_1" } }));
  const first = await json(await sync());
  assert.deepEqual(first.changes, [{ candidateId: "cand_1", from: "Interested", to: "Interviewed", odooStage: "First Interview", status: "ongoing" }]);
  assert.deepEqual(first.workspaceStages, { cand_1: "Interviewed" });
  const notes = (db.candidates[0] as unknown as { notes: unknown[] }).notes.length;
  const second = await json(await sync());
  assert.deepEqual(second.changes, []);
  assert.equal((db.candidates[0] as unknown as { notes: unknown[] }).notes.length, notes, "no duplicate note");
  role = "viewer";
  assert.equal((await sync()).status, 403, "viewers read, they do not apply");
  const read = await json(await applicantsRoute.GET(request("/api/integrations/odoo/applicants?campaignId=camp_1")));
  assert.deepEqual(read.workspaceStages, { cand_1: "Interviewed" });
});

async function setUpPush(): Promise<{ token: string; body: Row }> {
  role = "admin";
  const res = await pushRoute.POST(request("/api/integrations/odoo/push", { method: "POST", body: { ariaUrl: "https://aria.example.com/" } }));
  const body = await json(res);
  assert.equal(res.status, 200, JSON.stringify(body));
  const token = /\/api\/webhooks\/odoo\/([A-Za-z0-9_-]{43})$/.exec(body.url as string)?.[1];
  assert.ok(token);
  return { token, body };
}

const ping = (token: string, payload: unknown) =>
  webhookRoute.POST(
    new NextRequest(`${APP}/api/webhooks/odoo/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: typeof payload === "string" ? payload : JSON.stringify(payload) }),
    { params: Promise.resolve({ token }) },
  );

test("Odoo's webhook moves the candidate within the call, after reading the applicant back", async () => {
  await readyForHandoff();
  assert.equal((await handoff()).status, 200);
  const { token, body } = await setUpPush();
  assert.equal(body.automated, true);
  assert.equal(odoo.automations.length, 1);
  assert.equal(odoo.automations[0]!.webhook_url, `https://aria.example.com/api/webhooks/odoo/${token}`);
  assert.equal(odoo.automations[0]!.filter_domain, "[('source_id.name', '=', 'ARIA')]");
  const connection = db.tables.odoo_connections![0]!;
  assert.match(connection.webhook_token_hash as string, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(db.tables.odoo_connections), new RegExp(token), "only the hash is stored");
  assert.doesNotMatch(await (await configRoute.GET(request("/api/integrations/odoo/config"))).text(), new RegExp(token));

  const applicant = odoo.applicants[0]!;
  applicant.stage_id = 6;
  applicant.application_status = "hired";
  // The payload says "refused": ARIA trusts Odoo's answer, not the payload.
  const res = await ping(token, { _model: "hr.applicant", _id: applicant.id, application_status: "refused" });
  assert.equal(res.status, 202);
  await Promise.all(afterTasks.splice(0));
  assert.equal(db.candidates[0]!.stage, "Hired");
  assert.ok(db.tables.odoo_connections![0]!.last_webhook_at);

  const before = odoo.calls.length;
  for (const bad of [{ _model: "res.partner", _id: applicant.id }, { _model: "hr.applicant", _id: 999 }, { _model: "hr.applicant", _id: "7" }, "not json"]) {
    assert.equal((await ping(token, bad)).status, 202);
  }
  await Promise.all(afterTasks.splice(0));
  assert.ok(odoo.calls.length - before <= 0, "unknown or foreign applicants cost no Odoo call");
  const unknown = await ping("A".repeat(43), { _model: "hr.applicant", _id: applicant.id });
  assert.equal(unknown.status, 202, "an unknown token gets the same answer");
  await Promise.all(afterTasks.splice(0));
  assert.equal(odoo.calls.length, before);
  assert.equal((await ping(token, { _model: "hr.applicant", _id: 1, pad: "x".repeat(20_000) })).status, 413);
});

test("without Odoo admin rights, live updates fall back to manual steps; turning them off removes ARIA's rule", async () => {
  await readyForHandoff();
  role = "member";
  assert.equal((await pushRoute.POST(request("/api/integrations/odoo/push", { method: "POST", body: { ariaUrl: "https://aria.example.com" } }))).status, 403);
  assert.equal((await pushRoute.POST(request("/api/integrations/odoo/push", { method: "POST", body: { ariaUrl: "http://aria.example.com" } }))).status, 403);
  role = "admin";
  assert.equal((await pushRoute.POST(request("/api/integrations/odoo/push", { method: "POST", body: { ariaUrl: "http://aria.example.com" } }))).status, 400, "https only");
  odoo.automationForbidden = true;
  const manual = await setUpPush();
  assert.equal(manual.body.automated, false);
  assert.match(manual.body.reason as string, /may not create automation rules/);
  assert.ok((manual.body.steps as string[]).some((step) => /Source = ARIA/.test(step)));
  assert.equal(odoo.automations.length, 0);
  assert.equal(db.tables.odoo_connections![0]!.webhook_automation_id, null);

  odoo.automationForbidden = false;
  const auto = await setUpPush();
  assert.equal(auto.body.automated, true);
  assert.equal((await ping(manual.token, { _model: "hr.applicant", _id: 1 })).status, 202);
  await Promise.all(afterTasks.splice(0));
  assert.equal(db.tables.odoo_connections![0]!.last_webhook_at, null, "the replaced token no longer reaches the workspace");
  const off = await json(await pushRoute.DELETE(request("/api/integrations/odoo/push", { method: "DELETE" })));
  assert.equal(off.removedInOdoo, true);
  assert.equal(odoo.automations.length, 0);
  assert.equal(db.tables.odoo_connections![0]!.webhook_token_hash, null);
});

test("erasing a candidate deletes its Odoo applicant and the contact Odoo made for it, with Odoo's privacy log", async () => {
  await readyForHandoff();
  assert.equal((await handoff()).status, 200);
  const applicantId = odoo.applicants[0]!.id as number;
  const partnerId = odoo.applicants[0]!.partner_id;
  const result = await eraseFromOdoo(db as never, "ws-1", "cand_1", "11111111-1111-4111-8111-111111111111");
  assert.equal(result?.status, "deleted");
  assert.match(result!.detail, /contact, created for this application, was deleted too.*privacy log/);
  assert.equal(odoo.applicants.length, 0);
  assert.equal(odoo.partners.some((p) => p.id === partnerId), false);
  assert.deepEqual(odoo.privacyLog.map((entry) => [entry.anonymized_name, entry.anonymized_email]), [["A*** E***", "a***@example.com"]]);
  assert.equal(db.tables.odoo_applicant_links!.length, 0, "the link is forgotten");
  assert.equal(db.tables.odoo_erasures![0]!.applicant_id, applicantId);
  const replay = await eraseFromOdoo(db as never, "ws-1", "cand_1", null);
  assert.equal(replay?.status, "deleted");
  assert.equal(odoo.calls.filter((c) => c.method === "unlink").length, 2, "a replay does not call Odoo again");
  assert.equal(await eraseFromOdoo(db as never, "ws-1", "cand_never_sent", null), null);
});

test("a hired applicant is kept for HR, and a contact that existed before is never deleted", async () => {
  await readyForHandoff();
  odoo.partners.push({ id: 900, name: "Bo Existing", email: "bo@example.com", create_date: odooNow(-86_400_000), create_uid: 3, user_ids: [] });
  odoo.privacyLogForbidden = true;
  db.candidates = [candidate(), candidate({ id: "cand_2", email: "bo@example.com", linkedinUrl: "" })];
  assert.equal((await handoff("cand_1")).status, 200);
  assert.equal((await handoff("cand_2")).status, 200);
  odoo.applicants[0]!.application_status = "hired";
  const hired = await eraseFromOdoo(db as never, "ws-1", "cand_1", null);
  assert.equal(hired?.status, "kept_hired");
  assert.equal(odoo.applicants.length, 2, "nothing deleted");
  const existing = await eraseFromOdoo(db as never, "ws-1", "cand_2", null);
  assert.equal(existing?.status, "deleted");
  assert.match(existing!.detail, /existed before the application and was kept/);
  assert.doesNotMatch(existing!.detail, /privacy log/, "the log needs rights this user lacks");
  assert.ok(odoo.partners.some((p) => p.id === 900));
});

test("an unreachable Odoo leaves the erasure pending until an admin retries it", async () => {
  await readyForHandoff();
  assert.equal((await handoff()).status, 200);
  odoo.down = true;
  const pending = await eraseFromOdoo(db as never, "ws-1", "cand_1", null);
  assert.equal(pending?.status, "pending");
  role = "member";
  assert.equal((await erasuresRoute.GET(request("/api/integrations/odoo/erasures"))).status, 403);
  role = "admin";
  const list = await json(await erasuresRoute.GET(request("/api/integrations/odoo/erasures")));
  assert.equal((list.erasures as Row[])[0]!.status, "pending");
  odoo.down = false;
  const retried = await json(await erasuresRoute.POST(request("/api/integrations/odoo/erasures", { method: "POST", body: { candidateId: "cand_1" } })));
  assert.equal((retried.erasure as Row).status, "deleted");
  assert.equal((retried.erasure as Row).attempts, 2);
  assert.equal(odoo.applicants.length, 0);
  assert.equal((await erasuresRoute.POST(request("/api/integrations/odoo/erasures", { method: "POST", body: { candidateId: "cand_x" } }))).status, 404);
});

/* ---- Schema ---------------------------------------------------------------- */

test("with ODOO_ENABLED off, every Odoo route and the webhook answer 404 before any read or Odoo call", async () => {
  await readyForHandoff();
  assert.equal((await handoff()).status, 200);
  const { token } = await setUpPush();
  const applicantId = db.tables.odoo_applicant_links![0]!.applicant_id;
  const before = JSON.stringify({ tables: db.tables, candidates: db.candidates });
  const odooCalls = odoo.calls.length;
  const queued = afterTasks.length;
  role = "admin";
  for (const value of [undefined, "", "false", "1", "TRUE"]) {
    if (value === undefined) delete process.env.ODOO_ENABLED;
    else process.env.ODOO_ENABLED = value;
    const answers: Array<[string, Response]> = [
      ["GET config", await configRoute.GET(request("/api/integrations/odoo/config"))],
      ["PUT config", await configRoute.PUT(request("/api/integrations/odoo/config", { method: "PUT", body: { baseUrl: ODOO, database: "aria", apiKey: ODOO_KEY } }))],
      ["DELETE config", await configRoute.DELETE(request("/api/integrations/odoo/config", { method: "DELETE" }))],
      ["POST check", await checkRoute.POST(request("/api/integrations/odoo/check", { method: "POST" }))],
      ["GET jobs", await jobsRoute.GET(request("/api/integrations/odoo/jobs"))],
      ["GET links", await linksRoute.GET(request("/api/integrations/odoo/links"))],
      ["POST links", await linksRoute.POST(request("/api/integrations/odoo/links", { method: "POST", body: { campaignId: "camp_1", jobId: 7 } }))],
      ["DELETE links", await linksRoute.DELETE(request("/api/integrations/odoo/links", { method: "DELETE", body: { campaignId: "camp_1" } }))],
      ["GET applicants", await applicantsRoute.GET(request("/api/integrations/odoo/applicants?campaignId=camp_1"))],
      ["POST applicants", await handoff()],
      ["POST sync", await syncRoute.POST(request("/api/integrations/odoo/sync", { method: "POST", body: { campaignId: "camp_1" } }))],
      ["POST push", await pushRoute.POST(request("/api/integrations/odoo/push", { method: "POST", body: { ariaUrl: "https://aria.example.com/" } }))],
      ["DELETE push", await pushRoute.DELETE(request("/api/integrations/odoo/push", { method: "DELETE" }))],
      ["GET erasures", await erasuresRoute.GET(request("/api/integrations/odoo/erasures"))],
      ["POST erasures", await erasuresRoute.POST(request("/api/integrations/odoo/erasures", { method: "POST", body: { candidateId: "cand_1" } }))],
    ];
    for (const [name, res] of answers) {
      assert.equal(res.status, 404, `${name} with ODOO_ENABLED=${String(value)}`);
      const body = await json(res);
      assert.equal(body.code, "odoo_disabled", name);
      assert.match(String(body.error), /ODOO_ENABLED=true/);
    }
    const hook = await ping(token, { _id: applicantId, _model: "hr.applicant" });
    assert.equal(hook.status, 404);
    assert.deepEqual(await json(hook), { ok: false }, "the public webhook says nothing");
  }
  assert.equal(odoo.calls.length, odooCalls, "no call reached Odoo");
  assert.equal(afterTasks.length, queued, "no webhook work was queued");
  assert.equal(JSON.stringify({ tables: db.tables, candidates: db.candidates }), before, "nothing was read into or written to the workspace");

  process.env.ODOO_ENABLED = "true";
  assert.equal((await configRoute.GET(request("/api/integrations/odoo/config"))).status, 200, "back on after a restart with the switch");
});

test("the Odoo tables are service-role only with forced RLS, and the candidate read is service-only", () => {
  const sql = readFileSync("supabase/migrations/0010_odoo_integration.sql", "utf8");
  for (const table of ["odoo_connections", "odoo_job_links", "odoo_applicant_links"]) assert.match(sql, new RegExp(`create table public\\.${table} `));
  assert.match(sql, /foreach target in array array\['odoo_connections', 'odoo_job_links', 'odoo_applicant_links'\]/);
  assert.match(sql, /force row level security/);
  assert.match(sql, /revoke all on public\.%I from public, anon, authenticated, authenticator/);
  assert.match(sql, /revoke all on function public\.odoo_candidate_record\(uuid, text\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.odoo_candidate_record\(uuid, text\) to service_role;/);
  assert.match(sql, /primary key \(workspace_id, candidate_id\)/, "one hand-off per candidate");
  assert.doesNotMatch(sql, /security definer/i);
  const push = readFileSync("supabase/migrations/0011_odoo_push_privacy.sql", "utf8");
  assert.match(push, /webhook_token_hash text unique check \(webhook_token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/, "only a hash of the webhook token");
  assert.match(push, /alter table public\.odoo_erasures force row level security;/);
  assert.match(push, /revoke all on public\.odoo_erasures from public, anon, authenticated, authenticator;/);
  assert.match(push, /grant execute on function public\.odoo_candidate_record\(uuid, text\) to service_role;/);
  assert.match(push, /'Candidate PII revealed'/, "the reveal the drawer logs");
});

test("restore global fetch", () => {
  globalThis.fetch = realFetch;
});
