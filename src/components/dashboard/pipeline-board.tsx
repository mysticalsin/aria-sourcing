"use client";

import { Card, Eyebrow } from "@/components/ui";
import { PROCESSING_STAGES, type ProcessingStageId } from "@/lib/processing-stages";
import { cn } from "@/lib/utils";

export interface PipelinePerson {
  id: string;
  name: string;
  title: string;
  company: string;
  stageId: ProcessingStageId;
  score: number | null;
}

/** Stage columns in Tony's card language. Selecting a person is optional. */
export function PipelineBoard({
  people,
  selectedId,
  onSelect,
}: {
  people: readonly PipelinePerson[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="pipeline-board">
      {PROCESSING_STAGES.map((stage) => {
        const column = people.filter((person) => person.stageId === stage.id);
        return (
          <Card key={stage.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <h3 className="eyebrow">{stage.label}</h3>
              <p className="text-3xl font-extrabold leading-none tracking-tight tabular-nums text-ink">
                <span className="sr-only">{stage.label} </span>
                {column.length}
              </p>
            </div>
            {column.length === 0 ? (
              <p className="mt-3 text-xs text-muted">Nobody here</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {column.map((person) => {
                  const selected = person.id === selectedId;
                  return (
                    <li key={person.id}>
                      <button
                        type="button"
                        onClick={() => onSelect?.(person.id)}
                        aria-pressed={selected}
                        className={cn(
                          "flex w-full items-center justify-between gap-3 rounded-2xl border border-line bg-canvas px-3 py-2 text-left",
                          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric",
                          selected && "border-tangerine shadow-glow",
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-bold text-ink">{person.name}</span>
                          <span className="block truncate text-xs text-muted">
                            {person.title}
                            {person.company ? ` · ${person.company}` : ""}
                          </span>
                        </span>
                        <span className="text-sm font-extrabold tabular-nums text-ink">{person.score ?? "—"}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        );
      })}
    </div>
  );
}
