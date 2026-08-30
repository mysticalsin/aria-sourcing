# ARIA Agent Wiki — LLM second brain

Filesystem-first knowledge base for how Aria **acts**, **sources**, and **learns**.
Notes are compacted Markdown with YAML frontmatter so agents can recall decisions
with audit trails — not chat history.

## Design rules

1. **Tracked wiki (`docs/agent-wiki/`) is aggregate-only.** No candidate names,
   emails, phones, or profile URLs in Git. Those belong in Postgres /
   `var/agent-wiki/` (gitignored, tenant-scoped projections).
2. **Identity ≠ display name.** Candidates with similar names are distinct when
   LinkedIn, email, GitHub, or provider external IDs differ. See
   [`identity/disambiguation.md`](./identity/disambiguation.md).
3. **Feedback proposes; humans promote.** Recruiter verdicts open proposed note
   revisions; only reviewed promotion updates the canonical lesson set (same
   authority model as sourcing learning).
4. **Compaction supersedes; it never silently deletes evidence.** Compacted notes
   list `supersedes:` IDs and keep a one-line pointer to the prior note.
5. **This wiki documents behavior; the database remains durable authority** for
   candidates, bookings, and PII.

## Map

| Area | Path | Purpose |
| --- | --- | --- |
| Index | [`INDEX.md`](./INDEX.md) | Compact catalog of every note |
| Agent | [`agent/`](./agent/) | Mission, boundaries, action model |
| Sourcing | [`sourcing/`](./sourcing/) | Playbook, providers, query evidence |
| Identity | [`identity/`](./identity/) | Candidate keys & disambiguation |
| Feedback | [`feedback/`](./feedback/) | Contracts, lifecycle, compaction |
| Safety | [`safety/`](./safety/) | Privacy & retention |
| Schemas | [`schemas/`](./schemas/) | Note frontmatter format |
| Templates | [`templates/`](./templates/) | Copy-paste note shells |
| Lessons | [`lessons/`](./lessons/) | Compacted, promoted lessons |
| Operations | [`operations/`](./operations/) | How to maintain the wiki |

## Runtime

TypeScript library: `src/lib/agent-wiki/`

- `identity.ts` — durable person fingerprints (never name-only)
- `notes.ts` — read/write/parse frontmatter notes
- `compact.ts` — merge superseded notes into compact summaries
- `feedback.ts` — turn feedback verdicts into proposed wiki patches
- `index.ts` — public API

## Related systems (do not duplicate)

- DB lessons: migration `0027_sourcing_learning_authority.sql`
- Graphify aggregates: `workers/graphify-lessons/`
- Encrypted agent memory: `src/lib/agents/memory.ts` (8 reviewed items max)
- Shift batons: `_relay/HANDOFF.md` (transient; promote durable lessons here)
