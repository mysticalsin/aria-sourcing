// ARIA <-> Odoo integration (ADR 0003, docs/odoo.md): the JSON-2 client, the
// pure mapping, the Odoo operations, and the routes against an in-memory Odoo
// and an in-memory service-role database. Synthetic data only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mock, test } from "node:test";
import { NextRequest } from "next/server";

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
    const many2one = new Set(["department_id", "recruiter_id", "stage_id", "job_id", "source_id", "refuse_reason_id"]);
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
          ["partner_name", "email_from", "partner_phone", "linkedin_profile", "job_id", "source_id", "priority", "stage_id", "application_status", "refuse_reason_id", "active"].map((f) => [f, { type: "char", required: false }]),
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
        this.applicants.push({ id, stage_id: 1, application_status: "ongoing", active: true, ...vals });
        return [200, [id]];
      }
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
    if (target.origin !== ODOO) throw new TypeError("fetch failed");
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
  private single = false;
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
    this.single = true;
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
    const rows = this.rows();
    const hit = (row: Row) => this.filters.every(([column, value]) => row[column] === value);
    if (this.op === "select") {
      const found = rows.filter(hit).map((row) => ({ ...row }));
      return this.single ? (found[0] ?? null) : found;
    }
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
      for (const row of changed) Object.assign(row, this.payload);
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

class FakeDb {
  tables: Record<string, Row[]> = {};
  candidates: Row[] = [];
  campaigns: Row[] = [{ id: "camp_1", title: "Murex Support Montreal" }];
  from(table: string) {
    assert.match(table, /^odoo_/, "Odoo routes only touch the odoo_* tables");
    return new Query(this, table);
  }
  async rpc(name: string, args: Row) {
    assert.equal(name, "odoo_candidate_record");
    assert.equal(args.p_workspace_id, "ws-1");
    const candidate = this.candidates.find((c) => c.id === args.p_candidate_id);
    if (!candidate) return { data: null, error: null };
    return { data: { candidate, campaignTitle: this.campaigns.find((c) => c.id === candidate.campaignId)?.title ?? null }, error: null };
  }
}

let db = new FakeDb();
let role: string | null = "admin";
let userId = "user-1";
const session = {
  auth: { getUser: async () => ({ data: { user: role ? { id: userId, email: "recruiter@example.com" } : null } }) },
  rpc: async (name: string) => ({ data: name === "current_profile_role" ? role : "ws-1", error: null }),
};
mock.module(url("src/lib/supabase/config.ts"), { namedExports: { supabaseEnabled: true, prodFailClosed: () => null } });
mock.module(url("src/lib/supabase/server.ts"), {
  namedExports: { getServerSupabase: async () => session, getServiceSupabase: () => db, requireAdmin: async () => ({ ok: true, role: "admin" }) },
});

const client = await import("../src/lib/integrations/odoo/client");
const mapping = await import("../src/lib/integrations/odoo/mapping");
const service = await import("../src/lib/integrations/odoo/service");
const configRoute = await import("../src/app/api/integrations/odoo/config/route");
const checkRoute = await import("../src/app/api/integrations/odoo/check/route");
const jobsRoute = await import("../src/app/api/integrations/odoo/jobs/route");
const linksRoute = await import("../src/app/api/integrations/odoo/links/route");
const applicantsRoute = await import("../src/app/api/integrations/odoo/applicants/route");

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
  assert.deepEqual(
    mapping.planStageSync(
      [{ id: "a", stage: "Interested" }, { id: "b", stage: "Offer" }],
      [
        { candidateId: "a", ariaStage: "Hired", stage: "Contract Signed", status: "hired", refuseReason: null },
        { candidateId: "b", ariaStage: "Interested", stage: "Qualification", status: "ongoing", refuseReason: null },
        { candidateId: "gone", ariaStage: "Hired", stage: null, status: "hired", refuseReason: null },
      ],
    ),
    [{ candidateId: "a", from: "Interested", to: "Hired", odooStage: "Contract Signed", status: "hired", refuseReason: null }],
  );
  assert.equal(mapping.StageMapSchema.safeParse({ "2": "Interviewed" }).success, true);
  assert.equal(mapping.StageMapSchema.safeParse({ "2": "Suppressed" }).success, false);
  assert.equal(mapping.StageMapSchema.safeParse({ abc: "Offer" }).success, false);
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

/* ---- Schema ---------------------------------------------------------------- */

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
});

test("restore global fetch", () => {
  globalThis.fetch = realFetch;
});
