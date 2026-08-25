"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Badge, Card, CardContent, Eyebrow } from "@/components/ui";
import { Radio, Webhook, Zap } from "lucide-react";

/**
 * Operator-facing explanation of event-driven reply handling.
 * No secrets; documents the webhook path so tokens are not burned on idle polls.
 */
export function ReplyAutopilotPanel() {
  return (
    <Card className="overflow-hidden border-aqua/25 bg-gradient-to-br from-surface to-aqua/[0.05]">
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Eyebrow>Replies</Eyebrow>
            <p className="mt-1 text-sm font-semibold text-ink">Event-driven candidate answers</p>
            <p className="mt-1 max-w-xl text-xs text-muted">
              When a candidate replies, your mail provider (or adapter) POSTs to the signed inbound
              webhook. ARIA classifies that reply once — the loop does not poll inboxes or spend LLM
              tokens on idle ticks.
            </p>
          </div>
          <Badge tone="success" size="sm" dot>
            Webhook-first
          </Badge>
        </div>

        <ol className="space-y-2">
          {[
            {
              icon: <Webhook className="h-3.5 w-3.5" aria-hidden />,
              title: "Provider → POST /api/webhooks/email-inbound",
              body: "HMAC signature (x-aria-signature). Tenant routed by delivered-to mailbox, never the sender.",
            },
            {
              icon: <Zap className="h-3.5 w-3.5" aria-hidden />,
              title: "Enqueue inbound_classify (idempotent)",
              body: "Only for new messages — duplicates from retries do not re-queue or re-bill the model.",
            },
            {
              icon: <Radio className="h-3.5 w-3.5" aria-hidden />,
              title: "Loop claims → classify once → draft if Interested",
              body: "Positive intents can enqueue a follow-up draft for entitled autopilot; sends still need approval.",
            },
          ].map((step, i) => (
            <motion.li
              key={step.title}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="flex gap-3 rounded-2xl border border-line bg-surface/80 p-3"
            >
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ink/[0.06] text-ink-soft">
                {step.icon}
              </div>
              <div>
                <p className="text-sm font-semibold text-ink">{step.title}</p>
                <p className="mt-0.5 text-xs text-muted">{step.body}</p>
              </div>
            </motion.li>
          ))}
        </ol>

        <p className="text-xs text-muted">
          Ops: set <code className="rounded bg-ink/[0.06] px-1 font-mono">EMAIL_INBOUND_WEBHOOK_SECRET</code>,
          map mailboxes in <code className="rounded bg-ink/[0.06] px-1 font-mono">inbound_mailbox_routes</code>,
          keep loop kill-switch off only after DB proofs. See{" "}
          <code className="rounded bg-ink/[0.06] px-1 font-mono">docs/INBOUND_REPLY_AUTOPILOT.md</code>.
        </p>
      </CardContent>
    </Card>
  );
}
