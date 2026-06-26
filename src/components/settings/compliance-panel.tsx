"use client";

import * as React from "react";
import {
  Card,
  CardContent,
  Eyebrow,
  CardTitle,
  Switch,
  Field,
  Input,
} from "@/components/ui";
import { useSettings, useActions } from "@/lib/store";
import type { ComplianceSettings } from "@/lib/types";
import { ShieldCheck } from "lucide-react";

type ToggleKey = "crmAuditLogs" | "unsubscribeEnforcement" | "ccpaDoNotSell" | "gdprMode";
type RetentionKey = "candidateRetentionDays" | "jdRetentionDays" | "emailContentRetentionDays";

const TOGGLES: { key: ToggleKey; label: string; description: string }[] = [
  {
    key: "crmAuditLogs",
    label: "CRM audit logs",
    description: "Record every status change, send, and approval to an immutable audit trail.",
  },
  {
    key: "unsubscribeEnforcement",
    label: "Unsubscribe enforcement",
    description: "Honour the do-not-contact list and unsubscribe requests across all channels.",
  },
  {
    key: "ccpaDoNotSell",
    label: "CCPA do-not-sell",
    description: "Suppress candidate data sharing for California residents on request.",
  },
  {
    key: "gdprMode",
    label: "GDPR mode",
    description: "Enable lawful-basis tracking plus export and erasure on candidate request.",
  },
];

const RETENTION: { key: RetentionKey; label: string; hint: string }[] = [
  { key: "candidateRetentionDays", label: "Candidate data (days)", hint: "Profiles & scores" },
  { key: "jdRetentionDays", label: "Job descriptions (days)", hint: "Intake & analysis" },
  { key: "emailContentRetentionDays", label: "Email content (days)", hint: "Outreach & replies" },
];

export function CompliancePanel() {
  const settings = useSettings();
  const actions = useActions();
  const compliance = settings.compliance;

  function patchCompliance(patch: Partial<ComplianceSettings>) {
    actions.updateSettings({ compliance: { ...compliance, ...patch } });
  }

  return (
    <Card>
      <CardContent className="space-y-6">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-soft text-violet" aria-hidden>
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <Eyebrow>Governance</Eyebrow>
            <CardTitle>Compliance &amp; data governance</CardTitle>
            <p className="mt-1 text-sm text-muted">
              GDPR export &amp; delete, do-not-contact enforcement, and retention windows. Applied to
              every candidate record.
            </p>
          </div>
        </div>

        <div className="divide-y divide-line rounded-2xl border border-line">
          {TOGGLES.map((t) => (
            <div key={t.key} className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <label htmlFor={`compliance-${t.key}`} className="text-sm font-semibold text-ink">
                  {t.label}
                </label>
                <p className="mt-0.5 text-xs text-muted">{t.description}</p>
              </div>
              <Switch
                id={`compliance-${t.key}`}
                checked={compliance[t.key]}
                onCheckedChange={(v) => patchCompliance({ [t.key]: v } as Partial<ComplianceSettings>)}
                label={t.label}
              />
            </div>
          ))}
        </div>

        <div>
          <Eyebrow>Data retention</Eyebrow>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            {RETENTION.map((r) => (
              <Field key={r.key} label={r.label} htmlFor={`retention-${r.key}`} hint={r.hint}>
                <Input
                  id={`retention-${r.key}`}
                  type="number"
                  min={1}
                  value={compliance[r.key]}
                  onChange={(e) =>
                    patchCompliance({
                      [r.key]: Math.max(1, Number(e.target.value) || 0),
                    } as Partial<ComplianceSettings>)
                  }
                />
              </Field>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">
            Records past their retention window are flagged for anonymization. Candidates can request
            data export or erasure at any time from their profile drawer.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
