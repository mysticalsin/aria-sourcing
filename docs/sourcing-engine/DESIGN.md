# Aria sourcing-engine contract

Product: **Aria**. A recruiter puts a client **need** in; Aria returns a scored
shortlist of people who can win that need.

Calypso is a **need** — a capital-markets trading-platform role — not a product
name, not a person, and not a brand for this app, PR, UI, or copy. Do not name
anything "Aria Calypso".

This file is the contract. Implementation follows it. UI does not define it.

## Need

A need is a structured hiring brief Aria understands from one of two inputs:

1. **Paste or upload** a job description (plain text, Mantu VSS Recruitment
   Need — line-oriented `Label` / `value` or `Label: value` — or a PDF/CV
   whose text is recovered by OCR).
2. **Inbound email** already connected to Aria (Mantu "need is now ACTIVE"
   shape, a VSS paste in the email body, or a generic JD email).

Required fields after parse:

| Field | Meaning |
| --- | --- |
| `title` | Role title as stated |
| `requiredSkills` | Tools, platforms, and skills the need actually asks for. Product platforms (Calypso, Murex, Summit, …) are **skills**, never candidate names. |
| `niceToHaveSkills` | Optional skills |
| `experienceSignals` | Phrases that must appear as **work** (CV / LinkedIn / other), e.g. "Calypso implementation", "trade capture", "FO/BO" |
| `minYearsExperience` | Numeric band when stated; otherwise null |
| `industry` | Domain, e.g. capital markets |
| `source` | `paste` \| `email` \| `upload` |
| `rawText` | The recovered source text (capped) |

A parse that cannot extract at least one required skill is not a need. Aria
does not invent a brief.

A complete VSS parse (title + seniority + employment + location type + at
least one required skill) is **evidence**. The cloud parser must not replace
it, shrink the Skill (Must) list, or leave the brief empty. Intake keeps the
existing paste shape (recruiter email/brief + optional JD, `POST /api/intake`).

On the demo Talent Pool path, these needs use the engine fixture shortlist
(skills + CV + LinkedIn/other text, floor 60, cap 20, name-only FAIL). Aria
does not dress that shortlist as live people.

## Evidence (what a candidate is scored on)

A candidate is scored only on three evidence channels:

1. **Skill set** — tools and platforms attested in CV / resume / LinkedIn /
   other profile text. Never from the display name.
2. **CV / resume experience** — roles, tenure, products implemented, recovered
   from uploaded or stored CV text (OCR when the file is a PDF).
3. **LinkedIn (or other) experience** — headline, positions, about.

The candidate's **display name is not evidence**. Before any match, Aria
strips name tokens from every evidence haystack.

Empty evidence (no skills, no CV text, no LinkedIn/other experience) is a
**FAIL**. Score is 0. The candidate cannot enter the shortlist.

## Name-match forbidden

A need token (example: the string "Calypso") that appears **only** as a
person's name is a name-only hit.

- Name-only hits are **ineligible**.
- Their score must not pass the 60% floor.
- Ranking someone because they are named Calypso is a contract violation.

## Score

```
skillsWeight      = 0.50
cvWeight          = 0.30
linkedinWeight    = 0.20

skillsScore       = requiredHits/required * 80 + niceHits/nice * 20   (0–100)
cvScore           = experience-signal coverage on name-stripped CV text (0–100)
linkedinScore     = experience-signal coverage on name-stripped LinkedIn/other text (0–100)

composite         = round(skillsScore*0.50 + cvScore*0.30 + linkedinScore*0.20)
```

Missing a channel scores 0 for that channel (no default 70–75 inflation).
Years-in-band can lift `cvScore` only when CV text also contains at least one
experience signal; years alone are not a win.

**Floor:** 60. Below 60 is not shortlisted.
**Cap:** 20. Return at most 20 people.
**Rank:** higher composite first. Higher score = higher chance to win the need.

## Shortlist result

```
{
  need: SourcingNeed,
  shortlist: [{ id, name, score, breakdown, evidence, provenance }],  // 0–20, all score >= 60
  rejected:  [{ id, name, score, reason }]   // name_only | empty | below_floor
}
```

`provenance` is `fixture` or `live`. Live rows come from a real provider
response. Aria never invents a live person and never dresses a fixture as live.

## Providers

- **Fixture / demo path** may prove the matcher (need in → scored shortlist
  out) without network I/O.
- **Live path** uses configured providers (Apollo / Sillage / Seamless / Apify
  / LinkedIn / GitHub) when their keys exist.
- Live path with no usable provider key is **fail-closed**: no shortlist, no
  invented people, machine code `PROVIDER_NOT_CONFIGURED`.
- If a required sensor is missing, the operator gets three real paths — not a
  silent mock:

  1. Run the fixture path to prove the matcher.
  2. Add the missing provider key in Settings.
  3. Paste / upload the JD and any CVs Aria already holds (no live search).

## OCR

- Text-layer PDFs: extract text and parse as a need or as CV evidence.
- Image-only / empty-text PDFs: require an OCR sensor. If none is configured,
  fail-closed with `OCR_REQUIRED` and the same three-path rule (re-export as
  text-layer PDF, paste the text, or configure OCR).
- Extracted text is evidence. Aria does not guess unread pages.

## Auth and Walteur fail-closed

Product APIs that run this engine:

- Call `prodFailClosed()` first (production without Supabase and without the
  sanctioned public-demo flag → 503).
- Require an authenticated principal with `source` (live) or a signed demo
  session (public demo). Anonymous callers get 401 and spend no provider quota.
- Live mode also rejects cross-origin browser mutations.

Outreach contact floor (`MIN_SCORE_FLOOR` 70) is a **separate** gate. This
contract does not lower it. This contract's 60% floor is shortlist inclusion.

## Acceptance needs (proof, not product names)

Calypso is a **client JD**, not a product and not a person. Do not rank
someone because the string "Calypso" is their name.

### Primary (E2E default)

**Calypso Application Support** — AMACAN / BNPP CIB - Canada / Montreal.

| Field | Value |
| --- | --- |
| Priority | Urgent but not Critical → `Urgent` (must not collapse to Critical) |
| Contract | CDI, start 05/10/2026, 1 head, 12 months |
| Remote | Possible partially remote → `Hybrid` |
| Profile | IS&D - Applicative Support |
| Seniority | Middle — From 4 to 6 years → `Mid`, min 4, max 6 |
| Language | English fluent |
| Skill (Must) | Linux, Python, Shell, Oracle, Grafana, Dynatrace, Linux Server |
| Function | Production support for the Calypso settlement system in Capital Markets (Trade Life Cycle, Settlements, Securities, Prime Brokerage). 24/7 global. |

Fixture: `tests/fixtures/tony-calypso-amacan-need.txt` (line-oriented VSS).

Intake must recover this brief from paste JD or a connected email. An empty
parsed brief (no title, no skills) is a FAIL. Manual field fill is not E2E.

### Second need (same VSS family — do not ignore)

**Senior Calypso Business Analyst** — same client / city family.

| Field | Value |
| --- | --- |
| Priority | Urgent and Critical → `Critical` |
| Seniority | Senior 7–10 years |
| Skill (Must) | Calypso, Business Analysis, MySQL |
| Domain | BA/MOA, T+1, Prime Brokerage/FI/Equities, SQL, Calypso back office |

Fixtures: `SAMPLE_VSS_CALYPSO_BA_MONTREAL`;
`tests/fixtures/ocr/calypso-ba-montreal-need.{pdf,png}`.

A combined VSS paste that contains both `Title` blocks must recover **both**
needs. The engine scores one need at a time; the primary E2E default is
Application Support.

### Recorded proof

Must prove, with a recorded command + `exit_code` + path (not a self-report):

1. Need in (paste JD or connected-email shape) → scored shortlist out.
2. Every shortlisted person scores ≥ 60, at most 20, ranked high → low.
3. At least one negative: a candidate whose only Calypso hit is their
   **name** scores under 60 and is not shortlisted.
4. Empty / name-only matches are FAIL.
5. Skills + CV/resume + LinkedIn (or other) experience are the only evidence
   channels. OCR recovers text-layer PDFs; image-only PDFs fail closed.

**Floor is 60.** The undeployed PR #53 80 floor is out of scope and must not
be adopted. Outreach contact floor (`MIN_SCORE_FLOOR` 70) stays separate.

**Production after land is Fly** (`https://aria-mantu-app.fly.dev/`). The
Vercel demo is not the bar. Empty cloud parse, clustered synthetic scores,
`language:Calypso`, and empty LinkedIn `AND ()` are fails on Fly.

## Out of scope

- UI chrome, Command Center, Polo, outreach send, WhatsApp, billing.
- Weakening the floor for a "quick" path.
- Invented live candidates.
- Vercel-only work. One PR.
