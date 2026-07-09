"use client";

import * as React from "react";
import { Badge, Button, Card, CardContent, Eyebrow, Field, Input, Select, useToast } from "@/components/ui";
import { useCandidates } from "@/lib/store";
import { MessageCircle, RefreshCw, ShieldCheck } from "lucide-react";

type TemplateParameter = {
  name: string;
  maxLength: number;
};

type ApprovedTemplate = {
  id: string;
  seatId: string;
  metaName: string;
  language: string;
  category: string;
  version: number;
  parameters: TemplateParameter[];
};

type TemplateListResponse = {
  ok: boolean;
  templates?: ApprovedTemplate[];
  error?: string;
};

type QueueResponse = {
  ok: boolean;
  status?: "sent" | "queued" | "skipped" | "error" | "reconciliation-required";
  detail?: string;
  error?: string;
};

/**
 * Cold WhatsApp is intentionally a template picker, not a composer. The
 * server supplies the Meta identity and each parameter bound; the operator
 * supplies only a candidate, bounded placeholder values, and an explicit
 * human approval before the existing dispatcher can deliver it.
 */
export function WhatsAppTemplatePicker() {
  const candidates = useCandidates();
  const { toast } = useToast();
  const [templates, setTemplates] = React.useState<ApprovedTemplate[]>([]);
  const [candidateId, setCandidateId] = React.useState("");
  const [templateId, setTemplateId] = React.useState("");
  const [parameterValues, setParameterValues] = React.useState<string[]>([]);
  const [humanApproval, setHumanApproval] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [outcome, setOutcome] = React.useState<string | null>(null);

  const eligibleCandidates = candidates.filter(
    (candidate) =>
      Boolean(candidate.phone?.trim()) &&
      !candidate.complianceFlags.doNotContact &&
      !candidate.complianceFlags.suppressed &&
      !candidate.complianceFlags.unsubscribed,
  );
  const selectedTemplate = templates.find((template) => template.id === templateId) ?? null;
  const selectedCandidate = eligibleCandidates.find((candidate) => candidate.id === candidateId) ?? null;

  const loadTemplates = React.useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/outreach/whatsapp-template", {
        headers: { accept: "application/json" },
        signal,
      });
      const result = (await response.json().catch(() => ({ ok: false }))) as TemplateListResponse;
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Could not load approved WhatsApp templates.");
      setTemplates(result.templates ?? []);
    } catch (error) {
      if (signal?.aborted) return;
      setLoadError(error instanceof Error ? error.message : "Could not load approved WhatsApp templates.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    void loadTemplates(controller.signal);
    return () => controller.abort();
  }, [loadTemplates]);

  React.useEffect(() => {
    setParameterValues(selectedTemplate?.parameters.map(() => "") ?? []);
    setHumanApproval(false);
    setOutcome(null);
  }, [templateId, selectedTemplate?.id, selectedTemplate?.parameters]);

  const candidateOptions = [
    { value: "", label: "Pick a contactable candidate…" },
    ...eligibleCandidates.map((candidate) => ({
      value: candidate.id,
      label: `${candidate.name} · ${candidate.currentTitle}`,
    })),
  ];
  const templateOptions = [
    { value: "", label: loading ? "Loading approved templates…" : "Pick a Meta-approved template…" },
    ...templates.map((template) => ({
      value: template.id,
      label: `${template.metaName} · ${template.language} · v${template.version}`,
    })),
  ];

  function updateParameter(index: number, value: string) {
    setParameterValues((current) => current.map((currentValue, currentIndex) => (currentIndex === index ? value : currentValue)));
    setHumanApproval(false);
    setOutcome(null);
  }

  async function queueTemplate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTemplate || !selectedCandidate?.phone || !humanApproval || submitting) return;

    setSubmitting(true);
    setOutcome(null);
    try {
      const response = await fetch("/api/outreach/whatsapp-template", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          candidateId: selectedCandidate.id,
          recipient: selectedCandidate.phone,
          seatId: selectedTemplate.seatId,
          templateId: selectedTemplate.id,
          parameters: parameterValues,
          humanApproval: true,
        }),
      });
      const result = (await response.json().catch(() => ({ ok: false }))) as QueueResponse;
      if (!response.ok || !result.ok) throw new Error(result.error ?? result.detail ?? "Could not queue the approved template.");

      const status = result.status === "sent" ? "Sent through the guarded WhatsApp dispatcher." : "Queued for policy-checked delivery.";
      setOutcome(status);
      setHumanApproval(false);
      toast({
        title: result.status === "sent" ? "WhatsApp template sent" : "WhatsApp template queued",
        description: status,
        variant: "success",
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Could not queue the approved template.";
      setOutcome(detail);
      toast({ title: "Template dispatch blocked", description: detail, variant: "error" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="whatsapp-template-picker-heading">
      <Card className="border-aqua/25">
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-aqua-soft text-aqua" aria-hidden>
                <MessageCircle className="h-4 w-4" />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id="whatsapp-template-picker-heading" className="text-base font-bold text-ink">
                    Meta-approved WhatsApp template
                  </h2>
                  <Badge tone="aqua" size="sm">Cold outreach only</Badge>
                </div>
                <p className="mt-1 text-sm text-muted">
                  Select an existing approved Meta template. This surface has no editable message body.
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              leftIcon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}
              loading={loading}
              onClick={() => void loadTemplates()}
            >
              Refresh
            </Button>
          </div>

          {loadError && (
            <div className="rounded-2xl border border-danger/20 bg-danger-soft px-4 py-3 text-sm font-medium text-danger" role="alert">
              {loadError}
            </div>
          )}

          {!loading && !loadError && templates.length === 0 && (
            <p className="rounded-2xl border border-line bg-canvas px-4 py-3 text-sm text-muted" role="status">
              No live-sender Meta templates with a bounded parameter schema are available.
            </p>
          )}

          <form className="space-y-5" onSubmit={(event) => void queueTemplate(event)}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Candidate" htmlFor="whatsapp-template-candidate" hint="Only contactable candidates with a phone number are listed.">
                <Select
                  id="whatsapp-template-candidate"
                  value={candidateId}
                  onChange={(event) => {
                    setCandidateId(event.target.value);
                    setHumanApproval(false);
                    setOutcome(null);
                  }}
                  options={candidateOptions}
                />
              </Field>
              <Field label="Approved template" htmlFor="whatsapp-template-id" hint="Loaded from the authenticated Meta template catalog.">
                <Select
                  id="whatsapp-template-id"
                  value={templateId}
                  onChange={(event) => setTemplateId(event.target.value)}
                  options={templateOptions}
                  disabled={loading || templates.length === 0}
                />
              </Field>
            </div>

            {selectedTemplate && (
              <>
                <div className="flex flex-wrap gap-2 rounded-2xl border border-line bg-canvas px-4 py-3" aria-label="Selected Meta template identity">
                  <Badge tone="aqua" size="sm">{selectedTemplate.metaName}</Badge>
                  <Badge tone="neutral" size="sm">{selectedTemplate.language}</Badge>
                  <Badge tone="neutral" size="sm">v{selectedTemplate.version}</Badge>
                  <Badge tone="neutral" size="sm">{selectedTemplate.category}</Badge>
                </div>

                <fieldset className="space-y-3 rounded-2xl border border-line bg-surface p-4" aria-describedby="whatsapp-template-parameter-help">
                  <legend className="px-1 text-sm font-semibold text-ink">Approved template parameters</legend>
                  <p id="whatsapp-template-parameter-help" className="text-xs text-muted">
                    These are bounded values for Meta&apos;s existing placeholders, not an editable outreach message.
                  </p>
                  {selectedTemplate.parameters.length === 0 ? (
                    <p className="text-sm text-muted">This approved template has no body parameters.</p>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2">
                      {selectedTemplate.parameters.map((parameter, index) => {
                        const id = `whatsapp-template-parameter-${parameter.name}`;
                        return (
                          <Field
                            key={parameter.name}
                            label={`{{${parameter.name}}}`}
                            htmlFor={id}
                            hint={`Maximum ${parameter.maxLength} characters.`}
                          >
                            <Input
                              id={id}
                              value={parameterValues[index] ?? ""}
                              maxLength={parameter.maxLength}
                              required
                              autoComplete="off"
                              onChange={(event) => updateParameter(index, event.target.value)}
                            />
                          </Field>
                        );
                      })}
                    </div>
                  )}
                </fieldset>

                <label className="flex items-start gap-3 rounded-2xl border border-aqua/20 bg-aqua-soft/40 p-4 text-sm text-ink-soft">
                  <input
                    type="checkbox"
                    checked={humanApproval}
                    onChange={(event) => setHumanApproval(event.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-line accent-aqua focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
                  />
                  <span>
                    <span className="font-semibold text-ink">I approve this exact Meta template and its displayed parameter values.</span>
                    <span className="mt-0.5 block text-xs text-muted">
                      Queueing records my human approval against the canonical template identity and normalized values.
                    </span>
                  </span>
                </label>
              </>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                leftIcon={<ShieldCheck className="h-4 w-4" aria-hidden />}
                loading={submitting}
                disabled={!selectedCandidate || !selectedTemplate || !humanApproval || submitting}
              >
                {submitting ? "Recording approval…" : "Approve and queue template"}
              </Button>
              <span className="text-xs text-muted">
                Consent, do-not-contact, sender, template status, and delivery caps are re-checked at dispatch.
              </span>
            </div>
          </form>

          {outcome && (
            <p className="text-sm text-muted" aria-live="polite" role="status">
              {outcome}
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
