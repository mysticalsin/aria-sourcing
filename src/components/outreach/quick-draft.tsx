"use client";

import * as React from "react";
import { Card, CardContent, Eyebrow, Badge, Select, Button, Field, useToast } from "@/components/ui";
import { useCampaigns, useCandidates, useActions } from "@/lib/store";
import {
  OUTREACH_TONES,
  OUTREACH_CHANNELS,
  type OutreachTone,
  type OutreachChannel,
  type OutreachMessage,
} from "@/lib/types";
import { Sparkles, ShieldCheck } from "lucide-react";
import { recordedCandidateLawfulBasis } from "@/lib/candidate-lawful-basis";

export function QuickDraft() {
  const candidates = useCandidates();
  const campaigns = useCampaigns();
  const actions = useActions();
  const { toast } = useToast();

  const [candidateId, setCandidateId] = React.useState("");
  const [tone, setTone] = React.useState<OutreachTone>("Casual Professional");
  const [channel, setChannel] = React.useState<OutreachChannel>("Email");
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<OutreachMessage | null>(null);

  // Only contactable candidates in the picker
  const eligible = candidates.filter(
    (c) =>
      !c.complianceFlags.doNotContact &&
      !c.complianceFlags.suppressed &&
      (c.provenance !== "manual" ||
        Boolean(recordedCandidateLawfulBasis(c))),
  );

  const candidateOptions = [
    { value: "", label: "Pick a candidate…" },
    ...eligible.map((c) => ({
      value: c.id,
      label: [c.name, c.currentTitle].filter(Boolean).join(", "),
    })),
  ];

  const toneOptions = OUTREACH_TONES.map((t) => ({ value: t, label: t }));
  const channelOptions = OUTREACH_CHANNELS.map((ch) => ({ value: ch, label: ch }));

  React.useEffect(() => {
    setResult(null);
  }, [candidateId, tone, channel]);

  async function handleDraft() {
    if (!candidateId) return;
    const candidate = eligible.find((c) => c.id === candidateId);
    const campaign = candidate ? campaigns.find((camp) => camp.id === candidate.campaignId) : undefined;
    if (campaign?.status === "Paused") {
      toast({
        title: "Campaign is paused",
        description: `${campaign.title} is paused. Resume it before drafting new outreach.`,
        variant: "warning",
      });
      return;
    }
    setLoading(true);
    setResult(null);
    let msg: OutreachMessage | null;
    try {
      msg = await actions.generateOutreachLive(candidateId, tone, channel);
    } catch {
      // A live-runtime hiccup should never block drafting — fall back to the
      // template path so the human still gets a draft to review.
      msg = actions.generateOutreachFor(candidateId, tone, channel);
      toast({ title: "Aria is unavailable, used the template draft instead.", variant: "info" });
    }
    setResult(msg);
    setLoading(false);
  }

  return (
    <Card className="relative overflow-hidden border-electric/25">
      {/* Gradient accent stripe */}
      <div
        className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-electric via-violet to-tangerine"
        aria-hidden
      />

      <CardContent className="pt-6">
        {/* Header */}
        <div className="mb-5">
          <Eyebrow className="flex items-center gap-1.5 text-electric">
            <Sparkles className="h-3 w-3" aria-hidden />
            Aria can write this for you
          </Eyebrow>
          <p className="mt-1 text-base font-bold text-ink">Draft a message in seconds</p>
          <p className="mt-0.5 text-sm text-muted">
            Pick a candidate, choose tone and channel. The system writes a personalised message
            and holds it for your review.
          </p>
        </div>

        {/* Controls */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Candidate" htmlFor="qd-candidate">
            <Select
              id="qd-candidate"
              value={candidateId}
              onChange={(e) => setCandidateId(e.target.value)}
              options={candidateOptions}
            />
          </Field>

          <Field label="Tone" htmlFor="qd-tone">
            <Select
              id="qd-tone"
              value={tone}
              onChange={(e) => setTone(e.target.value as OutreachTone)}
              options={toneOptions}
            />
          </Field>

          <Field label="Channel" htmlFor="qd-channel">
            <Select
              id="qd-channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value as OutreachChannel)}
              options={channelOptions}
            />
          </Field>
        </div>

        {/* CTA */}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button
            variant="gradient"
            leftIcon={<Sparkles className="h-4 w-4" aria-hidden />}
            loading={loading}
            disabled={!candidateId || loading}
            onClick={handleDraft}
          >
            {loading ? "Drafting…" : "Draft it for me"}
          </Button>

          <span className="flex items-center gap-1.5 text-xs text-muted">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Lands in the approval queue. Nothing is ever auto-sent.
          </span>
        </div>

        {/* Generated result */}
        {result && !loading && (
          <div className="mt-6 animate-fade-in space-y-4 rounded-2xl border border-electric/20 bg-surface/80 p-5 backdrop-blur-sm">
            {/* Subject */}
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted">
                Subject
              </p>
              <p className="font-semibold text-ink">{result.subject}</p>
            </div>

            {/* Body */}
            <div className="border-t border-line pt-4">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted">
                Message
              </p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
                {result.body}
              </p>
            </div>

            {/* Personalization evidence chips */}
            {result.personalizationEvidence.length > 0 && (
              <div className="border-t border-line pt-4">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted">
                  Personalised using
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {result.personalizationEvidence.map((evidence, i) => (
                    <Badge key={i} tone="electric" size="sm">
                      {evidence}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Approval note */}
            <div className="flex items-center gap-1.5 border-t border-line pt-3 text-xs text-muted">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
              Draft saved to the approval queue above. Approve it there before anything goes out.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
