"use client";

import * as React from "react";
import { Field, Textarea, Input, Button, useToast } from "@/components/ui";
import { useActions } from "@/lib/store";
import { humanize } from "@/lib/humanizer";
import type { AgentSeat } from "@/lib/types";
import { Save, Sparkles, ShieldCheck } from "lucide-react";

/**
 * Editable per-agent voice. The persona steers tone; the Humanizer still strips
 * AI slop from every generated message, so the agent can never ship robotic copy.
 */
export function AgentPromptEditor({ seat }: { seat: AgentSeat }) {
  const actions = useActions();
  const { toast } = useToast();

  const [persona, setPersona] = React.useState(seat.persona);
  const [signature, setSignature] = React.useState(seat.signature);

  // Keep local drafts in sync if the seat changes underneath us.
  React.useEffect(() => {
    setPersona(seat.persona);
    setSignature(seat.signature);
  }, [seat.id, seat.persona, seat.signature]);

  const dirty = persona !== seat.persona || signature !== seat.signature;
  const tells = React.useMemo(() => humanize(persona).removed, [persona]);

  const personaId = React.useId();
  const signatureId = React.useId();

  function handleSave() {
    actions.updateSeat(seat.id, { persona: persona.trim(), signature: signature.trim() });
    toast({
      title: "Agent voice saved",
      description: `${seat.name} will write in this voice. The Humanizer still cleans every send.`,
      variant: "success",
    });
  }

  return (
    <div className="space-y-4 rounded-2xl bg-canvas p-4">
      <Field
        label="Agent persona prompt"
        htmlFor={personaId}
        hint="How this agent writes: tone, what to lead with, what to avoid."
      >
        <Textarea
          id={personaId}
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
          rows={5}
          placeholder="Warm, concise, peer-to-peer. Lead with the candidate's recent work, one genuine specific compliment, soft 15-minute ask. No corporate fluff."
        />
      </Field>

      <Field label="Signature" htmlFor={signatureId} hint="Appended to every message from this agent.">
        <Input
          id={signatureId}
          value={signature}
          onChange={(e) => setSignature(e.target.value)}
          placeholder="— Hermes (dry-run on behalf of the hiring team)"
        />
      </Field>

      <div className="flex items-start gap-2 rounded-2xl bg-aqua-soft px-3.5 py-3 text-aqua">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p className="text-xs leading-relaxed">
          This is the agent&apos;s voice. The Humanizer always runs after generation and strips AI
          slop (em-dashes, &ldquo;leverage&rdquo;, &ldquo;robust&rdquo;, &ldquo;seamless&rdquo;…)
          from every message before it is ever queued.
        </p>
      </div>

      {tells.length > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <Sparkles className="h-3.5 w-3.5 text-violet" aria-hidden />
          Humanizer would tidy {tells.length} {tells.length === 1 ? "tell" : "tells"} here:{" "}
          <span className="font-medium text-ink-soft">{tells.join(", ")}</span>
        </p>
      )}

      <div className="flex justify-end">
        <Button
          variant="primary"
          size="sm"
          leftIcon={<Save className="h-4 w-4" />}
          disabled={!dirty}
          onClick={handleSave}
        >
          Save voice
        </Button>
      </div>
    </div>
  );
}
