# Candidate PII Data Flow — Hermes Sourcing (MSourcing)

> **Phase 1 re-verification (2026-06-27):** Re-checked against the current (dirty) tree.
> The flows below remain ACCURATE. Confirmed still-valid: `workspace_state` JSONB blob,
> `localStorage` key `hermes-sourcing:v1`, 600 ms debounced upsert, `claim_and_record` RPC,
> `outreach_ledger` immutability (no client DELETE, migration 0005), confidentiality masking
> at render, the Article-17 erasure gap (no hard-delete across the ledger). ADDITIONS from this
> phase: (1) outbound email/OAuth/DNS/cloud-LLM adapters are REAL wired code (not all mock —
> see INVENTORY §8); (2) candidate PII exits to the chosen cloud LLM provider
> (Anthropic/OpenAI/Groq/xAI/Mistral) — `src/lib/ai/provider.ts:103-109` — in addition to the
> self-host Aria path; (3) tenancy is per-EMAIL-DOMAIN shared workspace (ARCHITECTURE §5/§6.3),
> so all PII is visible to every authenticated user of that domain. See INVENTORY.md,
> ARCHITECTURE.md, ASSET_REGISTER.md, UNKNOWN_ITEMS.md.

**Date:** 2026-06-27
**Scope:** Where candidate personally identifiable information enters, is transformed, is stored, and exits the system.
**PII fields tracked:** name, email, linkedinUrl, githubUrl, currentCompany, currentTitle, avatarInitials, outreach history, reply history, classified replies, booking details.

---

## PII Fields in the Candidate Record

The `Candidate` type (`src/lib/types.ts`) contains the following PII-bearing fields:

| Field | Category | Notes |
|---|---|---|
| `name` | Identity | Full name |
| `email` | Contact | Work or personal email |
| `linkedinUrl` | Profile | LinkedIn profile URL |
| `githubUrl` | Profile | GitHub profile URL |
| `currentCompany` | Employment | Current employer |
| `currentTitle` | Employment | Current job title |
| `avatarInitials` | Derived | Two-letter abbreviation of name |
| `techStack` | Skills | Technology identifiers — quasi-identifier when combined |
| `recentActivity` | Behavioral | Recent GitHub commits / LinkedIn posts |
| `yearsExperience` | Employment | Integer — low sensitivity alone |
| `outreachHistory` | Communication | Channel, subject, timestamp per sent message |
| `replyHistory` | Communication | Intent classification, excerpt (up to 90 chars), timestamp |
| `lastContactedAt` | Behavioral | ISO timestamp of most recent outreach |
| `booking` | Scheduling | Meeting link, interviewer name, time — when booked |
| `complianceFlags` | Rights | `doNotContact`, `suppressed`, `unsubscribed`, `anonymized`, `gdprExportRequested` |

---

## Entry Points

### 1. Job Description Intake (`/api/intake`)

**Flow:** External email/webhook → `POST /api/intake` → `parseEmailAndJD()` → `JobAnalysis` returned to browser

The intake route parses job description emails sent by hiring managers. It does not ingest candidate PII directly. However, the hiring manager's name and email (`sender.name`, `sender.email`) are extracted as `suggestedMeta` and may be stored as `Campaign.hiringManagerEmail` in the workspace state.

No candidate PII enters here. This is a JD-to-campaign conversion endpoint.

### 2. Sourcing — `sourceNextBatch` (store.ts)

**Flow:** Store action → `sourceCandidates()` (`src/lib/mock-ai.ts`) → `Candidate[]` pushed into `HermesState.candidates`

In the current implementation this calls `sourceCandidates()` from the mock-ai module, which generates synthetic candidates from a fixed seed. In a real deployment this would call a sourcing integration (LinkedIn, GitHub, ATS). Regardless of the source, once candidates are accepted by `dedupeCandidates()` they enter the `candidates` array in the in-memory HermesState.

The following PII enters at this stage: name, email, linkedinUrl, githubUrl, currentCompany, currentTitle, avatarInitials, techStack, recentActivity, yearsExperience.

### 3. Manual Campaign Entry (Intake UI)

Hiring managers and operators enter JD content in the intake form. They may also type candidate email addresses or LinkedIn URLs directly. This data enters via the browser directly into HermesState without transiting an API route.

---

## In-Memory Storage (Browser)

Once a candidate is accepted, the full `Candidate` object lives in the React context provided by `HermesProvider` (`src/lib/store.ts`). This is an in-memory JavaScript object accessible to all components mounted within the provider. No masking is applied at this layer unless `confidentialityMode` is on and the operator has not triggered an explicit reveal.

**Confidentiality mode** (`src/lib/confidential.ts`, `applyConfidentiality()`): When `settings.confidentialityMode` is true, `applyConfidentiality()` replaces:
- `name` → `J D.` (first name + last initial)
- `email` → `j•••@e•••.com` (first char of local part + domain hint)
- `linkedinUrl` and `githubUrl` → `•••`
- `avatarInitials` → `J•`

This masking is applied at render time only. The underlying PII remains in the store and is persisted in full to the storage backend (localStorage or Supabase).

---

## Persistent Storage

### Demo Mode — `localStorage`

**Key:** `hermes-sourcing:v1`

`window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))` is called synchronously on every state change when `supabaseEnabled` is false. The full `HermesState` is serialized, including all candidate PII, outreach messages with body text, and classified replies. This data:

- Persists across browser sessions on the same device.
- Is readable by any JavaScript on the same origin (no `HttpOnly` protection).
- Is not encrypted at rest.
- Is cleared only by the user clearing browser storage, calling `resetDemo()`, or a browser-managed storage eviction.

This mode is intended for local development and demos only. It must not be used with real candidate data.

### Live Mode — Supabase `workspace_state`

**Table:** `workspace_state` (`workspace_id`, `state` JSONB, `updated_at`)

`saveRemoteState()` in `src/lib/supabase/workspace.ts` upserts the entire `HermesState` JSON to this table from the browser client using the Supabase anon key. The upsert is debounced at 600 ms.

The entire candidate array — including all PII fields — is embedded in this JSONB column. Access is governed by the Supabase RLS policy on `workspace_state`. A misconfigured RLS policy or a compromised anon key can expose all candidate records for all workspaces.

Additionally, the `workspace_state` blob contains:
- `outreach` — all message subjects and bodies (including personalization)
- `replies` — classified reply text (candidate-authored, verbatim excerpts up to 90 chars)
- `ledger` — candidate email, channel, timestamp for every send/skip event
- `chats` — full chat thread history between operators and the Aria agent
- `memory` — per-agent memory entries (may reference candidate names)

### Supabase `api_keys` Table

Stores provider API key secrets (Anthropic, OpenAI, SendGrid, Resend, etc.) as `secret` string. Access requires the service-role key. Contains `created_by` (operator email) as metadata.

### Supabase `agent_seats` Table

Stores agent seat configuration including `operator_email` (the From address). No candidate PII stored here, but operator PII is present.

### Supabase `email_connections` Table

Stores Gmail API and Microsoft Graph OAuth tokens: `access_token`, `refresh_token`, `expires_at`, `account_email`. The `account_email` is the operator's mailbox. These are not candidate PII but are high-sensitivity credentials.

### Supabase `outreach_ledger` (via `claim_and_record` RPC)

**Table:** `outreach_ledger` (internal, written by server-side RPC)

Each successful or skipped send attempt writes: `candidate_id`, `candidate_email`, `campaign_id`, `seat_id`, `channel`, `status`, `reason`, `at`. This is the authoritative de-dupe record. It contains `candidate_email` as an identifier.

---

## Processing — Where PII Is Transformed

### Outreach Drafting

**Mock path:** `generateOutreach()` in `src/lib/mock-ai.ts` — runs in-browser, receives full candidate object, returns subject/body. Candidate name, title, company, and recent activity are interpolated into the message body. The generated body is stored in `HermesState.outreach[].body`.

**Live path:** `generateOutreachLive()` in `src/lib/store.ts` → `hermesGenerate()` → `POST /api/hermes/chat`. The following fields are extracted and sent to the server proxy as the user prompt:

- `candidateName`
- `candidateTitle`
- `candidateCompany`
- `techStack` (array)
- `recentActivity` (string)
- `yearsExperience` (integer)

The server proxy (`src/app/api/hermes/chat/route.ts`) sends these to the Hermes sidecar, which forwards them to the configured LLM provider. The LLM's text response is returned to the browser as the draft subject and body.

**PII boundary:** Candidate PII crosses from the Next.js runtime to the Hermes sidecar (TB-3) and from there to the LLM provider (TB-4). The LLM provider receives the PII as prompt content.

### Reply Classification

`classifyAndStoreReply()` in `src/lib/store.ts` → if live mode, `hermesGenerate({ task: "classify", prompt: reply_text })` → `POST /api/hermes/chat`.

The full text of the candidate's reply (operator-typed or forwarded from an email integration) is sent to the LLM. The reply text may contain the candidate's name, personal circumstances, other contact details, or sensitive content (e.g. medical reasons for unavailability).

The resulting `ClassifiedReply` stores `body` (full reply text) and a 90-character excerpt in `replyHistory`.

### Confidentiality Masking at Render

`applyConfidentiality()` is called at render time in the UI components when `confidentialityMode` is enabled. It returns a masked copy of the candidate; the original is not mutated. A `recordPiiReveal` action logs when an operator explicitly unmasks a candidate.

---

## Exit Points

### 1. Outreach Send (`/api/outreach/send`)

**Exit:** Candidate email (`to`), subject, and body transmitted to the email provider.

- **Gmail API / Microsoft Graph:** `sendViaGmailApi()` / `sendViaMicrosoftGraph()` in `src/lib/email-oauth.ts` use the connected OAuth token to send from the operator's mailbox. Candidate email leaves the system and is delivered to the candidate's inbox.
- **SendGrid / Resend:** `sendViaProvider()` in `src/lib/providers.ts` transmits the From address, To address, subject, and HTML body to the provider's REST API over HTTPS.

The From address is always `seat.operator_email` (taken from the `agent_seats` table row, never from the request body). The provider receives `from`, `to`, `subject`, and `body`.

### 2. GDPR Data Export (`exportCandidate` in store.ts)

`exportCandidate()` serializes the complete `Candidate` object to a JSON string using `JSON.stringify(cand, null, 2)`. This string is returned to the UI, which presents it to the operator (typically triggering a download). All PII fields are included in full. The export also sets `complianceFlags.gdprExportRequested = true`.

This is a subject-access-request export intended for delivery to the candidate. It exits via the operator's browser (download or copy-paste). There is no automated delivery; the operator must send it to the candidate manually.

### 3. LLM Provider (see Processing above)

Candidate PII exits to the LLM provider via the Hermes sidecar for every live-mode outreach draft or reply classification. This is the only exit point to a third party that is not operator-controlled.

### 4. Browser Display

The UI renders candidate PII to the operator's screen. In confidentiality mode, this is masked. Otherwise, full PII is visible to any authenticated operator on the workspace.

---

## Data Lifecycle and Deletion

| Action | Code Location | PII Effect |
|---|---|---|
| `suppressCandidate(id)` | `store.ts` | Sets `stage: Suppressed`, `complianceFlags.suppressed: true`, `suppressedUntil: +90d`. PII remains in store. |
| `markDoNotContact(id)` | `store.ts` | Sets `complianceFlags.doNotContact: true`. PII remains in store. |
| `unsubscribeCandidate(id)` | `store.ts` | Sets `complianceFlags.unsubscribed: true`. PII remains in store. |
| `anonymizeCandidate(id)` | `store.ts` | Replaces name (`"Anonymized Candidate"`), email (`anon-<id-suffix>@redacted.example`), linkedinUrl, githubUrl, currentCompany with redacted values. Sets `complianceFlags.anonymized: true`. |
| `exportCandidate(id)` | `store.ts` | Returns JSON of full pre-anonymization record. Sets `gdprExportRequested: true`. |
| `resetDemo()` | `store.ts` | Rebuilds from `buildSeedState()` — all current state (including candidates) replaced with synthetic seed. In demo mode, localStorage is overwritten. |

**Gap:** There is no API route or store action that performs a hard delete of a candidate record from the `workspace_state` blob or from the `outreach_ledger` table. Anonymization masks fields in the active blob but the ledger table retains `candidate_email` for the candidate's outreach history. A complete GDPR erasure request (Article 17) would require: anonymizing the candidate in the workspace state, deleting or masking `candidate_email` in the `outreach_ledger` rows for that candidate, and clearing any reply text referencing the candidate.

---

## Data Flow Diagram (Textual)

```
[Sourcing / Manual Entry]
        |
        v (in-browser)
[HermesState.candidates — full PII, React context]
        |
        |--- (confidentialityMode=on) ---> [applyConfidentiality() masked render]
        |
        |--- (demo mode) ---> [localStorage JSON blob]
        |
        |--- (live mode, debounced 600ms) ---> [Supabase workspace_state JSONB]
        |                                           (browser anon key, RLS-governed)
        |
        v (operator approves outreach)
[store.approveOutreach → checkOutreachApproval (compliance + rate check)]
        |
        v (confirmLive=true, seat live+verified)
[POST /api/outreach/send]
        |--- [claim_and_record RPC → outreach_ledger (candidate_email)]
        |--- (Gmail/Graph) → [email_connections OAuth token] → [Gmail/Graph API]
        |                                                          → [candidate inbox]
        |--- (SendGrid/Resend) → [provider REST API]
                                    → [candidate inbox]

[generateOutreachLive] or [classifyAndStoreReply] (live mode)
        |
        v
[POST /api/hermes/chat]
        |--- [system prompt: server-defined task instruction]
        |--- [user prompt: candidate name/title/company/tech/activity]
        v
[Hermes sidecar (private network)]
        v
[LLM provider API (Anthropic / OpenAI / Kimi)]
        |--- prompt with candidate PII transmitted externally
        v
[LLM text response → draft subject+body or classified intent]
        v
[Back to store — draft only, still requires human approval]

[exportCandidate(id)]
        v
[JSON of full Candidate object → operator browser download]
        (operator manually delivers to candidate)
```
