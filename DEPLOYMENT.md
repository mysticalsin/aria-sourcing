# Deployment

Canonical Fly production runbook: [`production-readiness/DEPLOYMENT_RUNBOOK.md`](production-readiness/DEPLOYMENT_RUNBOOK.md).

Production release is accepted only after the runbook's credential, recovery,
branch-protection, exact-SHA CI, and readiness gates have evidence. Use dedicated,
least-privilege deployment and registry credentials.

The Vercel `vercel-demo` branch is a separate demo path documented in the legacy
appendix. Keep its credentials and claims separate from Fly production.

Required env examples: [`.env.production.example`](.env.production.example) and [`.env.local.example`](.env.local.example).

Current release posture: [`production-readiness/STATUS.md`](production-readiness/STATUS.md).

## Performance / VM sizing

The stack is five Fly apps in `cdg`: `aria-mantu-app` (Next.js SSR), `aria-mantu-kong`
(the one public Supabase gateway), and the internal `aria-mantu-auth` / `aria-mantu-rest`
/ `aria-mantu-db`. Every browser data call fans out **browser → Kong → PostgREST →
Postgres** — three machine hops over the 6PN network per query.

**Applied (right-sizing, effective on next `fly deploy`):**

| App | Before | After | Why |
|---|---|---|---|
| `aria-mantu-app` | shared-cpu-1x / 1gb | **shared-cpu-2x / 2gb** | SSR was starved on an oversubscribed fractional vCPU. |
| `aria-mantu-db` | shared-cpu-1x / 1gb | **shared-cpu-2x / 2gb** | 1gb → tiny `shared_buffers`, constant disk hits. |
| `aria-mantu-kong` | shared-cpu-1x / 512mb | **shared-cpu-1x / 1gb** | Public gateway proxy buffers had no headroom under concurrency. |

If SSR still feels slow after this, the next lever is `performance-1x` on the app (a
**dedicated** vCPU removes shared-tenant CPU-steal jitter) — not a bigger shared VM.

**Structural next step (not yet applied — needs a tested deploy, do not do blind):**
the largest win is to **collapse the four Supabase VMs into one machine** (Kong +
GoTrue + PostgREST + Postgres in a single Fly app via a supervisor/compose, exactly as
`docker-compose.yml` already runs them locally). That removes two inter-VM network hops
per query. Alternative: move to **managed Supabase Cloud** and keep only the thin app on
Fly — `*.supabase.co` is already allowed in the CSP (`next.config.mjs`).

Front-end note: the 22 MB `public/office3d` GLB scene loads only on the authenticated
**Floor** view (`src/components/floor3d`, via `useGLTF.preload`), not the landing/login —
so it is not first-paint latency. Draco/meshopt compression (22 MB → ~2–4 MB) is a
worthwhile follow-up for that view but out of scope here.
