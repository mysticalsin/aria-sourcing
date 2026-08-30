# Vision — Recruiting loop (intake → source → draft → LinkedIn contact)

Updated: 2026-08-26 · Owner: Aria / MSourcing on Fly

## Product vision (one sentence)

Paste a Mantu need → Aria builds a ready campaign → finds real LinkedIn people →
drafts a first-touch message → a human approves → the human sends on LinkedIn →
Aria records the send. No LinkedIn login bots. No silent auto-DM.

## Loop (authoritative)

```
┌─────────┐   ┌──────────────┐   ┌─────────────────┐   ┌──────────┐   ┌────────────────────┐
│ Intake  │ → │ Campaign     │ → │ Sourcing agent  │ → │ Draft    │ → │ Approve            │
│ email   │   │ readiness    │   │ (deterministic  │   │ template │   │ → Pending Manual   │
│ parse   │   │ gate         │   │  LinkedIn/web   │   │ or LLM   │   │   Send             │
└─────────┘   └──────────────┘   │  or cloud tools)│   └──────────┘   └─────────┬──────────┘
                                 └─────────────────┘                             │
                                                                                 ▼
                                                                   ┌─────────────────────────┐
                                                                   │ Operator: Copy → Open   │
                                                                   │ LinkedIn → paste/send   │
                                                                   │ → Confirm in Aria       │
                                                                   └─────────────────────────┘
```

### What “contact from LinkedIn” means here

| Allowed | Forbidden |
|---|---|
| Source public profiles via compliant web/Tavily (site:linkedin.com/in) or contracted vendors | App logs into LinkedIn, scrapes, rotates cookies/sessions |
| Draft + human approve | Auto-DM / mass InMail from Aria |
| Operator pastes in LinkedIn UI, then Confirm | `/api/outreach/send` delivering LinkedIn (always 409 manual-required) |
| Optional future: contracted HeyReach/`LINKEDIN_VENDOR_*` wire | PhantomBuster / Dux-Soup / session bots |

Policy source of truth: `src/lib/linkedin-policy.ts`, `src/app/api/outreach/send/route.ts`.

## Hermes vs LangChain (decision)

**Do not rewrite the stack in LangChain for this tenant.**

| Layer | What we already have | LangChain would… |
|---|---|---|
| Sourcing tool loop | `src/lib/ai/tool-loop.ts` + `sourcing-tools.ts` (Anthropic/OpenAI tools) | Duplicate the same loop under a new dependency |
| Deterministic sourcing | `/api/sourcing-agent` when no cloud key / Kimi blocked | Not help — already production-proven |
| Outreach drafts | `generateOutreachLive` → Hermes/cloud → **template fallback** (`mock-ai.generateOutreach`) | Not required for the loop to complete |
| Multi-agent frameworks | Flowise/DeerFlow infra (LangChain-adjacent) tracked separately; `/api/ready` agentFrameworks=false | Parallel Track C, not on the critical path |

**When Hermes/Kimi fails (today: upstream 401):** outreach still drafts via templates. Sourcing never needed Kimi. The recruiting loop stays green.

**When we want nicer LLM copy later:** point workspace outreach default at Anthropic/OpenAI vault key (or rotate `KIMI_API_KEY`). Same Hermes route — no LangChain migration.

## Proven on Fly (2026-08-26)

1. Intake Mantu System Designer → Senior / Contract / On-site, ready  
2. UI Source next batch → 6 LinkedIn candidates saved  
3. Approve LinkedIn → 200; send LinkedIn → **409 manual-required** (correct)  
4. Hermes/`kimi` → `{ ok:false, reason:"Upstream error 401" }` → UI keeps template draft  
5. **LinkedIn Assisted Manual seat connected** (migration `0060` fixed `gen_random_bytes`)  
6. **Confirm manual send** → ledger row written (`synced:true`)

## Operator runbook (happy path)

1. Intake → Create campaign (or open existing ready campaign)  
2. **Source next batch**  
3. Candidates → Draft LinkedIn (template is fine if Hermes/Kimi is down)  
4. Approve → status **Pending Manual Send**  
5. Settings → Connect LinkedIn (Assisted Manual) once  
6. Copy body → Open LinkedIn profile → paste/send as yourself  
7. Confirm in Aria → durable `outreach_ledger` row  

## Next upgrades (ordered, non-blocking)

1. Optional: add `OPENAI_API_KEY` / Anthropic vault key; set outreach default away from broken Kimi  
2. Optional: contract HeyReach vendor wire when legal/ops ready  
3. Rebuild bootstrap image so `0060` is baked (already applied live on DB)  
4. Agent frameworks (Flowise/DeerFlow) remain Track C — do not gate sourcing on them  
