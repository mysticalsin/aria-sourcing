# deer-flow Pattern Extraction — m2a Report (2026-07-09)

> Sonnet research subagent, shallow clone of bytedance/deer-flow. Feeds m3 plan (_relay/PLAN.md).
> CRITICAL: `main` = DeerFlow 2.0 (total rewrite, generic agent harness). The coordinator/planner/researcher/reporter LangGraph lives on **`main-1.x`** branch. Paths relative to that branch.

## 1. Graph topology
`src/graph/builder.py`, `nodes.py`, `types.py`. `StateGraph(State)`, 9 nodes: coordinator, background_investigator, planner, human_feedback, research_team, researcher, analyst, coder, reporter.
- START → coordinator → planner | background_investigator | itself (clarification loop) | END via `Command(goto=...)`
- planner → human_feedback | reporter; human_feedback → planner | research_team | reporter | END
- research_team conditional edge (builder.py:23-47): first step without `execution_res` routes by step_type (research→researcher, analysis→analyst, processing→coder); all done → planner. Workers return to research_team hub (supervisor loop). reporter → END.
- State: locale, research_topic, observations[], resources, plan_iterations, current_plan, final_report, auto_accepted_plan, citations[], clarification fields, goto. Mutations ONLY via `Command(update, goto)`; `preserve_state_meta_fields` (nodes.py:100-122) re-threads meta fields (LangGraph reducer footgun workaround).

## 2. Planner
Schema (`src/prompts/planner_model.py`): Step{need_search, title, description, step_type: research|analysis|processing, execution_res?}; Plan{locale, has_enough_context, thought, title, steps[]}.
planner_node (nodes.py:268-395): Jinja → reasoning/basic LLM → strip fences (`repair_json_output`) → Pydantic validate. has_enough_context=True skips review. human_feedback_node (458-586): LangGraph `interrupt()`; resume `[ACCEPTED]`/`[EDIT_PLAN]`. plan_iterations capped by max_plan_iterations (default 1). `validate_and_fix_plan` (125-200) self-heals missing step_type, force-adds research step if enforce_web_search. No LLM self-critique.

## 3. Prompts
`src/prompts/*.md`, Jinja2, locale fallback `{name}.{locale}.md → {name}.md`. Rendered fresh per node call with CURRENT_TIME + state + config.
- coordinator.md: request classification + bounded clarification (hard round cap) — reuse for "real sourcing brief or small talk".
- planner.md: info quality standards, step-type/web-search decision table, `{{ max_step_num }}`, JSON schema pinned inline in prompt.
- researcher.md: "NEVER generate URLs on your own — all URLs must come from tool results" — portable to sourcer/screener (never invent candidate URLs).
- reporter.md: report_style enum branches tone/structure — steal for client-shortlist vs internal-notes.
- recursion_fallback.md: on limit hit, summarize without tools (nodes.py:1007-1077).

## 4. Tools
`src/tools/`: search, crawl, python_repl, retriever, tts; `decorators.py` I/O-logging wrapper. Per-node injection `_setup_and_execute_agent_step` (1354-1423). MCP per-agent via `mcp_settings["servers"]` {enabled_tools, add_to_agents} — config-driven availability. Agents fresh per node via `create_agent()` + DynamicPromptMiddleware + context-compression pre-model hook.

## 5. Guardrails
AGENT_RECURSION_LIMIT (default 25) per sub-agent; GraphRecursionError → graceful summary. max_plan_iterations 1; max_step_num 3 (prompt-only). interrupt() → SSE `event: interrupt`; resume via Command(resume) + MemorySaver thread_id. **`interrupt_before_tools` + `wrap_tools_with_interceptor` (src/agents/tool_interceptor.py) — pause before named tools = THE pattern for gating outreach-send.** No cost/budget primitive.

## 6. Streaming
POST /api/chat/stream → SSE (app.py:248-287), hand-formatted (`_make_event`, 952-971). Events: message_chunk (tagged agent/node/step), tool_calls/tool_call_chunks (accumulate partial JSON by index, 323-406), tool_call_result, interrupt, citations. Frontend: raw fetch POST + ReadableStream (EventSource can't POST); `best-effort-json-parser` renders incomplete tool args live (`web/src/core/sse/fetch-stream.ts`, `merge-message.ts`).

## 7. Model routing
`AGENT_LLM_MAP: dict[node, basic|reasoning|vision|code]` (src/config/agents.py); enable_deep_thinking forces reasoning tier for planner per-request (309-314).

## 8. Porting map (TS/Next/Supabase/Vercel)
- StateGraph → hand-rolled discriminated-union state machine. AVOID LangGraph.js (interrupt/resume assumes long-lived process).
- interrupt+MemorySaver → Supabase row {run_id, state_json, status}; resume = new request reads row.
- Budget → stepCount column vs cap. Command-update → object spread reducer.
- Jinja → tiny template fn over /prompts/*.md. Pydantic → Zod + json-repair.
- Tool injection → toolsForNode(node, config); MCP via @modelcontextprotocol/sdk.
- SSE contract + partial-JSON parse → direct port (Next route + client hook).
- **Long pole: agent loops vs Vercel serverless timeouts → persist per node + resumable invocations or persistent worker (3-5d).**

## 9. Verdict
PORT: state machine w/ Command-update (low); Plan schema + JSON-repair loop (low); prompt templates w/ fallback (low); SSE contract + live partial-JSON (medium); config-driven tool injection + MCP gating (medium); tool-level interrupt before send (low, HIGH safety value); report-style branch (low).
SKIP: LangGraph.js; recursion-fallback plumbing (keep concept); multi-provider layer; coordinator clarification code (reimplement concept).
Estimates: machine+Zod+templates 2-3d; SSE 1-2d; tools/MCP 2d; worker model 3-5d.
