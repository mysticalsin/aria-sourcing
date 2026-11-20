"use client";

import { useMemo, useState } from "react";
import { ApprovalPanel } from "../approval/approval-panel";
import type { SendMode } from "../approval/message";
import { DEFAULT_SEND_MODE } from "../approval/message";
import { ColumnChart } from "../charts/column-chart";
import { FunnelChart } from "../charts/funnel-chart";
import { ScoreRing } from "../charts/score-ring";
import {
  applyCandidateFilters,
  EMPTY_FILTERS,
  FUNNEL_FIXTURE,
  KPI_FIXTURE,
  SYNTHETIC_CANDIDATES,
  WEEKLY_DRAFTS,
  type CandidateFilters,
} from "../data/synthetic";
import { INVENTORY } from "../inventory";
import { KpiCard } from "../kpi/kpi-card";
import { OdooSyncChip, ODOO_SYNC_STATUSES } from "../odoo/sync-chip";
import { PipelineKanban } from "../pipeline/kanban";
import { stageLabel, stepCandidate, placeCandidate, type StageId } from "../pipeline/stages";
import { DsBadge } from "../primitives/badge";
import { FilterBar } from "../primitives/filter-bar";
import { Segmented } from "../primitives/segmented";
import { DsTable } from "../primitives/table";
import { themeVariableCss } from "../theme/variables";
import type { ThemeName } from "../tokens";

function initialStages(): Record<string, StageId> {
  return Object.fromEntries(SYNTHETIC_CANDIDATES.map((person) => [person.id, person.stage]));
}

export function DesignSystemGallery({ initialTheme = "dark" }: { initialTheme?: ThemeName }) {
  const [theme, setTheme] = useState<ThemeName>(initialTheme);
  const [filters, setFilters] = useState<CandidateFilters>(EMPTY_FILTERS);
  const [stages, setStages] = useState<Record<string, StageId>>(initialStages);
  const [announcement, setAnnouncement] = useState("Pipeline ready. Nothing has been sent.");
  const [mode, setMode] = useState<SendMode>(DEFAULT_SEND_MODE);
  const filtered = useMemo(() => applyCandidateFilters(SYNTHETIC_CANDIDATES, filters), [filters]);

  function announce(id: string, result: { stage: StageId; blocked: string | null }) {
    const person = SYNTHETIC_CANDIDATES.find((item) => item.id === id);
    if (!person) return;
    setStages((prev) => ({ ...prev, [id]: result.stage }));
    const where = stageLabel(result.stage);
    setAnnouncement(
      result.blocked
        ? `${person.name} stays in ${where}. ${result.blocked}`
        : `${person.name} is now in ${where}. Suggestion only.`,
    );
  }

  return (
    <div className="aria-ds" data-theme={theme}>
      <style>{themeVariableCss()}</style>
      <a className="ds-skip" href="#ds-main">
        Skip to the gallery
      </a>
      <main id="ds-main" className="ds-wrap">
        <header className="ds-hero">
          <p className="ds-kicker">
            <i />
            Mantu · Aria
          </p>
          <h1 className="ds-title">A recruiting desk with a pulse.</h1>
          <p className="ds-lede">
            Synthetic people only. Scores are suggestions. Manual approval is the default, and Hired stays gated.
          </p>
          <div className="ds-hero-actions">
            <Segmented
              label="Colour theme"
              name="aria-ds-theme"
              value={theme}
              onChange={setTheme}
              options={[
                { value: "dark", label: "Dark" },
                { value: "light", label: "Light" },
              ]}
            />
            <DsBadge tone="info">example.test</DsBadge>
          </div>
        </header>

        <section className="ds-section" aria-labelledby="kpi-heading">
          <div className="ds-section-head">
            <h2 id="kpi-heading">Northwind Example</h2>
            <p className="ds-note">Fixture counts for one synthetic campaign. Not a live ledger.</p>
          </div>
          <div className="ds-grid-4">
            {KPI_FIXTURE.map((kpi, index) => (
              <KpiCard
                key={kpi.id}
                label={kpi.label}
                value={kpi.value}
                deltaPercent={kpi.deltaPercent}
                period={kpi.period}
                series={kpi.series}
                spark={`var(--ds-chart-${(index % 8) + 1})`}
              />
            ))}
          </div>
        </section>

        <section className="ds-section" aria-labelledby="chart-heading">
          <div className="ds-section-head">
            <h2 id="chart-heading">Shape of the week</h2>
          </div>
          <div className="ds-grid-2">
            <FunnelChart points={FUNNEL_FIXTURE} />
            <div className="ds-stack">
              <ScoreRing score={86} name="Jordan Example" />
              <ColumnChart points={WEEKLY_DRAFTS} />
            </div>
          </div>
        </section>

        <section className="ds-section" aria-labelledby="people-heading">
          <div className="ds-section-head">
            <h2 id="people-heading">People</h2>
            <p className="ds-note">Invented names. Every address ends in example.test.</p>
          </div>
          <FilterBar filters={filters} count={filtered.length} onChange={setFilters} onClear={() => setFilters(EMPTY_FILTERS)} />
          <DsTable
            caption="Synthetic shortlist"
            rows={filtered}
            rowKey={(row) => row.id}
            empty="No synthetic people match these filters."
            columns={[
              { id: "name", header: "Name", cell: (row) => row.name },
              { id: "role", header: "Role", cell: (row) => row.role },
              { id: "email", header: "Email", cell: (row) => row.email },
              { id: "stage", header: "Stage", cell: (row) => stageLabel(stages[row.id] ?? row.stage) },
              { id: "score", header: "Suggestion", cell: (row) => <span className="ds-num">{row.score}</span> },
              { id: "source", header: "Source", cell: (row) => row.source },
            ]}
          />
        </section>

        <section className="ds-section" aria-labelledby="pipeline-heading">
          <div className="ds-section-head">
            <h2 id="pipeline-heading">Pipeline</h2>
          </div>
          <PipelineKanban
            people={SYNTHETIC_CANDIDATES}
            stages={stages}
            announcement={announcement}
            onMoveKey={(id, key) => {
              const current = stages[id];
              if (!current) return;
              announce(id, stepCandidate(current, key === "ArrowLeft" ? -1 : 1));
            }}
            onDrop={(id, stage) => {
              const current = stages[id];
              if (!current) return;
              announce(id, placeCandidate(current, stage));
            }}
          />
        </section>

        <section className="ds-section ds-grid-2" aria-labelledby="approval-heading">
          <div>
            <h2 id="approval-heading" className="ds-sr">
              Approval and Odoo
            </h2>
            <ApprovalPanel mode={mode} onModeChange={setMode} />
          </div>
          <article className="ds-card">
            <h3>Odoo mirror</h3>
            <p className="ds-note">The mirror records the touch. It never grants approval.</p>
            <div className="ds-chip-row">
              {ODOO_SYNC_STATUSES.map((status) => (
                <OdooSyncChip key={status} status={status} />
              ))}
            </div>
            <p className="ds-live">Recruiter Example · recruiter.example@example.test · campaign Northwind Example</p>
          </article>
        </section>

        <section className="ds-section" aria-labelledby="inventory-heading">
          <div className="ds-section-head">
            <h2 id="inventory-heading">Where it came from</h2>
            <p className="ds-note">Same owner, no SPDX licence file in the source repos. See ATTRIBUTION.md.</p>
          </div>
          <DsTable
            caption="Design system inventory"
            rows={INVENTORY}
            rowKey={(row) => row.component}
            empty="Inventory is empty."
            columns={[
              { id: "component", header: "Component", cell: (row) => row.component },
              { id: "source", header: "Source", cell: (row) => row.source },
              { id: "adapted", header: "Adapted how", cell: (row) => row.adapted },
            ]}
          />
        </section>
      </main>
    </div>
  );
}
