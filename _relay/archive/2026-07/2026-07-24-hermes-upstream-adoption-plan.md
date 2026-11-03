---
project: ARIA / MSourcing
agent: claude-code (Opus 5, 1M)
updated: 2026-07-25
status: H1 + H2 + H3-bearer SHIPPED · H3-shapes verified-and-scoped · H4-H7 await owner sign-off
scope: bring the Hermes process agents onto current upstream (NousResearch/hermes-agent)
depends_on: _relay/2026-07-24-state-of-the-union.md
---

# Hermes upstream adoption plan

## Progress

| Rock | State |
|---|---|
| H1 reachability + readiness assertion | **DONE** `9acbd03` |
| H2 two-server routing | **DONE** `b76d213` |
| H3 bearer resolver | **DONE** `2083a0d` |
| H3 response shapes | **VERIFIED, NOT CHANGED** — see the revised section below; smaller than the audit claimed and one item needs an owner decision |
| H4 de-risk the Mina fork | NOT STARTED — owner sign-off required, touches a live HR bot |
| H5 upgrade the runtime | NOT STARTED — gated by H4 |
| H6 profile multiplexing | NOT STARTED |
| H7 capability adoption | NOT STARTED |

Everything shipped above was proven by the full gate on a clean tree, not by inspection.

## The situation in one paragraph

`~/.hermes/hermes-agent` is **4444 commits behind** `origin/main` (3755 first-parent, tip
`7cd48733d` 2026-07-24 vs local `f53b184c4` 2026-06-27). The merge-base equals local HEAD, so it
is cleanly fast-forwardable — except the working tree holds ~800 lines of **uncommitted,
unversioned patches for a different product**: the Amaris WhatsApp HR bot "Mina". One of those
patches is a live safety control. The same install serves both Mina and MSourcing's sourcing
agents. So this is a fork migration with a second stakeholder, not a `git pull`. Separately, our
own integration code (`src/lib/api/hermes-proxy.ts`, `src/lib/ai/hermes*.ts`) is wrong against
*today's* upstream in ways that make the live runtime unreachable in production — those defects
exist independently of the upgrade and should be fixed first, because they are cheap and they
are what makes any of this testable.

## Sequencing rationale

Fix our side first (H1–H3), because it is self-contained, it is where the verified blockers are,
and without it there is no working client to test an upgraded runtime against. Then de-risk the
fork (H4). Then upgrade (H5). Then adopt the new capabilities that are actually worth having
(H6–H7). H4 is the gate: **do not attempt H5 before H4 is done**, or the Mina patches are lost.

---

## H1 — make the live Hermes runtime reachable in production

**Why:** `isAllowedHermesUrl` (`src/lib/api/url.ts:49-63`) accepts only `localhost`, `127.0.0.1`,
`hermes`, `hermes-agent`, `gateway`, `host.docker.internal` and RFC1918. Production is Fly
`.internal` DNS (`fly.app.toml:30`) on 6PN IPv6. Verified by running the validator: every
production-shaped host returns `Host not in allow-list.`, every accepted host is unroutable from
the deployment. The live path degrades silently to the deterministic mock and no readiness check
notices.

**Done means:** the host allow-list is deployment-owned rather than hard-coded, and a
misconfigured Hermes URL fails readiness instead of degrading silently.

**Approach:** add an explicit `HERMES_ALLOWED_HOSTS` env allow-list of exact hostnames that
`isAllowedHermesUrl` unions with the existing local patterns. Additionally accept Fly's private
forms — a `^[a-z0-9-]+\.internal$` suffix rule and the `fdaa::/16` 6PN prefix — **only** when the
host also appears in that env list, so the SSRF posture stays deny-by-default. Then assert at
readiness: if `HERMES_API_URL` is set and fails `isAllowedHermesUrl`, fail the probe.

**SHIPPED `9acbd03`, simplified from the above.** The suffix and prefix rules were dropped as
redundant: if a host must appear in the env list anyway, exact membership is the whole gate, and
adding pattern rules on top would only create a second way to be wrong. Entries are exact
hostnames or IP literals; wildcards, schemes and paths are ignored; the SSRF block-list still runs
first, so naming a cloud metadata endpoint cannot unblock it. A public host is reachable only when
the deployment names it — an operator decision in server-side env, never from request data —
asserted in both directions. Readiness gained a `hermesRuntime` component, evaluated per request so
a corrected deployment stops failing without a restart.

**Found while building it, and fixed in the same commit:** WHATWG `URL.hostname` keeps the
brackets on an IPv6 literal, so `http://[::1]/` yields `"[::1]"`. Every IPv6 pattern in the
validator (`^::1$`, `^fc00:`, `^fe80:`, `^ff00:`) is written against the bare address and was
therefore **unreachable** — the loopback, ULA, link-local and multicast blocks had never fired.
Latent rather than exploitable, because default-deny rejected all IPv6 anyway; that stops being
true the moment a deployment can name an IPv6 host, which is what this rock adds. The hostname is
now bracket-stripped before matching, with assertions that loopback, link-local and multicast stay
blocked even when explicitly named.

**Proof:** `THE FULL GATE` exit 0; AND a new test asserting (a) each production-shaped host is
rejected when absent from `HERMES_ALLOWED_HOSTS` and accepted when present, (b) a wildcard or
bare-suffix entry is rejected, (c) a public host absent from the list is rejected, (d) readiness
reports Hermes unavailable when `HERMES_API_URL` is set and disallowed, rather than returning a
healthy body.

## H2 — address the two upstream servers separately

**Why:** upstream is two processes. aiohttp `gateway/platforms/api_server.py`
(`DEFAULT_PORT = 8642`, `:89`) serves `/v1/*` and `/api/sessions`. FastAPI
`hermes_cli/web_server.py:249` (`--port 8080`) serves `/api/status`, `/api/system/stats`,
`/api/config`, `/api/memory`, `/api/skills`, `/api/curator`, `/api/files`. The route sets do not
overlap. We address both off one `HERMES_API_URL` pinned to 8642 (`.env.local.example:67`), so
six of nine management paths 404. `SystemSettings.hermesWebUrl` was declared for exactly this
(`src/lib/types.ts:999-1001`), is written at `seed.ts:188` and `store.ts:6269` and migrated at
`store/migrations.ts:93`, and is **read by nothing**.

**Done means:** each allow-listed path routes to its owning base URL, the six paths that exist on
neither server are gone, and no settings field is half-implemented.

**Approach:** add a server-side `HERMES_WEB_URL`. Change `HERMES_PROXY_ALLOW_LIST` from a string
array to `{path, base: "api" | "web"}` records so the routing decision is data rather than
convention. Delete `api/health`, `api/tools`, `api/models`, `api/schedules`, `api/gateway`,
`api/oauth/account` — verified absent from both servers at `origin/main`. Replace `api/health` in
`PUBLIC_RUNTIME_READS` with `health` on the api base, which does exist. Either wire
`hermesWebUrl` through or delete it plus its seed and migration lines; do not leave it dangling.

**Proof:** `THE FULL GATE` exit 0; AND a test asserting every allow-list entry names a base, that
a `web`-based path is never sent to the api base or vice versa, that a path absent from the list
returns 404 before any fetch, and that the non-admin public read set contains only paths that
exist upstream.

**SHIPPED `b76d213`.** `HERMES_PROXY_ALLOW_LIST` is now `{path, base}` records;
`isAllowedHermesPath` surfaces the base; `getHermesBaseUrl(base)` reads `HERMES_API_URL` or the
new `HERMES_WEB_URL`, with **no fallback between them** — falling back is exactly how these paths
came to 404 silently. `api/sessions` is registered on both processes and routes to the gateway,
which owns the chat session lifecycle, so GET and POST cannot straddle two servers. The six
non-existent entries are deleted and asserted un-restorable. `PUBLIC_RUNTIME_READS` carried
`api/health` for the same reason and now carries `health`.

Correction to the audit worth recording: it called `api/health` "the only non-admin-readable
runtime path in production". It was not — `PUBLIC_RUNTIME_READS` has three entries and the other
two, `api/status` and `api/system/stats`, both exist upstream and always worked.

The isolation suite had encoded the same mistake: it asserted viewer access *against*
`api/health`, so it was guarding a path that could never reach a runtime. It now asserts the real
path and additionally that `api/health` 404s at the allow-list before any upstream call. Its
fixture gained `HERMES_WEB_URL`, without which the management reads correctly report an
unconfigured base. 10 failures → 23/23.

`hermesWebUrl` in `SystemSettings` is still read by nothing and is still half-implemented. It was
deliberately left alone: the proxy must resolve base URLs from server-side env only, never from
request data, so the field can only ever be a display value. Either wire it to the settings panel
as read-only or delete it with its seed and migration lines — a small, separate change.

## H3 — close the bearer-resolver and response-shape defects

**Why, bearer:** `resolveHermesBearerToken` (`src/lib/api/hermes-proxy.ts:45-49`) selects
`secret, workspace_id` filtered on `workspace_id` alone — no `provider`, no `status='valid'` —
unlike the stronger `resolveVaultSecret`. Any authenticated workspace member can cause any
workspace secret, **including a revoked one**, to be sent as a Bearer token to the Hermes host.
Confirmed by execution during the audit.

**Why, shapes — REVISED 2026-07-25 after verifying each against `origin/main` source.** The
audit claimed four of eight parsed shapes were wrong and that the affected panels render empty. A
reviewer partly refuted the framing. Both were partly right, and the verified picture is smaller
and more precise than either:

| Claim | Verdict, read at `origin/main` |
|---|---|
| `/api/memory` returns an object, not an array | **CONFIRMED.** `web_server.py` returns `{active, providers, builtin_files}`. We declare `HermesProxyResult<unknown[]>`. `hermes-memory-panel.tsx:27` guards with `Array.isArray`, so the panel renders **empty** — it never crashes. Display defect, not a blocker. |
| `/api/files` shape is wrong and navigation is inert | **CONFIRMED, two separate faults.** Upstream returns `{path, parent, entries, …meta}`. And `proxy/route.ts` forwards only `page, limit, cursor, q, level`, so the `path` parameter the endpoint needs is never sent. |
| `/api/status` has no `status`/`uptime` | **OVERSTATED.** The payload carries both `status` and `version`; only `uptime` is genuinely absent (`gateway_state` and `gateway_updated_at` cover that ground). Our type is all-optional with an index signature, so nothing can break on it. The reviewer was right. |
| `/api/sessions` returns `{object, data}` not an array | **UNVERIFIED.** The gateway handler did not resolve cleanly from source reading. Do not touch this parser until a real response is captured. |

**Deliberately not changed yet, and why.** Rewriting a parser against a shape nobody has observed
from a running server is how the current mismatches got here. The memory and files corrections are
worth making, but they change what the panels *render*, and that cannot be validated without real
responses — which arrive with H5. Correcting the declared types alone would also fight
`Array.isArray` narrowing at the call sites for no user-visible gain.

**One item needs an owner decision, not a fix.** Forwarding `path` to `api/files` hands the client
control of which path on the Hermes host is read. Upstream applies its own managed-path policy
(`_resolve_managed_path`, `_is_sensitive_path`), and our proxy already restricts this to admins in
production — but adding a client-controlled `path` to the forwarded-parameter allowlist is a
deliberate traversal-surface decision. It is not a typo fix and is not being made unilaterally.

**Done means:** the proxy resolves secrets through one hardened path, and every parsed shape is
asserted against a fixture captured from upstream rather than from our own assumptions.

**Approach:** delete `resolveHermesBearerToken` and route the proxy through `resolveVaultSecret`,
adding the `provider` and `status='valid'` predicates. Capture real response fixtures from a local
Hermes at `origin/main` and pin the parsers to them.

**Proof:** `THE FULL GATE` exit 0; AND tests asserting (a) a secret whose `provider` does not match
is never sent, (b) a `status <> 'valid'` secret is never sent and the call fails closed, (c) each
parser is exercised against a captured upstream fixture, and (d) an unknown extra field does not
break parsing.

## H4 — de-risk the Mina fork before any upgrade  ← GATE

**Why:** `~/.hermes/hermes-agent` has 18 dirty entries. Modified tracked: `gateway/run.py`
(+49/-1), `hermes_cli/web_server.py` (+164), `apps/desktop/electron/main.cjs` (+12514/-5274,
almost certainly a build artefact), `package.json`, and the whatsapp-bridge package files.
Untracked: `gateway/platforms/whatsapp_business.py` (622 lines), `docs/MINA_SETUP.md`, seven
`scripts/whatsapp-bridge/*.mjs` pairing scripts, `scripts/whatsapp-pair.js`, and
`hermes_cli/web_server.py.orig` — the leftover of a `patch` run. The `gateway/run.py` comments
say `(Custom Amaris patch — reapply after hermes update.)`.

The three patches:
1. **Voice safety gate.** Re-runs the `pre_gateway_dispatch` hook on transcribed text; the gate
   first ran on the `[ptt received]` placeholder, so without it a spoken grievance bypasses
   deterministic sensitive-topic escalation, the human-handoff keyword and the FAQ cache.
   Already implemented *through the plugin hook API*, which is the important detail.
2. **No home channel for WhatsApp.** Skips the `/sethome` nag and deliberately leaves the platform
   homeless so cron/startup/shutdown/cross-platform messages never reach employees.
3. **Error suppression.** On agent-turn failure for `Platform.WHATSAPP`, logs the real error and
   returns a calm multilingual fallback instead of a raw provider error.

**Done means:** every bespoke behaviour is captured as a versioned artefact outside the upstream
worktree, with a test, so the upgrade cannot silently drop it.

**Approach:** upstream now ships a first-class `plugins/platforms/whatsapp/` plugin seam plus
`whatsapp_cloud.py`, `whatsapp_common.py`, `whatsapp_identity.py`, `setup_whatsapp_cloud.py`, a
maintained bridge with unit tests, and ~10 `tests/gateway/test_whatsapp_*.py`. So:
- Re-express patches **1 and 3 as a `pre_gateway_dispatch` plugin** — patch 1 already calls that
  hook, so this is a relocation, not a rewrite.
- Patch 2 maps onto upstream `241bc112e fix(platforms): clear home channel when setup prompt left
  blank`; verify that commit's behaviour covers the requirement before dropping the patch.
- Retire `whatsapp_business.py` in favour of upstream `whatsapp_cloud.py` — this also *gains*
  security work the fork lacks: `eec92a92c` webhook body-limit enforcement, `e82d71db4`
  `client_max_size` on the webhook app, `8986981df` the same on three uncapped aiohttp apps,
  `f96b2e6ef` DM-allowlist gating on interactive taps, `6c7960cfa` `WHATSAPP_CLOUD_ALLOWED_USERS`
  honoured, `b0f2bdbe8` poll-vote gating, `6fad6f1dd` inbound media failure containment,
  `a6d9d1d2c` non-ASCII `compare_digest` crash fix.
- Delete `hermes_cli/web_server.py.orig`. Confirm `main.cjs` is generated and stop tracking the
  local edit.
- Put the resulting plugin in **this** repo or its own, under version control, with a test that
  the voice path re-runs the safety gate on the transcript.

**Proof:** the Mina plugin exists in a versioned repo with a passing test for the transcript
safety gate; `git status --porcelain` in `~/.hermes/hermes-agent` is empty except for
deliberately-retained local config; and a written statement of which upstream commit supersedes
each of the three patches.

**Owner decision required:** Mina is a different product with different users. Migrating its
platform adapter is a change to a live HR bot serving Amaris employees. This rock must not start
without explicit sign-off, and ideally not on the same install MSourcing depends on.

## H5 — upgrade the runtime

**Done means:** `~/.hermes/hermes-agent` is at a named upstream commit, config is migrated, both
Mina and MSourcing still work, and the upgrade is reproducible.

**Approach:** only after H4. Fast-forward to a **pinned** upstream SHA, not a moving `main`.
Upstream ships `/api/ops/config-migrate` and `/api/hermes/update` + `/api/hermes/update/check` on
the web server at both refs — use them rather than hand-editing `config.yaml` (17.8 KB, and there
is already a `config.yaml.bak-hr-20260609-231601` from a previous hand-edit). Snapshot
`~/.hermes/state.db`, `config.yaml`, `auth.json` and `kanban.db` first. Note the updater's own
metric reports `{"behind": 571, "ver": "0.17.0"}` with `.update_exit_code` `0` — it is not
failing, it simply has not been run.

**Proof:** the pinned SHA recorded; `config-migrate` output captured; a smoke test of both the
MSourcing chat path and the Mina WhatsApp path; and MSourcing's own Hermes suites green against
the upgraded runtime rather than against stubbed `fetch`.

## H6 — replace homegrown tenancy with upstream profile multiplexing

**Why:** upstream now registers every gateway route twice — bare and at `/p/{profile}{path}`
(`api_server.py:6695-6697`) — with a profile-prefix middleware that scopes config **and
credentials** per profile when `gateway.multiplex_profiles` is on (`:1688` returns early when the
flag is false; per-profile secret scoping via `agent/secret_scope.py::is_multiplex_active`, gated
by `647520f83`). We hand-roll tenancy with `HERMES_RUNTIME_WORKSPACE_ID`, which upstream knows
nothing about — so today isolation is enforced only by our own proxy, and only when
`NODE_ENV === "production"` (see blocker 23 in the state-of-the-union: the shipped compose stack
runs the fully-open posture).

Alongside it, `X-Hermes-Session-Key` scopes long-term memory per channel, is independent of the
session id, **403s unless `API_SERVER_KEY` is configured**, rejects `[\r\n\x00]` with 400, and caps
at 256 chars. That is the right primitive for per-tenant candidate memory, which we currently do
not isolate upstream at all.

**Done means:** one MSourcing workspace maps to one Hermes profile, requests carry the profile
prefix, memory is scoped by `X-Hermes-Session-Key`, and cross-tenant leakage is proven impossible
by test rather than by our proxy's good behaviour.

**Proof:** a test asserting a request for workspace A cannot read profile B's config, credentials
or memory, executed against a real multiplex-enabled runtime; and that the posture no longer
depends on `NODE_ENV` (fixes blocker 23 as a side effect).

## H7 — adopt the capabilities worth having

Ordered by value to the sourcing product. Each is independently shippable.

1. **Cron blueprints + cron jobs** (`/api/cron/blueprints`, `/api/cron/jobs*`,
   `/api/cron/delivery-targets`) — these already existed at our pinned commit and we never used
   them. This is the missing scheduler for the swarm and the sourcing loop (state-of-the-union
   blockers 1 and 10), without us writing one.
2. **Webhook subscriptions** (`/api/webhooks*`, also already present) — push instead of poll.
   Retires the polling in the runtime panels.
3. **Session model lock** (`POST /api/sessions/{id}/model`, new) plus provider-aware routing
   (`d66a82000`) and the model-options inventory (`GET /api/model/options`, now on the gateway
   too). Lets a sourcing task pin its model instead of inheriting a global default. Note
   `9f384783e` gates bare-model passthrough and closes a route-alias model leak — read it before
   sending a bare model name.
4. **Model catalogue** — `306c9f766` adds `anthropic/claude-opus-5` to OpenRouter and Nous Portal;
   `website/static/api/model-catalog.json` changed by 108 lines. Re-derive the selectable set
   rather than hard-coding.
5. **Learning graph** (`/api/learning/graph`, `/api/learning/node`, new) — worth evaluating against
   our own `run-sourcing-learning.mjs` / `sourcing-learning-db.sh` lane before building more of
   ours.
6. **Memory provider setup** (`/api/memory/providers/{name}/setup`, new) and the `plugins/memory`
   provider contract.
7. **`POST /api/platforms/{platform}/events`** (new) — generic platform event ingress
   authenticated by the **adapter's own platform-signed bearer, not `API_SERVER_KEY`**. Read the
   auth model carefully before exposing it; it is deliberately not API-key protected.
8. **Session auto-archive + durable pins** (`f16b80362`) — housekeeping for long-running agents.

**Not adopting:** the ~20 `/api/git/*` review routes, `/api/ssh/ownership`,
`/api/tools/terminal/backend(s)`, `/api/chat/image-upload`, desktop-only and i18n-only changes.
Out of scope for a sourcing product and they widen the proxy surface for nothing.

---

## Non-goals, staged with blockers

| Item | Blocker |
|---|---|
| Running MSourcing and Mina on the same Hermes install | Should be split. Two products, two blast radii, one runtime today. Needs an owner call on standing up a second install or a second profile via H6. |
| Contributing the Mina patches upstream | Desirable, and H4 makes it possible, but it is a separate engagement with NousResearch. |
| Tracking `main` continuously | Upgrade to a pinned SHA. A 4444-commit gap happened because nothing pinned or scheduled the upgrade; a moving target repeats it. |
| `_handle_chat_completions` contract + SSE parser hardening | Unverified in this audit. Needs the contract diff read first — do not change the parser speculatively. |
| ACP / `run_agent.py` adoption | Unverified at `origin/main`. Evaluate after H5. |

## Standing constraints

- Never edit a shipped numbered migration (see the lessons ledger, item 12).
- `sequences_enabled` stays FALSE; no autonomous external send is in scope for any rock here.
- No new runtime dependency without justifying it in the receipt.
- Hermes upgrade work touches a live HR bot. Nothing in H4 or H5 runs without owner sign-off.
