"use client";

import { STAGES, type StageId } from "../pipeline/stages";
import { DsButton } from "./button";
import {
  activeFilterCount,
  type CandidateFilters,
  type ScoreBand,
  type SyntheticLanguage,
} from "../data/synthetic";

const LANGUAGES: readonly SyntheticLanguage[] = ["EN", "FR", "PT"];

export function FilterBar({
  filters,
  count,
  onChange,
  onClear,
}: {
  filters: CandidateFilters;
  count: number;
  onChange: (next: CandidateFilters) => void;
  onClear: () => void;
}) {
  const active = activeFilterCount(filters);
  const noun = count === 1 ? "person" : "people";
  return (
    <section className="ds-filter" aria-label="Filters">
      <div className="ds-filter-grid">
        <label className="ds-field">
          Stage
          <select
            value={filters.stage}
            onChange={(event) => onChange({ ...filters, stage: event.target.value as StageId | "all" })}
          >
            <option value="all">All stages</option>
            {STAGES.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.label}
              </option>
            ))}
          </select>
        </label>
        <label className="ds-field">
          Language
          <select
            value={filters.language}
            onChange={(event) =>
              onChange({ ...filters, language: event.target.value as SyntheticLanguage | "all" })
            }
          >
            <option value="all">All languages</option>
            {LANGUAGES.map((language) => (
              <option key={language} value={language}>
                {language}
              </option>
            ))}
          </select>
        </label>
        <label className="ds-field">
          Suggestion score
          <select
            value={filters.score}
            onChange={(event) => onChange({ ...filters, score: event.target.value as ScoreBand })}
          >
            <option value="all">Any score</option>
            <option value="80+">80 or higher</option>
            <option value="under-80">Under 80</option>
          </select>
        </label>
      </div>
      <div className="ds-filter-foot">
        <p role="status" aria-live="polite" className="ds-num">
          {count} synthetic {noun}
        </p>
        {active > 0 ? (
          <DsButton variant="quiet" onClick={onClear}>
            Clear all filters
          </DsButton>
        ) : null}
      </div>
    </section>
  );
}
