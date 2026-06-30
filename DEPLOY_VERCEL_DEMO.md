# Deploy the public demo to Vercel (Hosted Supabase + admin/admin)

A turnkey guide to host Aria as a **public, synthetic-data demo** anyone can test
with the `admin` / `admin` shortcut. Default builds stay fail-closed; the demo is
opened only by the explicit `NEXT_PUBLIC_ENABLE_DEMO_LOGIN` flag set below.

> **What "demo" means here:** real cloud Supabase persistence, but everything is
> synthetic and dry-run — no candidate is contacted, nothing sends. All `admin`/
> `admin` testers share **one** workspace (`hermes.local`); they see and edit the
> same data. Any tester can restore it from the user menu → **Reset to defaults**.

---

## 1. Create the Supabase project

1. Create a project at <https://supabase.com/dashboard>.
2. **Project Settings → API** — copy three values:
   - `Project URL`  → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public`  → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` → `SUPABASE_SERVICE_ROLE_KEY` (server-only secret)

## 2. Apply the schema (migrations 0001 → 0006)

**Option A — Supabase CLI (vendored):**

```bash
./.localbin/supabase login                       # opens browser, one-time
./.localbin/supabase link --project-ref <ref>    # <ref> = the project ref in the URL
./.localbin/supabase db push                      # applies all migrations in order
```

**Option B — SQL Editor:** paste each file in `supabase/migrations/` in order
(`0001_init.sql` … `0006_outreach_approvals.sql`) and run. Do not stop before 0006.

## 3. Seed the demo admin account

Pick **one** of the strong passwords you'll reuse as `DEMO_ADMIN_PASSWORD` below.

**Option A — Dashboard (no local tooling):**
1. **Authentication → Users → Add user**
   - Email: `admin@hermes.local`
   - Password: `<DEMO_ADMIN_PASSWORD>`
   - Tick **Auto Confirm User**.
2. **SQL Editor** → paste and run [`supabase/seed-admin.sql`](supabase/seed-admin.sql).

**Option B — Script (needs local `psql`):**
```bash
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service_role> \
DEMO_ADMIN_PASSWORD=<strong-password> \
SUPABASE_DB_URL='postgresql://postgres:<db-pw>@db.<ref>.supabase.co:5432/postgres' \
./scripts/seed-cloud-admin.sh
```

## 4. Push to GitHub

The token in `gh` is currently invalid — re-auth first:

```bash
gh auth refresh -h github.com        # or: gh auth login
```

Then create the repo and push (private keeps the source closed; the deployed site
is still public):

```bash
gh repo create aria-sourcing-demo --private --source=. --remote=origin --push
```

## 5. Import into Vercel + set env vars

1. <https://vercel.com> → **Add New → Project** → import the GitHub repo.
2. Framework preset auto-detects **Next.js** (build/install come from `vercel.json`).
3. **Settings → Environment Variables** — add these for **Production** (and Preview):

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `<anon public key>` |
   | `SUPABASE_SERVICE_ROLE_KEY` | `<service_role key>` |
   | `NEXT_PUBLIC_ENABLE_DEMO_LOGIN` | `true` |
   | `DEMO_ADMIN_PASSWORD` | `<the strong password from step 3>` |
   | `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN` | *(leave empty / do not add)* |

   - Do **not** set `NODE_ENV` — Vercel sets it to `production` automatically.
   - `DEMO_ADMIN_PASSWORD` **must** equal the seeded password, or admin/admin fails.
   - Leave all OAuth / email / Hermes / `GITHUB_TOKEN` vars unset to stay fully
     synthetic and dry-run.
4. If you pushed to a non-`main` branch, set **Settings → Git → Production Branch**
   to that branch (e.g. `vercel-demo`).
5. **Deploy.**

## 6. Verify the live URL

1. Open the deployment URL → it redirects to `/login`.
2. The hero shows **"Designed & built by Tony Walteur"**.
3. Click **Enter the demo console** (or type `admin` / `admin` in the email form)
   → you land on the dashboard; the sidebar shows **"Created by Tony Walteur"**
   under the M + ARIA lockup.
4. User menu → **Sign out** → returns to `/login`.

---

## How the flag works (security note)

- `src/app/api/auth/demo-login/route.ts` stays **404 in production** unless
  `NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true`. Real tenant deploys (flag unset) keep the
  enterprise-hardening fail-closed posture untouched.
- In production the route refuses to fall back to the well-known local password —
  `DEMO_ADMIN_PASSWORD` must be set explicitly.
- `admin`/`admin` is only the client shortcut; it maps server-side to the seeded
  `admin@hermes.local` Supabase account using `DEMO_ADMIN_PASSWORD`. The real
  password never reaches the browser bundle.

## Gotchas

- **Shared state:** every tester shares the `hermes.local` workspace. Fine for a
  demo; use **Reset to defaults** to clean it.
- **`maxDuration: 60`** in `vercel.json` needs a paid plan for >10s functions; on
  the Hobby plan it caps lower. The long routes are mocked in demo mode, so this
  is harmless here.
- **Region** is pinned to `cdg1` (Paris) in `vercel.json` — change if you prefer.
