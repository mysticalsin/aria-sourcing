"use client";

import * as React from "react";
import { ChannelPicker } from "@/components/dashboard/channel-picker";
import { CommandCenterStats } from "@/components/dashboard/command-center-stats";
import { OutreachComposer } from "@/components/dashboard/outreach-composer";
import { PipelineBoard, type PipelinePerson } from "@/components/dashboard/pipeline-board";
import { ProcessingCandidateCard } from "@/components/dashboard/processing-candidate-card";
import { defaultChannelId, type ChannelId } from "@/lib/channel-catalog";
import { exactTextDigest } from "@/lib/exact-text";
import type { QuickStatSource } from "@/lib/quick-stats";

const NOW = new Date("2026-11-20T15:00:00.000Z");

const SOURCE: QuickStatSource = {
  now: NOW,
  candidates: [
    ...Array.from({ length: 12 }, () => ({ stage: "Sourced" })),
    ...Array.from({ length: 4 }, () => ({ stage: "Contacted" })),
    { stage: "Booked" },
    { stage: "Hired" },
  ],
  interviews: [
    { startTime: "2026-11-18T15:00:00.000Z", status: "Confirmed" },
    { startTime: "2026-11-20T15:00:00.000Z", status: "Proposed" },
    { startTime: "2026-11-10T15:00:00.000Z", status: "Confirmed" },
  ],
  approvals: [
    { status: "Needs Approval" },
    { status: "Needs Approval" },
    { status: "Needs Approval" },
    { status: "Approved" },
  ],
  replies: [{ id: "syn-r1" }, { id: "syn-r2" }, { id: "syn-r3" }, { id: "syn-r4" }, { id: "syn-r5" }],
};

const PEOPLE: PipelinePerson[] = [
  { id: "lina", name: "Lina Moreau", title: "Senior Data Engineer", company: "Synthetic Corp B", stageId: "to-assess", score: 84 },
  { id: "tomas", name: "Tomas Ferreira", title: "Data Engineer", company: "Synthetic Corp A", stageId: "to-interview", score: 77 },
  { id: "amara", name: "Amara Okafor", title: "Analytics Engineer", company: "Synthetic Corp A", stageId: "qm", score: 68 },
  { id: "jonas", name: "Jonas Weber", title: "Data Engineer", company: "Synthetic Corp C", stageId: "to-hire", score: 81 },
];

const EXACT = "Hello Tomas, your Spark pipelines at Synthetic Corp B match the Senior Data Engineer role. Can we talk for 20 minutes next week?";

/** Synthetic composition of the four processing screens. No live data. */
export function ProcessingGallery() {
  const [channel, setChannel] = React.useState<ChannelId>(defaultChannelId());
  const [personId, setPersonId] = React.useState("lina");
  const person = PEOPLE.find((item) => item.id === personId) ?? PEOPLE[0];
  return (
    <div className="space-y-10 bg-paper p-6 text-ink">
      <section id="command-center" aria-label="Command Center" className="space-y-4">
        <p className="eyebrow text-tangerine">Aria</p>
        <h1 className="display text-4xl text-ink">Command Center</h1>
        <p className="max-w-xl text-sm text-ink-soft">Synthetic workspace. Every send stays on the exact text you approve.</p>
        <CommandCenterStats source={SOURCE} />
      </section>

      <section id="pipeline" aria-label="Pipeline" className="space-y-4">
        <h2 className="display text-3xl text-ink">Pipeline</h2>
        <PipelineBoard people={PEOPLE} selectedId={person.id} onSelect={setPersonId} />
        <ProcessingCandidateCard
          name={person.name}
          title={person.title}
          company={person.company}
          stageLabel={person.stageId === "to-assess" ? "To Assess" : person.stageId}
          score={person.score}
          breakdown={
            person.id === "lina"
              ? [
                  { label: "Skills", score: 91, weight: 0.34, contribution: 31, rationale: "5 of 5 must-haves" },
                  { label: "Activity", score: 30, weight: 0.1, contribution: 3, rationale: "Unknown activity, anchored at 30" },
                ]
              : []
          }
        />
      </section>

      <section id="composer" aria-label="Outreach composer" className="space-y-4">
        <h2 className="display text-3xl text-ink">Outreach composer</h2>
        <OutreachComposer
          toName="Tomas Ferreira"
          channelLabel="Assisted Recruiter InMail"
          subject="Senior Data Engineer"
          exactText={EXACT}
          digest={exactTextDigest("Senior Data Engineer", EXACT)}
          dirty={false}
          onApprove={() => undefined}
          onMarkSent={() => undefined}
        />
      </section>

      <section id="channel-picker" aria-label="Channel picker" className="space-y-4">
        <h2 className="display text-3xl text-ink">Channel picker</h2>
        <ChannelPicker selectedId={channel} onSelect={setChannel} onMarkSent={() => undefined} />
      </section>
    </div>
  );
}
