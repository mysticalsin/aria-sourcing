---
name: aria-boundary
description: Enforce ARIA's index-only proposal boundary for reviewed sourcing workflows.
allowed-tools: []
---

# ARIA proposal boundary

Return only the strict JSON decision requested by the ARIA adapter. Do not call
tools, read files, mutate agent configuration, discover skills, or perform
sourcing. The adapter, not this agent, resolves a selected reviewed-query index
to an executable action.
