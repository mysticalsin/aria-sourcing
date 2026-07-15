"use client";

import * as React from "react";
import { Card, CardContent, Eyebrow, Badge, Button, useToast } from "@/components/ui";
import { useActions } from "@/lib/store";
import type { SkillUpdate } from "@/lib/types";
import type { Tone } from "@/lib/utils";
import { Check, X, ArrowRight, Sparkles, FileCode2 } from "lucide-react";

const STATUS_TONE: Record<SkillUpdate["status"], Tone> = {
  proposed: "warning",
  accepted: "success",
  rejected: "danger",
};

const STATUS_LABEL: Record<SkillUpdate["status"], string> = {
  proposed: "Proposed",
  accepted: "Accepted",
  rejected: "Rejected",
};

export function SkillUpdateCard({
  skillUpdate,
  campaignId,
}: {
  skillUpdate: SkillUpdate;
  campaignId: string;
}) {
  const actions = useActions();
  const { toast } = useToast();
  const isProposed = skillUpdate.status === "proposed";

  function decide(status: "accepted" | "rejected") {
    const updated = actions.setSkillUpdateStatus(campaignId, skillUpdate.id, status);
    if (!updated) {
      toast({
        title: "Couldn't save the learning decision",
        description: "Refresh the campaign and try again.",
        variant: "error",
      });
      return;
    }
    toast({
      title: status === "accepted" ? "Skill update accepted" : "Skill update rejected",
      description:
        status === "accepted"
          ? `${skillUpdate.title} is now part of the playbook.`
          : `${skillUpdate.title} was dismissed.`,
      variant: status === "accepted" ? "success" : "info",
    });
  }

  return (
    <Card className="flex h-full flex-col">
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Eyebrow>Self-improvement</Eyebrow>
            <h3 className="text-base font-bold text-ink">{skillUpdate.title}</h3>
            <code className="mt-1 inline-flex items-center gap-1 font-mono text-xs text-ink-soft">
              <FileCode2 className="h-3.5 w-3.5 text-muted" aria-hidden />
              {skillUpdate.skill}.md
            </code>
          </div>
          <Badge tone={STATUS_TONE[skillUpdate.status]} dot>
            {STATUS_LABEL[skillUpdate.status]}
          </Badge>
        </div>

        <p className="text-sm leading-relaxed text-ink-soft">{skillUpdate.rationale}</p>

        <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
          <div className="rounded-2xl bg-ink/[0.04] px-3.5 py-3">
            <div className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted">
              Before
            </div>
            <p className="mt-1 text-sm leading-relaxed text-ink-soft">{skillUpdate.before}</p>
          </div>
          <ArrowRight className="mx-auto hidden h-4 w-4 shrink-0 text-muted sm:block" aria-hidden />
          <div className="rounded-2xl bg-success-soft px-3.5 py-3">
            <div className="text-[0.6875rem] font-semibold uppercase tracking-wide text-success">
              After
            </div>
            <p className="mt-1 text-sm leading-relaxed text-ink">{skillUpdate.after}</p>
          </div>
        </div>

        <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-1">
          <Badge tone="electric">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            {skillUpdate.impact}
          </Badge>

          {isProposed ? (
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<X className="h-4 w-4" />}
                onClick={() => decide("rejected")}
              >
                Reject
              </Button>
              <Button
                variant="primary"
                size="sm"
                leftIcon={<Check className="h-4 w-4" />}
                onClick={() => decide("accepted")}
              >
                Accept
              </Button>
            </div>
          ) : (
            <Badge tone={STATUS_TONE[skillUpdate.status]} size="sm">
              {STATUS_LABEL[skillUpdate.status]}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
