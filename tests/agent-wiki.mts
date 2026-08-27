import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  compactNotes,
  fingerprintCandidateIdentity,
  loadCanonicalLessons,
  parseWikiNote,
  persistProposedWikiLesson,
  proposeWikiLessonFromFeedback,
  samePerson,
  stripAccidentalPii,
  wikiRoot,
} from "../src/lib/agent-wiki/index";

test("similar names with different LinkedIn are distinct people", () => {
  const a = fingerprintCandidateIdentity({
    name: "Alex Chen",
    linkedinUrl: "https://www.linkedin.com/in/alex-chen-london",
  });
  const b = fingerprintCandidateIdentity({
    name: "Alex Chen",
    linkedinUrl: "https://www.linkedin.com/in/alex-chen-nyc",
  });
  assert.equal(a.strength, "linkedin");
  assert.equal(b.strength, "linkedin");
  assert.notEqual(a.fingerprint, b.fingerprint);
  assert.equal(
    samePerson(
      { name: "Alex Chen", linkedinUrl: "https://www.linkedin.com/in/alex-chen-london" },
      { name: "Alex Chen", linkedinUrl: "https://www.linkedin.com/in/alex-chen-nyc" },
    ),
    false,
  );
});

test("same LinkedIn with different display names is the same person", () => {
  assert.equal(
    samePerson(
      { name: "A. Chen", linkedinUrl: "https://linkedin.com/in/alex-chen-london/" },
      { name: "Alex Chen", linkedinUrl: "https://www.linkedin.com/in/alex-chen-london" },
    ),
    true,
  );
});

test("name-only records are never treated as the same person", () => {
  assert.equal(
    samePerson(
      { name: "Alex Chen", currentCompany: "Acme" },
      { name: "Alex Chen", currentCompany: "Acme" },
    ),
    false,
  );
  const fp = fingerprintCandidateIdentity({ name: "Alex Chen" });
  assert.equal(fp.strength, "none");
  assert.equal(fp.nameIgnored, true);
});

test("email and github keys disambiguate without LinkedIn", () => {
  const byEmail = fingerprintCandidateIdentity({
    name: "Alex Chen",
    email: "alex@example.com",
  });
  const byGh = fingerprintCandidateIdentity({
    name: "Alex Chen",
    githubUrl: "https://github.com/alexchen",
  });
  assert.equal(byEmail.strength, "email");
  assert.equal(byGh.strength, "github");
  assert.notEqual(byEmail.fingerprint, byGh.fingerprint);
});

test("stripAccidentalPii redacts emails and urls for tracked notes", () => {
  const cleaned = stripAccidentalPii("Ping jane@corp.com at https://linkedin.com/in/jane");
  assert.match(cleaned, /\[redacted-email\]/);
  assert.match(cleaned, /\[redacted-url\]/);
  assert.doesNotMatch(cleaned, /jane@corp\.com/);
});

test("proposeWikiLessonFromFeedback creates proposed PII-free lesson", () => {
  const proposed = proposeWikiLessonFromFeedback({
    receiptId: "81111111-1111-4111-8111-111111111111",
    verdict: "useful",
    platform: "GitHub",
    observation: "Strong TypeScript signal — contact jane@evil.com ignored",
    now: new Date("2026-08-27T00:00:00Z"),
  });
  assert.equal(proposed.note.frontmatter.status, "proposed");
  assert.equal(proposed.note.frontmatter.kind, "lesson");
  assert.deepEqual(proposed.note.frontmatter.evidence, ["81111111-1111-4111-8111-111111111111"]);
  assert.doesNotMatch(proposed.markdown, /jane@evil\.com/);
  assert.match(proposed.markdown, /\[redacted-email\]/);

  const dir = mkdtempSync(join(tmpdir(), "aria-wiki-proposed-"));
  const staged = persistProposedWikiLesson(proposed, dir);
  assert.ok(staged.endsWith(`${proposed.note.frontmatter.id}.md`));
  assert.match(readFileSync(staged, "utf8"), /status: proposed/);
});

test("parseWikiNote reads multiline evidence lists", () => {
  const note = parseWikiNote(`---
id: lesson-ml
kind: lesson
status: canonical
updated: 2026-08-27
supersedes: []
evidence:
  - receipt-a
  - docs/agent-wiki/README.md
roleFingerprint: null
identityFingerprint: null
---

# Body
`);
  assert.deepEqual(note.frontmatter.evidence, ["receipt-a", "docs/agent-wiki/README.md"]);
});

test("compactNotes supersedes losers and unions evidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "aria-wiki-"));
  const lessons = join(dir, "lessons");
  mkdirSync(lessons);
  const winnerPath = join(lessons, "winner.md");
  const loserPath = join(lessons, "loser.md");
  writeFileSync(
    winnerPath,
    `---
id: lesson-w
kind: lesson
status: canonical
updated: 2026-08-01
supersedes: []
evidence: ["receipt-a"]
roleFingerprint: null
identityFingerprint: null
---

# Winner rule
`,
  );
  writeFileSync(
    loserPath,
    `---
id: lesson-l
kind: lesson
status: canonical
updated: 2026-08-01
supersedes: []
evidence: ["receipt-b"]
roleFingerprint: null
identityFingerprint: null
---

# Loser rule
`,
  );

  const result = compactNotes({
    winnerPath,
    loserPaths: [loserPath],
    reason: "Same query pattern corroborated twice.",
    root: dir,
  });
  assert.equal(result.winner.frontmatter.status, "canonical");
  assert.ok(result.winner.frontmatter.supersedes.includes("lesson-l"));
  assert.deepEqual(result.winner.frontmatter.evidence.sort(), ["receipt-a", "receipt-b"]);
  const loserRaw = readFileSync(loserPath, "utf8");
  assert.match(loserRaw, /status: superseded/);
});

test("tracked agent wiki loads canonical baseline lesson", () => {
  assert.equal(wikiRoot(), "docs/agent-wiki");
  const lessons = loadCanonicalLessons();
  assert.ok(lessons.some((n) => n.frontmatter.id === "lesson-0001"));
  const note = parseWikiNote(readFileSync("docs/agent-wiki/lessons/0001-current-baseline.md", "utf8"));
  assert.equal(note.frontmatter.status, "canonical");
  assert.match(note.body, /Never treat display name as identity/i);
});
