---
id: fb-compact
kind: feedback
status: canonical
updated: 2026-08-27
supersedes: []
evidence:
  - src/lib/agent-wiki/compact.ts
---

# Compaction policy

## Why compact

Agents drown in long lesson threads. Compaction produces one short canonical
note that preserves the winning rule and cites superseded IDs.

## Rules

1. Never drop `evidence:` receipts — union them into the compact note.
2. Always set `supersedes: [id, …]` on the winner; mark losers `status: superseded`.
3. Body target: **≤ 40 lines** of prose after frontmatter.
4. Do not compact across different identity fingerprints or role fingerprints.
5. Privacy: strip any accidental email/URL patterns before writing tracked files.

## Command shape (library)

```ts
compactNotes({ winnerId, loserIds, reason })
```

Returns the new canonical markdown + list of files to rewrite.
