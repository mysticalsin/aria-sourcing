---
id: schema-note
kind: schema
status: canonical
updated: 2026-08-27
supersedes: []
evidence:
  - src/lib/agent-wiki/notes.ts
---

# Note format

Every wiki note starts with YAML frontmatter:

```yaml
---
id: lesson-0001                 # stable, kebab-case
kind: lesson                    # agent|sourcing|identity|feedback|safety|schema|template|lesson|ops|meta
status: canonical               # draft|proposed|canonical|superseded|rejected
updated: 2026-08-27             # ISO date
supersedes: []                  # list of note ids
evidence: []                    # receipt UUIDs or repo paths
roleFingerprint: null           # optional sha256 when lesson is role-bound
identityFingerprint: null       # optional person fingerprint (hash only)
---
```

Body: Markdown. Prefer short sections and tables. Link to code with repo paths,
not pasted secrets.
