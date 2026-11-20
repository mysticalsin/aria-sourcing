import type { SyntheticCandidate } from "../data/synthetic";
import { DsBadge } from "../primitives/badge";
import { stageLabel, type StageId } from "../pipeline/stages";

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}` : name.slice(0, 2);
  return letters.toUpperCase();
}

export function CandidateCard({
  person,
  stage,
  onKeyDown,
  onDragStart,
}: {
  person: SyntheticCandidate;
  stage: StageId;
  onKeyDown: (key: string) => void;
  onDragStart: () => void;
}) {
  const label = stageLabel(stage);
  return (
    <button
      type="button"
      className="ds-person"
      draggable
      data-candidate-id={person.id}
      aria-keyshortcuts="ArrowLeft ArrowRight"
      aria-roledescription="candidate in the pipeline"
      aria-label={`${person.name}, ${label}, suggestion ${person.score} out of 100. Left or right arrow moves the stage.`}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", person.id);
        event.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          onKeyDown(event.key);
        }
      }}
    >
      <div className="ds-person-top">
        <span className="ds-avatar" aria-hidden="true">
          {initials(person.name)}
        </span>
        <DsBadge tone="info">{person.score}</DsBadge>
      </div>
      <h3>{person.name}</h3>
      <p>{person.role}</p>
      <p className="ds-muted">
        {person.location} · {person.language}
      </p>
      <div className="ds-skills">
        {person.skills.slice(0, 2).map((skill) => (
          <DsBadge key={skill}>{skill}</DsBadge>
        ))}
      </div>
      <p className="ds-person-meta">
        <span className="ds-muted">{label}</span>
        <DsBadge tone="wait">Suggestion only</DsBadge>
      </p>
    </button>
  );
}
