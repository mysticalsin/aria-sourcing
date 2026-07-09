"use client";

import * as React from "react";
import {
  Sparkles,
  RotateCcw,
  ShieldCheck,
  Lock,
  Plus,
  Trash2,
  Brain,
  User,
  UserPlus,
  Pause,
  Play,
  MessageSquare,
} from "lucide-react";
import {
  useActions,
  useSeats,
  useGuardrails,
  useRole,
  useMemory,
} from "@/lib/store";
import { can } from "@/lib/rbac";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Field,
  Input,
  Switch,
  Textarea,
  useToast,
  useConfirm,
} from "@/components/ui";
import { cn } from "@/lib/utils";

const DEFAULT_PERSONA =
  "Warm, concise, peer-to-peer recruiter. Lead with the candidate's recent work, one genuine specific compliment, soft 15-minute ask. No corporate fluff, no AI slop.";

const PERSONA_MAX = 600;

/* ---- Brain-composition summary card -------------------------------------- */

function BrainSummary({
  ariaPrompt,
  activeRules,
  totalRules,
  personaLength,
  memoryCount,
}: {
  ariaPrompt: string;
  activeRules: number;
  totalRules: number;
  personaLength: number;
  memoryCount: number;
}) {
  const items = [
    {
      icon: <Sparkles className="h-4 w-4 text-electric" />,
      label: "Aria prompt",
      value: `${ariaPrompt.length} chars`,
    },
    {
      icon: <ShieldCheck className="h-4 w-4 text-success" />,
      label: "Active guardrails",
      value: `${activeRules} / ${totalRules}`,
    },
    {
      icon: <User className="h-4 w-4 text-violet" />,
      label: "Persona",
      value: `${personaLength} chars`,
    },
    {
      icon: <Brain className="h-4 w-4 text-aqua" />,
      label: "Memory entries",
      value: String(memoryCount),
    },
  ];

  return (
    <Card>
      <CardContent>
        <div className="flex items-center gap-2 mb-3">
          <MessageSquare className="h-4 w-4 text-ink-soft" />
          <p className="text-sm font-bold text-ink">Brain composition</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {items.map((item) => (
            <div
              key={item.label}
              className="flex items-start gap-2 rounded-2xl border border-line bg-canvas/40 px-3 py-2.5"
            >
              {item.icon}
              <div>
                <p className="text-xs text-muted">{item.label}</p>
                <p className="text-sm font-bold text-ink tabular-nums">{item.value}</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* ---- Roster helpers ------------------------------------------------------ */

/** Status dot color: active = green, benched (paused) = amber, disabled = grey. */
function seatDotClass(status: string) {
  if (status === "active") return "bg-success";
  if (status === "paused") return "bg-warning";
  return "bg-muted";
}

/** A short roster label for non-active seats. */
function seatStateLabel(status: string) {
  if (status === "paused") return "Benched";
  if (status === "disabled") return "Off";
  return null;
}

/** Inline "add agent" form for the roster rail. Name only; email is optional
 *  (auto-derived from the name when blank). Calls onAdded with the new seat id
 *  so the caller can select it immediately. */
function AddAgentForm({ onAdded }: { onAdded?: (id: string) => void }) {
  const actions = useActions();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const nameId = React.useId();
  const emailId = React.useId();

  function add() {
    const clean = name.trim();
    if (!clean) {
      toast({ title: "Name the agent", description: "Give the new agent a name to add it.", variant: "warning" });
      return;
    }
    const slug = clean.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
    const seat = actions.addSeat({
      name: clean,
      operatorEmail: email.trim() || `${slug || "agent"}@hermes.example`,
    });
    if (!seat) {
      toast({ title: "Admins only", description: "Your profile cannot add fleet agents.", variant: "warning" });
      return;
    }
    toast({
      title: `${seat.name} added`,
      description: "New agent created in dry-run mode. Bench or assign it any time.",
      variant: "success",
    });
    setName("");
    setEmail("");
    setOpen(false);
    onAdded?.(seat.id);
  }

  if (!open) {
    return (
      <Button
        variant="secondary"
        size="sm"
        className="w-full"
        leftIcon={<UserPlus className="h-4 w-4" />}
        onClick={() => setOpen(true)}
      >
        Add agent
      </Button>
    );
  }

  return (
    <div className="space-y-2.5 rounded-2xl border border-violet/15 bg-surface/60 p-3">
      <Field label="Agent name" htmlFor={nameId}>
        <Input
          id={nameId}
          autoFocus
          value={name}
          placeholder="e.g. Aria Agent 042"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
      </Field>
      <Field label="Operator email (optional)" htmlFor={emailId}>
        <Input
          id={emailId}
          value={email}
          placeholder="auto-filled if blank"
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
      </Field>
      <div className="flex gap-2">
        <Button size="sm" className="flex-1" onClick={add}>
          Add
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/* ---- Main persona editor ------------------------------------------------- */

export function PersonaEditor() {
  const seats = useSeats();
  const actions = useActions();
  const guardrails = useGuardrails();
  const role = useRole();
  const { toast } = useToast();
  const confirm = useConfirm();
  const isAdmin = can(role, "manage_settings");
  const canManageFleet = can(role, "manage_fleet");

  const [selectedSeatId, setSelectedSeatId] = React.useState<string | null>(
    seats[0]?.id ?? null,
  );
  const selectedSeat = seats.find((s) => s.id === selectedSeatId);

  /** Bench (pause) or activate the selected agent — bench keeps it on the roster
   *  but assigns it no new contacts until reactivated. */
  function toggleBench() {
    if (!selectedSeat) return;
    const benched = selectedSeat.status === "paused" || selectedSeat.status === "disabled";
    const next = benched ? "active" : "paused";
    actions.setSeatStatus(selectedSeat.id, next);
    toast({
      title: next === "active" ? `${selectedSeat.name} activated` : `${selectedSeat.name} benched`,
      description:
        next === "active"
          ? "Back in rotation, within its guardrails."
          : "Off rotation, no new contacts assigned until you activate it.",
      variant: next === "active" ? "success" : "info",
    });
  }

  const [persona, setPersona] = React.useState(selectedSeat?.persona ?? "");
  const personaDirty = persona !== (selectedSeat?.persona ?? "");

  React.useEffect(() => {
    setPersona(selectedSeat?.persona ?? "");
  }, [selectedSeatId, selectedSeat?.persona]);

  const [ariaPrompt, setAriaPrompt] = React.useState(guardrails.ariaPrompt);
  const ariaDirty = ariaPrompt !== guardrails.ariaPrompt;
  React.useEffect(() => {
    setAriaPrompt(guardrails.ariaPrompt);
  }, [guardrails.ariaPrompt]);

  const [newRule, setNewRule] = React.useState("");

  const seatMemory = useMemory(selectedSeatId ?? undefined);

  const locked = guardrails.rules.filter((r) => r.locked);
  const editable = guardrails.rules.filter((r) => !r.locked);
  const activeRules = guardrails.rules.filter((r) => r.enabled).length;

  function savePersona() {
    if (!selectedSeat) return;
    actions.updateSeat(selectedSeat.id, { persona: persona.trim() });
    toast({ title: "Persona saved", description: "Agent will use this voice on the next run.", variant: "success" });
  }

  function resetPersona() {
    setPersona(DEFAULT_PERSONA);
  }

  // Switching agents while a persona edit is unsaved silently discards it —
  // confirm first, mirroring the guardrail-disable confirm above.
  async function selectSeat(id: string) {
    if (id === selectedSeatId) return;
    if (personaDirty) {
      const ok = await confirm({
        title: "Discard unsaved persona changes?",
        description: "Your edited persona for this agent hasn't been saved. Switching agents will discard it.",
        confirmLabel: "Discard changes",
        danger: true,
      });
      if (!ok) return;
    }
    setSelectedSeatId(id);
  }

  function saveAria() {
    actions.updateAriaPrompt(ariaPrompt.trim());
    toast({ title: "Aria's prompt saved", variant: "success" });
  }

  function addRule() {
    const clean = newRule.trim();
    if (!clean) return;
    actions.addGuardrailRule(clean);
    setNewRule("");
    toast({ title: "Guardrail added", variant: "success" });
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

  if (seats.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <Sparkles className="h-12 w-12 text-muted mb-3" />
        <p className="text-sm font-semibold text-ink-soft">No agents yet</p>
        <p className="text-xs text-muted mt-1 mb-4">
          Add your first agent here, or deploy a fleet from the Agent Fleet page.
        </p>
        {canManageFleet ? (
          <div className="w-64">
            <AddAgentForm onAdded={setSelectedSeatId} />
          </div>
        ) : (
          <p className="text-xs text-muted">Ask an admin to add agents.</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex gap-6">
      {/* Left: roster + add agent */}
      <div className="w-52 shrink-0">
        <div className="rounded-3xl border border-violet/10 bg-surface/60 backdrop-blur overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-violet/10">
            <p className="text-xs font-bold text-ink-soft uppercase tracking-wider">Roster</p>
            <span className="text-xs text-muted tabular-nums">
              {seats.filter((s) => s.status === "active").length}/{seats.length} active
            </span>
          </div>
          <ul role="listbox" aria-label="Agent roster" className="max-h-[60vh] overflow-y-auto">
            {seats.map((seat) => {
              const stateLabel = seatStateLabel(seat.status);
              const benched = seat.status !== "active";
              return (
                <li key={seat.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selectedSeatId === seat.id}
                    aria-label={`${seat.name}${stateLabel ? `, ${stateLabel}` : ""}`}
                    onClick={() => selectSeat(seat.id)}
                    className={cn(
                      "w-full text-left px-4 py-3 text-sm transition-colors border-b border-violet/5 last:border-0",
                      selectedSeatId === seat.id
                        ? "bg-violet/10 text-violet font-semibold"
                        : "text-ink-soft hover:bg-surface/80",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={cn("h-2 w-2 shrink-0 rounded-full", seatDotClass(seat.status))}
                        aria-hidden
                      />
                      <span className={cn("min-w-0 flex-1 truncate", benched && "text-muted")}>
                        {seat.name}
                      </span>
                      {stateLabel && (
                        <span className="shrink-0 text-[0.625rem] font-semibold uppercase tracking-wide text-muted">
                          {stateLabel}
                        </span>
                      )}
                    </span>
                    <span className="block truncate pl-4 text-xs text-muted">{seat.operatorEmail}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {canManageFleet && (
            <div className="border-t border-violet/10 p-3">
              <AddAgentForm onAdded={setSelectedSeatId} />
            </div>
          )}
        </div>
      </div>

      {/* Right: editor sections */}
      <div className="flex-1 min-w-0 space-y-4">
        {/* Seat persona */}
        <Card>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-violet-soft text-violet">
                  <User className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-ink">Agent persona</p>
                    {selectedSeat && seatStateLabel(selectedSeat.status) && (
                      <Badge tone="warning" size="sm">
                        {seatStateLabel(selectedSeat.status)}
                      </Badge>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted">
                    {selectedSeat?.name ?? "No agent selected"}: the voice this agent writes with.
                  </p>
                </div>
              </div>
              {canManageFleet && selectedSeat && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  leftIcon={
                    selectedSeat.status === "active" ? (
                      <Pause className="h-3.5 w-3.5" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )
                  }
                  onClick={toggleBench}
                >
                  {selectedSeat.status === "active" ? "Bench" : "Activate"}
                </Button>
              )}
            </div>
            <Field
              label={`Persona (${persona.length} / ${PERSONA_MAX} chars)`}
              htmlFor="seat-persona"
            >
              <Textarea
                id="seat-persona"
                rows={4}
                maxLength={PERSONA_MAX}
                value={persona}
                disabled={!isAdmin || !selectedSeat}
                onChange={(e) => setPersona(e.target.value)}
                placeholder="Describe how this agent should write and behave…"
              />
            </Field>
            {isAdmin && selectedSeat && (
              <div className="flex justify-between items-center">
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
                  onClick={resetPersona}
                >
                  Reset to default
                </Button>
                <Button size="sm" onClick={savePersona} disabled={!personaDirty}>
                  Save persona
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Aria master prompt */}
        <Card>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-electric-soft text-electric">
                <Sparkles className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-bold text-ink">Aria: master prompt</p>
                <p className="text-xs text-muted">Every agent inherits this as their base brain.</p>
              </div>
            </div>
            <Field label="Master prompt" htmlFor="aria-prompt-soul">
              <Textarea
                id="aria-prompt-soul"
                rows={4}
                value={ariaPrompt}
                disabled={!isAdmin}
                onChange={(e) => setAriaPrompt(e.target.value)}
              />
            </Field>
            {isAdmin && (
              <div className="flex justify-end">
                <Button size="sm" onClick={saveAria} disabled={!ariaDirty}>
                  Save prompt
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Guardrail rules */}
        <Card>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-success" />
              <p className="text-sm font-bold text-ink">Guardrails</p>
              <Badge tone="success" size="sm">
                {activeRules} active
              </Badge>
            </div>

            {/* Locked rules */}
            {locked.length > 0 && (
              <ul className="space-y-1.5">
                {locked.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-start gap-2 rounded-xl bg-success-soft/40 px-3 py-2 text-xs text-ink-soft"
                  >
                    <Lock className="mt-0.5 h-3 w-3 shrink-0 text-success" />
                    {r.text}
                  </li>
                ))}
              </ul>
            )}

            {/* Editable rules */}
            {editable.length > 0 && (
              <ul className="divide-y divide-line rounded-2xl border border-line">
                {editable.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-3 py-2">
                    <Switch
                      checked={r.enabled}
                      disabled={!isAdmin}
                      onCheckedChange={() => toggleRule(r)}
                    />
                    <span
                      className={cn(
                        "min-w-0 flex-1 text-xs",
                        r.enabled ? "text-ink" : "text-muted line-through",
                      )}
                    >
                      {r.text}
                    </span>
                    {isAdmin && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Remove guardrail"
                        onClick={() => actions.removeGuardrailRule(r.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-danger" />
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
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<Plus className="h-4 w-4" />}
                  onClick={addRule}
                >
                  Add
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Brain composition summary */}
        <BrainSummary
          ariaPrompt={guardrails.ariaPrompt}
          activeRules={activeRules}
          totalRules={guardrails.rules.length}
          personaLength={(selectedSeat?.persona ?? "").length}
          memoryCount={seatMemory.length}
        />
      </div>
    </div>
  );
}
