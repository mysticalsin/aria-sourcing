"use client";

import * as React from "react";
import {
  Card,
  CardContent,
  CardTitle,
  Eyebrow,
  Badge,
  Button,
  Field,
  Input,
  Select,
  EmptyState,
  useToast,
} from "@/components/ui";
import { useSuppression, useActions } from "@/lib/store";
import { SUPPRESSION_TYPES } from "@/lib/types";
import type { SuppressionType } from "@/lib/types";
import { formatTimeAgo, cn, type Tone } from "@/lib/utils";
import { ShieldBan, Plus, Trash2, Mail, Globe, Linkedin } from "lucide-react";

const TYPE_TONE: Record<SuppressionType, Tone> = {
  email: "electric",
  domain: "violet",
  linkedin: "aqua",
};

const TYPE_ICON: Record<SuppressionType, React.ReactNode> = {
  email: <Mail className="h-3.5 w-3.5" aria-hidden />,
  domain: <Globe className="h-3.5 w-3.5" aria-hidden />,
  linkedin: <Linkedin className="h-3.5 w-3.5" aria-hidden />,
};

const PLACEHOLDER: Record<SuppressionType, string> = {
  email: "person@example.com",
  domain: "competitor.com",
  linkedin: "linkedin.com/in/handle",
};

export function SuppressionPanel() {
  const entries = useSuppression();
  const actions = useActions();
  const { toast } = useToast();

  const [type, setType] = React.useState<SuppressionType>("email");
  const [value, setValue] = React.useState("");
  const [reason, setReason] = React.useState("");

  const typeId = React.useId();
  const valueId = React.useId();
  const reasonId = React.useId();

  function handleAdd() {
    const v = value.trim();
    if (!v) {
      toast({ title: "Enter a value to suppress", variant: "error" });
      return;
    }
    actions.addSuppression({ type, value: v, reason: reason.trim() || "Manual suppression" });
    setValue("");
    setReason("");
    toast({
      title: "Suppression added",
      description: `${type}: ${v} will never be contacted by the fleet.`,
      variant: "success",
    });
  }

  function handleRemove(id: string, label: string) {
    actions.removeSuppression(id);
    toast({ title: "Suppression removed", description: label, variant: "info" });
  }

  return (
    <Card>
      <CardContent className="space-y-5">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-danger-soft text-danger" aria-hidden>
            <ShieldBan className="h-5 w-5" />
          </span>
          <div>
            <Eyebrow>Do-not-contact</Eyebrow>
            <CardTitle>Suppression list</CardTitle>
            <p className="mt-1 text-sm text-ink-soft">
              The global source of truth for who the fleet must never reach. Every allocation checks
              this list before assigning a contact. It also powers cross-seat de-dupe.
            </p>
          </div>
        </div>

        {/* Add form */}
        <div className="grid gap-3 rounded-2xl bg-canvas p-4 sm:grid-cols-[8rem,1fr,1fr,auto] sm:items-end">
          <Field label="Type" htmlFor={typeId}>
            <Select
              id={typeId}
              value={type}
              onChange={(e) => setType(e.target.value as SuppressionType)}
              options={SUPPRESSION_TYPES.map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) }))}
            />
          </Field>
          <Field label="Value" htmlFor={valueId}>
            <Input
              id={valueId}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={PLACEHOLDER[type]}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
              }}
            />
          </Field>
          <Field label="Reason" htmlFor={reasonId}>
            <Input
              id={reasonId}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Opted out / client of record"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
              }}
            />
          </Field>
          <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={handleAdd}>
            Add
          </Button>
        </div>

        {/* List */}
        {entries.length === 0 ? (
          <EmptyState
            icon={<ShieldBan className="h-6 w-6" />}
            title="No suppressions yet"
            description="Add emails, domains, or LinkedIn handles the fleet must never contact."
          />
        ) : (
          <ul className="divide-y divide-line">
            {entries.map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-3">
                <Badge tone={TYPE_TONE[e.type]} size="sm" className={cn("shrink-0 capitalize")}>
                  {TYPE_ICON[e.type]}
                  {e.type}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm font-semibold text-ink">{e.value}</p>
                  <p className="truncate text-xs text-muted">
                    {e.reason} · {e.source} · added {formatTimeAgo(e.createdAt)}
                    {e.expiresAt ? ` · expires ${formatTimeAgo(e.expiresAt)}` : " · permanent"}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove suppression ${e.value}`}
                  onClick={() => handleRemove(e.id, `${e.type}: ${e.value}`)}
                >
                  <Trash2 className="h-4 w-4 text-danger" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
