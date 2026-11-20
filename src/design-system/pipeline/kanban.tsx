"use client";

import type { DragEvent } from "react";
import { CandidateCard } from "../candidate/candidate-card";
import type { SyntheticCandidate } from "../data/synthetic";
import { cx } from "../tokens";
import { STAGES, stageLabel, type StageId } from "./stages";

export function PipelineKanban({
  people,
  stages,
  announcement,
  onMoveKey,
  onDrop,
}: {
  people: readonly SyntheticCandidate[];
  stages: Readonly<Record<string, StageId>>;
  announcement: string;
  onMoveKey: (id: string, key: string) => void;
  onDrop: (id: string, stage: StageId) => void;
}) {
  return (
    <div>
      <p id="pipeline-help" className="ds-note">
        Left and right arrows move the focused person by one stage. Hired does not accept a move.
      </p>
      <div className="ds-kanban" aria-describedby="pipeline-help">
        {STAGES.map((stage) => {
          const items = people.filter((person) => stages[person.id] === stage.id);
          return (
            <section
              key={stage.id}
              className={cx("ds-col", stage.gated && "ds-col-gated")}
              aria-label={`${stage.label} column, ${items.length} ${items.length === 1 ? "person" : "people"}`}
              data-stage-id={stage.id}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event: DragEvent<HTMLElement>) => {
                event.preventDefault();
                const id = event.dataTransfer.getData("text/plain");
                if (id) onDrop(id, stage.id);
              }}
            >
              <div className="ds-col-head">
                <span>{stage.label}</span>
                <span className="ds-num">
                  {items.length}
                  {stage.gated ? " · Gated" : ""}
                </span>
              </div>
              <div className="ds-col-body">
                {items.length === 0 ? <p className="ds-empty">Empty</p> : null}
                {items.map((person) => (
                  <CandidateCard
                    key={person.id}
                    person={person}
                    stage={stage.id}
                    onDragStart={() => undefined}
                    onKeyDown={(key) => onMoveKey(person.id, key)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <p className="ds-live" role="status" aria-live="polite">
        {announcement}
      </p>
      <p className="ds-sr">{STAGES.map((stage) => stageLabel(stage.id)).join(", ")}</p>
    </div>
  );
}
