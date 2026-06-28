"use client";

import * as React from "react";
import { Card, CardContent, Field, Textarea, Input, Button, Switch, Badge, useToast, useConfirm } from "@/components/ui";
import { useActions, useGuardrails, useRole } from "@/lib/store";
import { can } from "@/lib/rbac";
import { cn } from "@/lib/utils";
import { Lock, Plus, Sparkles, Trash2, ShieldCheck, Send } from "lucide-react";

export function GuardrailsPanel() {
  const guardrails = useGuardrails();
  const role = useRole();
  const actions = useActions();
  const { toast } = useToast();
  const confirm = useConfirm();
  const isAdmin = can(role, "manage_settings");

  const [prompt, setPrompt] = React.useState(guardrails.ariaPrompt);
  const [newRule, setNewRule] = React.useState("");
  const [ariaMsg, setAriaMsg] = React.useState("");
  const [ariaReply, setAriaReply] = React.useState<string | null>(null);
  const dirty = prompt !== guardrails.ariaPrompt;

  // keep textarea in sync if the stored prompt changes elsewhere
  React.useEffect(() => setPrompt(guardrails.ariaPrompt), [guardrails.ariaPrompt]);

  function savePrompt() {
    actions.updateAriaPrompt(prompt.trim());
    toast({ title: "Aria's prompt saved", description: "Every agent inherits it on the next run.", variant: "success" });
  }
  function addRule() {
    if (!newRule.trim()) return;
    actions.addGuardrailRule(newRule);
    setNewRule("");
    toast({ title: "Guardrail added", variant: "success" });
  }
  function sendAria() {
    if (!ariaMsg.trim()) return;
    const { reply } = actions.askAria(ariaMsg);
    setAriaReply(reply);
    setAriaMsg("");
  }
  // Confirm before turning a guardrail OFF — disabling a safety rule is the
  // destructive direction. Enabling stays a single click.
  async function toggleRule(r: { id: string; text: string; enabled: boolean }) {
    if (r.enabled) {
      const ok = await confirm({
        title: "Disable this guardrail?",
        description: `"${r.text}" will no longer constrain the fleet until you re-enable it.`,
        confirmLabel: "Disable",
        danger: true,
      });
      if (!ok) return;
    }
    actions.toggleGuardrailRule(r.id);
  }

  const locked = guardrails.rules.filter((r) => r.locked);
  const editable = guardrails.rules.filter((r) => !r.locked);

  return (
    <div className="space-y-4">
      {/* Aria master prompt */}
      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-electric-soft text-electric">
              <Sparkles className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-bold text-ink">Aria: the agent brain</p>
              <p className="text-xs text-muted">Master system prompt every agent inherits. Edit it directly, or ask Aria below.</p>
            </div>
          </div>
          <Field label="Master prompt" htmlFor="aria-prompt">
            <Textarea
              id="aria-prompt"
              rows={5}
              value={prompt}
              disabled={!isAdmin}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </Field>
          {isAdmin && (
            <div className="flex justify-end">
              <Button size="sm" onClick={savePrompt} disabled={!dirty}>
                Save prompt
              </Button>
            </div>
          )}

          {/* Ask Aria */}
          <div className="rounded-2xl border border-line bg-canvas/40 p-3">
            <p className="mb-2 text-xs font-semibold text-muted">Ask Aria to change a guardrail</p>
            <div className="flex gap-2">
              <Input
                value={ariaMsg}
                disabled={!isAdmin}
                placeholder='e.g. "Never contact anyone at our current clients"'
                onChange={(e) => setAriaMsg(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendAria()}
              />
              <Button variant="secondary" size="sm" leftIcon={<Send className="h-4 w-4" />} onClick={sendAria} disabled={!isAdmin}>
                Send
              </Button>
            </div>
            <div aria-live="polite">
              {ariaReply && (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-soft">
                  <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-electric" />
                  {ariaReply}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Locked safety rails */}
      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-success" />
            <p className="text-sm font-bold text-ink">Safety rails (locked)</p>
            <Badge tone="success" size="sm">
              anti-ban
            </Badge>
          </div>
          <ul className="space-y-2">
            {locked.map((r) => (
              <li key={r.id} className="flex items-start gap-2 rounded-xl bg-success-soft/40 px-3 py-2 text-sm text-ink-soft">
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                {r.text}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">These keep the fleet compliant and un-bannable. They cannot be turned off.</p>
        </CardContent>
      </Card>

      {/* Editable rules */}
      <Card>
        <CardContent className="space-y-3">
          <p className="text-sm font-bold text-ink">Your guardrails</p>
          {editable.length === 0 ? (
            <p className="text-sm text-muted">No custom guardrails yet. Add one below or ask Aria.</p>
          ) : (
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {editable.map((r) => (
                <li key={r.id} className="flex items-center gap-3 p-3">
                  <Switch checked={r.enabled} disabled={!isAdmin} onCheckedChange={() => toggleRule(r)} />
                  <span className={cn("min-w-0 flex-1 text-sm", r.enabled ? "text-ink" : "text-muted line-through")}>{r.text}</span>
                  {isAdmin && (
                    <Button variant="ghost" size="icon" aria-label="Remove guardrail" onClick={() => actions.removeGuardrailRule(r.id)}>
                      <Trash2 className="h-4 w-4 text-danger" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {isAdmin && (
            <div className="flex gap-2">
              <Input
                value={newRule}
                placeholder="Add a guardrail rule…"
                onChange={(e) => setNewRule(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addRule()}
              />
              <Button variant="secondary" size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={addRule}>
                Add
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
