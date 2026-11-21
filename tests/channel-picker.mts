import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ChannelPicker } from "../src/components/dashboard/channel-picker.tsx";
import { OutreachComposer } from "../src/components/dashboard/outreach-composer.tsx";
import { PipelineBoard } from "../src/components/dashboard/pipeline-board.tsx";
import { ProcessingCandidateCard } from "../src/components/dashboard/processing-candidate-card.tsx";
import { CHANNEL_CATALOG, defaultChannelId } from "../src/lib/channel-catalog.ts";
import { exactTextDigest } from "../src/lib/exact-text.ts";
import { approvalHash } from "../src/lib/outreach-content.ts";

function inputTag(html: string, id: string): string {
  const match = html.match(new RegExp(`<input\\b[^>]*\\bvalue="${id}"[^>]*>`));
  assert.ok(match, `radio for ${id}`);
  return match[0];
}

test("HeyReach and the LinkedIn token are off by default", () => {
  const byId = Object.fromEntries(CHANNEL_CATALOG.map((channel) => [channel.id, channel]));
  assert.equal(byId.heyreach.flag, "off");
  assert.equal(byId["linkedin-token"].flag, "off");
  assert.equal(byId["assisted-inmail"].flag, "on");
  assert.equal(byId.email.flag, "on");
  assert.equal(byId["assisted-inmail"].markSent, true);
  assert.equal(byId["linkedin-token"].adminOnly, true);
  assert.equal(byId.heyreach.adminOnly, false);
  assert.match(byId.heyreach.cap, /20 invites and 40 messages per sender per day\./);
  assert.match(byId["linkedin-token"].cap, /20 invites and 40 messages per sender per day\./);
  assert.match(byId.email.cap, /50 per sender per day\./);
  assert.match(byId["linkedin-token"].risk, /Off by default/);
  assert.match(byId.heyreach.risk, /Off by default/);
  assert.equal(defaultChannelId(), "assisted-inmail");

  const html = renderToStaticMarkup(createElement(ChannelPicker, null));
  assert.equal((html.match(/type="radio"/g) ?? []).length, 4);
  assert.match(inputTag(html, "assisted-inmail"), /checked/);
  assert.doesNotMatch(inputTag(html, "assisted-inmail"), /disabled/);
  assert.match(inputTag(html, "heyreach"), /disabled/);
  assert.doesNotMatch(inputTag(html, "heyreach"), /checked/);
  assert.match(inputTag(html, "linkedin-token"), /disabled/);
  assert.doesNotMatch(inputTag(html, "linkedin-token"), /checked/);
  assert.match(html, /data-channel="heyreach" data-flag="off"/);
  assert.match(html, /data-channel="linkedin-token" data-flag="off"/);
  assert.match(html, /Admin only/);
  assert.match(html, /Off by default/);
  assert.match(html, /Mark sent/);
});

test("the pipeline board names every processing stage", () => {
  const html = renderToStaticMarkup(
    createElement(PipelineBoard, {
      people: [
        { id: "lina", name: "Lina Moreau", title: "Senior Data Engineer", company: "Synthetic Corp B", stageId: "to-assess", score: 84 },
      ],
    }),
  );
  for (const label of ["To Rate", "To Assess", "To Interview", "Shoot", "QM", "To Hire", "Hired", "Rejected", "Withdrawn"]) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /Lina Moreau/);
  assert.match(html, />84</);
});

test("the candidate card explains the score and a missing score", () => {
  const explained = renderToStaticMarkup(
    createElement(ProcessingCandidateCard, {
      name: "Lina Moreau",
      title: "Senior Data Engineer",
      company: "Synthetic Corp B",
      stageLabel: "To Assess",
      score: 84,
      breakdown: [
        { label: "Skills", score: 91, weight: 0.34, contribution: 31, rationale: "5 of 5 must-haves" },
        { label: "Activity", score: 30, weight: 0.1, contribution: 3, rationale: "Unknown activity, anchored at 30" },
      ],
    }),
  );
  assert.match(explained, /Lina Moreau/);
  assert.match(explained, /suggestion only/);
  assert.match(explained, /Skills/);
  assert.match(explained, /31\/34/);
  assert.match(explained, /Unknowns count at a fixed 30, never invented/);

  const missing = renderToStaticMarkup(
    createElement(ProcessingCandidateCard, {
      name: "Amara Okafor",
      title: "Data Engineer",
      company: "Synthetic Corp A",
      stageLabel: "QM",
      score: null,
      breakdown: null,
    }),
  );
  assert.match(missing, /Score unavailable/);
  assert.match(missing, /No scoring breakdown yet/);
  assert.doesNotMatch(missing, /suggestion only/);
});

test("the composer shows the exact text, its hash, and voids a dirty edit", () => {
  const exactText = "Hello Tomas, your Spark work at Synthetic Corp B matches this role.";
  const digest = exactTextDigest("Senior Data Engineer", exactText);
  assert.equal(digest, approvalHash("Senior Data Engineer", exactText));
  assert.equal(exactTextDigest("Hello\nthere", "Body"), approvalHash("Hello\nthere", "Body"));
  assert.equal(
    exactTextDigest("", ""),
    createHash("sha256").update("\n", "utf8").digest("hex"),
  );

  const html = renderToStaticMarkup(
    createElement(OutreachComposer, {
      toName: "Tomas Ferreira",
      channelLabel: "Assisted Recruiter InMail",
      subject: "Senior Data Engineer",
      exactText,
      digest,
      dirty: true,
    }),
  );
  assert.match(html, /Tomas Ferreira/);
  assert.match(html, /Assisted Recruiter InMail/);
  assert.match(html, new RegExp(exactText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, new RegExp(digest));
  assert.match(html, /Approving sends exactly this text\. Any edit needs a new approval/);
  assert.match(html, /<details[\s>]/);
  assert.match(html, /Approve exact text/);
  assert.match(html, /min-h-11/);

  const unavailable = renderToStaticMarkup(
    createElement(OutreachComposer, {
      toName: "Tomas Ferreira",
      channelLabel: "Email",
      subject: null,
      exactText: null,
      digest: null,
      dirty: false,
    }),
  );
  assert.match(unavailable, /Exact text unavailable/);
  assert.match(unavailable, /—/);
});
