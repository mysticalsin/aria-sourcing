"use client";

import * as React from "react";
import {
  Card,
  CardHeader,
  CardBody,
  CardTitle,
  Eyebrow,
  Badge,
  Button,
  Textarea,
  Field,
  useToast,
} from "@/components/ui";
import { useActions, useCandidate, useCampaign } from "@/lib/store";
import { toneForIntent, copyToClipboard, formatPercent } from "@/lib/utils";
import type { ClassifiedReply, ReplyIntent } from "@/lib/types";
import {
  Sparkles,
  Wand2,
  Copy,
  Check,
  Lightbulb,
  ListChecks,
  MessageSquareQuote,
  Send,
} from "lucide-react";

const INTENT_LABELS: Record<ReplyIntent, string> = {
  INTERESTED: "Interested",
  QUALIFIED_INTEREST: "Qualified interest",
  NOT_INTERESTED: "Not interested",
  REFERRAL: "Referral",
  OOO: "Out of office",
  UNCLEAR: "Unclear",
  NEGATIVE: "Negative",
};

const SAMPLE_REPLIES: { label: string; text: string }[] = [
  {
    label: "Interested",
    text:
      "Thanks for reaching out. Honestly, the timing is good. The stack you described is exactly what I want to be working on next, and going fully remote is a big plus. I'm free Thursday or Friday afternoon (CET) for a quick intro call. What works on your end?",
  },
  {
    label: "Qualified",
    text:
      "Appreciate the note. I'm not actively looking, but I'd be open to hearing more if the comp band is competitive and there's real ownership of the platform. Can you share the salary range and a bit about team size before we set anything up?",
  },
  {
    label: "Not interested",
    text:
      "Thanks for thinking of me, but I'm really happy where I am right now and not exploring new roles. Best of luck filling the position.",
  },
  {
    label: "Negative",
    text:
      "Please stop emailing me. I never signed up for this and I'd like to be removed from your list immediately, otherwise I'll be reporting these messages as spam.",
  },
];

export function ReplyClassifier({
  campaignId,
  candidateId,
}: {
  campaignId?: string;
  candidateId?: string;
}) {
  const a = useActions();
  const { toast } = useToast();
  const [text, setText] = React.useState("");
  const [classifying, setClassifying] = React.useState(false);
  const [result, setResult] = React.useState<ClassifiedReply | null>(null);
  const [copied, setCopied] = React.useState(false);
  const resultCandidate = useCandidate(result?.candidateId);
  const resultCampaign = useCampaign(resultCandidate?.campaignId);

  const inputId = React.useId();

  async function handleClassify() {
    const trimmed = text.trim();
    if (!trimmed) {
      toast({
        title: "Nothing to classify",
        description: "Paste the candidate's reply text first.",
        variant: "warning",
      });
      return;
    }
    setClassifying(true);
    setResult(null);
    try {
      // F-1: classifyAndStoreReply is now async (routes through live Aria when available).
      const { reply } = await a.classifyAndStoreReply({
        text: trimmed,
        campaignId,
        candidateId,
      });
      setResult(reply);
      toast({
        title: "Reply classified",
        description: `${INTENT_LABELS[reply.intent]} · ${formatPercent(reply.confidence)} confidence`,
        variant: "info",
      });
    } catch {
      toast({
        title: "Classification failed",
        description: "Could not classify the reply. Please try again.",
        variant: "error",
      });
    } finally {
      setClassifying(false);
    }
  }

  async function handleCopyDraft() {
    if (!result) return;
    const ok = await copyToClipboard(result.draftResponse);
    toast({
      title: ok ? "Draft copied to clipboard" : "Couldn't copy",
      description: ok ? "Review before sending. Nothing is auto-sent." : undefined,
      variant: ok ? "success" : "error",
    });
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    }
  }

  function handleSendReply() {
    if (!result) return;
    if (resultCampaign?.status === "Paused") {
      toast({
        title: "Campaign is paused",
        description: `${resultCampaign.title} is paused — resume it before drafting new outreach.`,
        variant: "warning",
      });
      return;
    }
    const msg = a.draftReplyResponse(result.id);
    if (!msg) {
      toast({ title: "Could not draft a reply", description: "No linked candidate for this reply.", variant: "error" });
      return;
    }
    toast({
      title: "Reply drafted",
      description: "Review it in the outreach queue. Nothing is sent until you approve it.",
      variant: "success",
    });
  }

  return (
    <Card className="animate-fade-in">
      <CardHeader className="flex items-start justify-between gap-4">
        <div>
          <Eyebrow>Reply triage</Eyebrow>
          <CardTitle className="mt-1 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-tangerine" aria-hidden />
            Paste reply to classify
          </CardTitle>
          <p className="mt-1 text-sm text-muted">
            Intent, confidence, and a suggested draft. Drafts are never sent automatically.
          </p>
        </div>
      </CardHeader>

      <CardBody className="space-y-5">
        <Field
          label="Reply text"
          htmlFor={inputId}
          hint="Paste an email or LinkedIn reply, or load a sample below."
        >
          <Textarea
            id={inputId}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Thanks for reaching out. This actually sounds interesting…"
            className="min-h-[140px]"
          />
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">
            Samples
          </span>
          {SAMPLE_REPLIES.map((s) => (
            <Button
              key={s.label}
              variant="subtle"
              size="sm"
              leftIcon={<MessageSquareQuote className="h-3.5 w-3.5" aria-hidden />}
              onClick={() => {
                setText(s.text);
                setResult(null);
              }}
            >
              {s.label}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            loading={classifying}
            leftIcon={<Wand2 className="h-4 w-4" aria-hidden />}
            onClick={handleClassify}
          >
            {classifying ? "Classifying…" : "Classify reply"}
          </Button>
          {text.trim() && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setText("");
                setResult(null);
              }}
            >
              Clear
            </Button>
          )}
        </div>

        {result && (
          <div className="space-y-4 rounded-2xl border border-line bg-canvas p-5 animate-fade-in">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={toneForIntent(result.intent)} dot>
                {INTENT_LABELS[result.intent]}
              </Badge>
              <Badge tone="neutral" size="sm">
                {formatPercent(result.confidence)} confidence
              </Badge>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                  <Lightbulb className="h-3.5 w-3.5" aria-hidden />
                  Reasoning
                </p>
                <p className="text-sm leading-relaxed text-ink-soft">{result.reasoning}</p>
              </div>
              <div className="space-y-1.5">
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                  <ListChecks className="h-3.5 w-3.5" aria-hidden />
                  Suggested action
                </p>
                <p className="text-sm leading-relaxed text-ink-soft">{result.suggestedAction}</p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Draft response
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    leftIcon={
                      copied ? (
                        <Check className="h-3.5 w-3.5" aria-hidden />
                      ) : (
                        <Copy className="h-3.5 w-3.5" aria-hidden />
                      )
                    }
                    onClick={handleCopyDraft}
                  >
                    {copied ? "Copied" : "Copy draft"}
                  </Button>
                  {result.candidateId && (
                    <Button
                      variant="secondary"
                      size="sm"
                      leftIcon={<Send className="h-3.5 w-3.5" aria-hidden />}
                      onClick={handleSendReply}
                    >
                      Send reply
                    </Button>
                  )}
                </div>
              </div>
              <pre className="whitespace-pre-wrap rounded-2xl border border-line bg-surface p-4 font-sans text-sm leading-relaxed text-ink">
                {result.draftResponse}
              </pre>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
