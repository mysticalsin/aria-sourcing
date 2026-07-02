"use client";

import * as React from "react";
import { Database, Pin, PinOff, Plus, Pencil, Trash2, Check, X } from "lucide-react";
import { useSeats, useMemory, useActions, useRole } from "@/lib/store";
import { can } from "@/lib/rbac";
import type { MemoryKind } from "@/lib/types";
import { MEMORY_KINDS } from "@/lib/types";
import { Badge, Button, Card, CardContent, Input, Select, Textarea, Meter, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";

/* ---- kind colour map ----------------------------------------------------- */

const KIND_TONE: Record<MemoryKind, "electric" | "warning" | "violet" | "aqua"> = {
  fact: "electric",
  preference: "warning",
  instruction: "violet",
  episodic: "aqua",
};

/* ---- Add-entry form ------------------------------------------------------- */

function AddEntryForm({ seatId, onDone }: { seatId: string; onDone: () => void }) {
  const actions = useActions();
  const { toast } = useToast();
  const [kind, setKind] = React.useState<MemoryKind>("fact");
  const [content, setContent] = React.useState("");

  function submit() {
    const trimmed = content.trim();
    if (!trimmed) return;
    actions.addMemory(seatId, kind, trimmed);
    toast({ title: "Memory stored", variant: "success" });
    setContent("");
    onDone();
  }

  return (
    <div className="rounded-2xl border border-violet/20 bg-canvas/60 p-3 space-y-2">
      <div className="flex gap-2">
        <Select
          value={kind}
          onChange={(e) => setKind(e.target.value as MemoryKind)}
          className="w-36 shrink-0"
        >
          {MEMORY_KINDS.map((k) => (
            <option key={k} value={k}>
              {k.charAt(0).toUpperCase() + k.slice(1)}
            </option>
          ))}
        </Select>
        <Textarea
          rows={2}
          placeholder="Enter memory content…"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
          className="flex-1 resize-none"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" disabled={!content.trim()} onClick={submit}>
          Save
        </Button>
      </div>
    </div>
  );
}

/* ---- Single entry row ---------------------------------------------------- */

function EntryRow({
  entry,
  canEdit,
}: {
  entry: { id: string; seatId: string; kind: MemoryKind; content: string; pinned?: boolean; createdAt: string; updatedAt: string };
  canEdit: boolean;
}) {
  const actions = useActions();
  const { toast } = useToast();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(entry.content);

  function saveEdit() {
    if (!canEdit || !draft.trim()) return;
    actions.updateMemory(entry.id, { content: draft.trim() });
    setEditing(false);
    toast({ title: "Memory updated", variant: "success" });
  }

  function cancelEdit() {
    setDraft(entry.content);
    setEditing(false);
  }

  return (
    <li className="group flex items-start gap-2 rounded-2xl border border-violet/10 bg-surface/50 px-3 py-2.5 hover:bg-surface/80 transition-colors">
      <Badge tone={KIND_TONE[entry.kind]} size="sm" className="mt-0.5 shrink-0">
        {entry.kind}
      </Badge>

      {editing ? (
        <div className="flex-1 space-y-1.5">
          <Textarea
            autoFocus
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveEdit();
              if (e.key === "Escape") cancelEdit();
            }}
            className="resize-none text-sm"
          />
          <div className="flex gap-1.5 justify-end">
            <Button variant="ghost" size="icon" aria-label="Cancel edit" onClick={cancelEdit}>
              <X className="h-3.5 w-3.5 text-muted" />
            </Button>
            <Button size="icon" aria-label="Save edit" onClick={saveEdit} disabled={!draft.trim()}>
              <Check className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : (
        <p className="flex-1 min-w-0 text-sm text-ink leading-snug break-words">{entry.content}</p>
      )}

      {!editing && canEdit && (
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <Button
            variant="ghost"
            size="icon"
            aria-label={entry.pinned ? "Unpin" : "Pin"}
            onClick={() => actions.togglePinMemory(entry.id)}
          >
            {entry.pinned
              ? <PinOff className="h-3.5 w-3.5 text-violet" />
              : <Pin className="h-3.5 w-3.5 text-muted" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Edit memory"
            onClick={() => { setDraft(entry.content); setEditing(true); }}
          >
            <Pencil className="h-3.5 w-3.5 text-muted" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Delete memory"
            onClick={() => {
              actions.removeMemory(entry.id);
              toast({ title: "Memory removed", variant: "success" });
            }}
          >
            <Trash2 className="h-3.5 w-3.5 text-danger" />
          </Button>
        </div>
      )}

      {entry.pinned && !editing && (
        <Pin className="h-3.5 w-3.5 text-violet shrink-0 mt-0.5" aria-label="Pinned" />
      )}
    </li>
  );
}

/* ---- Main panel ---------------------------------------------------------- */

export function MemoryPanel() {
  const seats = useSeats();
  const canEditMemory = can(useRole(), "skills");
  const [selectedSeatId, setSelectedSeatId] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);

  // Auto-select first seat
  React.useEffect(() => {
    if (!selectedSeatId && seats.length > 0) setSelectedSeatId(seats[0].id);
  }, [seats, selectedSeatId]);

  const allMemory = useMemory();
  const seatMemory = useMemory(selectedSeatId ?? undefined);
  const settings = React.useContext(React.createContext<{ memoryCapacity?: number }>({}));

  // Capacity is global across all seats
  const capacity = 200; // default; settings.memoryCapacity is optional
  const entries = selectedSeatId ? seatMemory : allMemory;

  // Group by kind for display
  const pinned = entries.filter((e) => e.pinned);
  const byKind = MEMORY_KINDS.map((k) => ({
    kind: k,
    items: entries.filter((e) => !e.pinned && e.kind === k),
  })).filter((g) => g.items.length > 0);

  const selectedSeat = seats.find((s) => s.id === selectedSeatId);

  return (
    <div className="flex h-[calc(100vh-11rem)] min-h-[400px] gap-0 rounded-3xl overflow-hidden border border-violet/10 bg-surface/60 backdrop-blur shadow-soft">
      {/* Left pane — seat list */}
      <div className="w-56 shrink-0 border-r border-violet/10 overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-violet/10">
          <p className="text-xs font-bold text-ink-soft uppercase tracking-wider">Agents</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          <button
            type="button"
            onClick={() => setSelectedSeatId(null)}
            className={cn(
              "w-full text-left px-4 py-2.5 text-sm transition-colors",
              selectedSeatId === null
                ? "bg-violet/10 text-violet font-semibold"
                : "text-ink-soft hover:bg-surface/80",
            )}
          >
            All agents
            <span className="ml-1.5 text-xs text-muted">({allMemory.length})</span>
          </button>
          {seats.map((seat) => {
            const count = allMemory.filter((m) => m.seatId === seat.id).length;
            return (
              <button
                key={seat.id}
                type="button"
                onClick={() => setSelectedSeatId(seat.id)}
                className={cn(
                  "w-full text-left px-4 py-2.5 text-sm transition-colors",
                  selectedSeatId === seat.id
                    ? "bg-violet/10 text-violet font-semibold"
                    : "text-ink-soft hover:bg-surface/80",
                )}
              >
                <span className="block truncate">{seat.name}</span>
                <span className="text-xs text-muted">{count} entries</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right pane — memory entries */}
      <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-3 border-b border-violet/10 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-ink truncate">
              {selectedSeat ? selectedSeat.name : "All agents"}
            </p>
            <p className="text-xs text-muted">{entries.length} entries</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-40">
              <Meter label="Capacity" used={allMemory.length} limit={capacity} tone="violet" />
            </div>
            {selectedSeatId && canEditMemory && (
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<Plus className="h-4 w-4" />}
                onClick={() => setAdding(true)}
              >
                Add
              </Button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {adding && selectedSeatId && canEditMemory && (
            <AddEntryForm seatId={selectedSeatId} onDone={() => setAdding(false)} />
          )}

          {entries.length === 0 && !adding && (
            <div className="flex flex-col items-center justify-center h-48 text-center">
              <Database className="h-10 w-10 text-muted mb-3" />
              <p className="text-sm font-semibold text-ink-soft">No memories yet</p>
              <p className="text-xs text-muted mt-1">
                {selectedSeatId
                  ? "Add memories for this agent using the button above."
                  : "Select an agent and add memories."}
              </p>
            </div>
          )}

          {pinned.length > 0 && (
            <div>
              <p className="text-xs font-bold text-violet uppercase tracking-wider mb-2">Pinned</p>
              <ul className="space-y-2">
                {pinned.map((e) => <EntryRow key={e.id} entry={e} canEdit={canEditMemory} />)}
              </ul>
            </div>
          )}

          {byKind.map(({ kind, items }) => (
            <div key={kind}>
              <p className="text-xs font-bold text-ink-soft uppercase tracking-wider mb-2">{kind}</p>
              <ul className="space-y-2">
                {items.map((e) => <EntryRow key={e.id} entry={e} canEdit={canEditMemory} />)}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
