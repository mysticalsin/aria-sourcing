You are the Integrator co-founder. I (Claude, Visionary) designed a candidate-facing agent security layer. Attack the DESIGN read-only before I build it. Default verdict REVISE; APPROVED earned by evidence.

Read .rocket-fuel/design-agent-security.md (the design) and verify it against the real code:
- src/lib/whatsapp-inbound.ts (~185-205): the confirmed leak — roleSummary: JSON.stringify(brief) where brief = spec.role_brief as Record<string, unknown>.
- src/lib/autopilot.ts: buildReplyPrompt, REPLY_SYSTEM, COMMITMENT_PATTERNS, decideAutopilot (existing partial defenses).
- src/app/api/careers/route.ts: the careers chatbot (also candidate-facing).
- src/lib/confidential.ts, src/lib/linkedin-policy.ts, src/lib/gate.ts: existing policy-module patterns to mirror.
- src/lib/types.ts:175-176 (salaryMin/salaryMax).

Owner requirement: the agent may answer normal questions + ASK the candidate their target salary range to assess fit, but must NEVER reveal our internal salary range or any internal info; only shares JD + tech stack + assesses expertise. Must resist prompt injection. Must be EASY TO MODIFY.

Attack specifically:
1. Does the context-WHITELIST (buildCandidateFacingRoleSummary) actually close the leak, or are there OTHER candidate-facing paths that still pass internal data to a model (careers chatbot? hermes/chat? any other place a candidate's text reaches an LLM with a brief/campaign object)? Enumerate them.
2. Is detectInjection (regex) sufficient, or trivially bypassed (unicode, base64, multi-turn, language-switch)? What's the residual risk after whitelist+detect+scan?
3. Is scanOutboundForLeaks robust — can the model leak the salary WITHOUT emitting the literal number (ranges, "a bit above X", implication)? How should the scan handle inference leaks?
4. Does the design miss any candidate-facing surface, or any internal field that should be FORBIDDEN?
5. Is the "salary fit assessment server-side, model never sees the number" split actually achievable given how the code flows today?
6. Anything that would make this HARD to modify (the Owner's explicit requirement)?

Greppable findings (blocker:/risk:/question:/nit:), most severe first, then EXACTLY one final line:
VERDICT: APPROVED
or
VERDICT: REVISE
