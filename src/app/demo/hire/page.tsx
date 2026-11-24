import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { PageHeader } from "@/components/app/page-header";
import { runSyntheticHireDemo } from "@/lib/synthetic-hire-demo";

export const metadata = {
  title: "Synthetic hire",
};

function stepLabel(action: string, skipped?: boolean): string {
  if (skipped) return "Stage skipped";
  if (action === "job") return "Open the role";
  if (action === "applicant") return "Record the applicant";
  if (action === "stage") return "Move to hired";
  return "Close the vacancy";
}

export default async function SyntheticHirePage() {
  const demo = await runSyntheticHireDemo();
  const vacancy = JSON.stringify(demo.vacancyClose);
  const kwargs = JSON.stringify(demo.vacancyKwargs);
  const unsetResult = JSON.stringify({ ok: demo.unset.ok, erp: demo.unset.erp, linkedIn: demo.unset.linkedIn });
  const hireRecordId = demo.hired.steps.find((step) => step.action === "hire")?.id ?? "";

  return (
    <div className="animate-fade-in mx-auto flex max-w-3xl flex-col gap-8">
      <PageHeader
        eyebrow="Demo"
        title="Synthetic sourcing to hired"
        description="Fixture data only. The hire runs on the in-repo fake Odoo. No LinkedIn request is sent."
        actions={
          <Badge tone="violet" size="md" dot>
            Synthetic
          </Badge>
        }
      />

      <section id="synthetic-fixture" className="scroll-mt-6">
        <Card>
          <CardHeader>
            <CardTitle>Sourced from the fixture</CardTitle>
          </CardHeader>
          <CardBody>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-bold uppercase tracking-wider text-muted">Applicant</dt>
                <dd className="mt-1 text-ink" data-testid="fixture-applicant">{demo.fixture.applicantName}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wider text-muted">Role</dt>
                <dd className="mt-1 text-ink">{demo.fixture.jobName}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wider text-muted">Email</dt>
                <dd className="mt-1 text-ink">{demo.fixture.email}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wider text-muted">Provenance</dt>
                <dd className="mt-1">
                  <Badge tone="neutral">{demo.fixture.provenance}</Badge>
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-sm text-muted">LinkedIn calls: 0. Department: {demo.fixture.department}.</p>
          </CardBody>
        </Card>
      </section>

      <section id="synthetic-odoo" className="scroll-mt-6">
        <Card>
          <CardHeader>
            <CardTitle>Hired on the fake Odoo</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="mb-4 text-sm text-muted" data-testid="odoo-result">
              Connector <span data-testid="selected-connector">odoo</span> selected. Result: {demo.hired.ok ? "ok" : "failed"} · erp {demo.hired.erp} · linkedIn {String(demo.hired.linkedIn)}
            </p>
            <ol className="flex flex-col gap-3">
              {demo.hired.steps.map((step) => (
                <li key={`${step.action}-${step.method}`} data-testid={`odoo-step-${step.action}`} className="rounded-xl bg-ink/[0.03] px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-ink">{stepLabel(step.action, step.skipped)}</span>
                    <Badge tone={step.ok ? "success" : "danger"} size="sm">
                      {step.skipped ? "skipped" : step.ok ? "written" : "failed"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {step.model} {step.method}
                    {step.id ? ` · id ${step.id}` : ""}
                    {step.reason ? ` · ${step.reason}` : ""}
                  </p>
                </li>
              ))}
            </ol>
            <div className="mt-5">
              <p className="text-xs font-bold uppercase tracking-wider text-muted">Vacancy close</p>
              <dl className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-bold uppercase tracking-wider text-muted">Job create id</dt>
                  <dd className="mt-1 font-semibold text-ink" data-testid="job-create-id">{demo.jobCreateId}</dd>
                </div>
                <div>
                  <dt className="text-xs font-bold uppercase tracking-wider text-muted">Hire record id</dt>
                  <dd className="mt-1 font-semibold text-ink" data-testid="hire-record-id">{hireRecordId}</dd>
                </div>
              </dl>
              <p className="mt-4 text-xs font-bold uppercase tracking-wider text-muted">Write</p>
              <pre className="mt-2 overflow-x-auto rounded-xl bg-ink/[0.04] p-4 text-sm text-ink" data-testid="vacancy-write">{vacancy}</pre>
              <p className="mt-4 text-xs font-bold uppercase tracking-wider text-muted">Kwargs</p>
              <pre className="mt-2 overflow-x-auto rounded-xl bg-ink/[0.04] p-4 text-sm text-ink" data-testid="vacancy-kwargs">{kwargs}</pre>
              <p className="mt-4 text-sm text-muted">
                hr.job fields sent: <span data-testid="hr-job-fields">{demo.hrJobFields.join(",")}</span>. hr.job.state sent: <span data-testid="hr-job-state-sent">{demo.hrJobStateSent ? "yes" : "no"}</span>.
              </p>
              <p className="mt-2 text-sm text-muted">hr.job.state is not sent. Recruiting stops because no_of_recruitment is 0.</p>
              <p className="mt-2 break-all text-sm text-muted" data-testid="odoo-hosts">{demo.odooHosts.join(" ")}</p>
            </div>
          </CardBody>
        </Card>
      </section>

      <section id="synthetic-unset" className="scroll-mt-6">
        <Card>
          <CardHeader>
            <CardTitle>No connector configured</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="text-sm text-muted">
              The same fixture, with HIRE_CONNECTOR unset. Odoo, SMART, the generic API, and MCP are all unset. Sourcing still completes and no upstream request is sent.
            </p>
            <pre className="mt-4 overflow-x-auto rounded-xl bg-ink/[0.04] p-4 text-sm text-ink" data-testid="unset-result">{unsetResult}</pre>
            <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <dt className="text-xs font-bold uppercase tracking-wider text-muted">ok</dt>
                <dd className="mt-1 font-semibold text-ink">{String(demo.unset.ok)}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wider text-muted">erp</dt>
                <dd className="mt-1 font-semibold text-ink">{demo.unset.erp}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wider text-muted">linkedIn</dt>
                <dd className="mt-1 font-semibold text-ink">{String(demo.unset.linkedIn)}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wider text-muted">ERP fetches</dt>
                <dd className="mt-1 font-semibold text-ink" data-testid="unset-fetches">{demo.unset.fetchCount}</dd>
              </div>
            </dl>
          </CardBody>
        </Card>
      </section>

      <section id="synthetic-connectors" className="scroll-mt-6">
        <Card>
          <CardHeader>
            <CardTitle>SMART, generic HTTPS API, and MCP</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="mb-4 text-sm text-muted">Each connector is selected on its own, against a fixture host. No live request is sent.</p>
            <ul className="flex flex-col gap-3">
              {demo.connectors.map((item) => (
                <li key={item.erp} data-testid={`connector-${item.erp}`} className="rounded-xl bg-ink/[0.03] px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-ink">{item.label}</span>
                    <Badge tone={item.hired ? "success" : "danger"} size="sm">
                      <span data-testid={`connector-${item.erp}-outcome`}>{item.hired ? "hired" : "not hired"}</span>
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    erp {item.erp} · ok {String(item.ok)} · linkedIn {String(item.linkedIn)}
                  </p>
                  <p className="mt-1 break-all text-sm text-muted" data-testid={`connector-${item.erp}-hosts`}>{item.hosts.join(" ")}</p>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </section>
    </div>
  );
}
