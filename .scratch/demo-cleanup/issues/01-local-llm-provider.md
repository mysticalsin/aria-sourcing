# Add a local / OpenAI-compatible LLM provider (Ollama, Azure OpenAI)

Status: ready-for-agent

## Why
The sourcing agent's `cloud` mode and AI drafting only reach hosted APIs
(Anthropic, OpenAI, Groq, xAI, Mistral, Kimi). Owner wants the option of local
agents for data privacy (candidate PII stays on the machine) and a path to
Azure OpenAI for the planned internal Azure deployment.

## Scope
- New provider kind "Local / OpenAI-compatible" with an admin-set base URL and
  model name (Settings → LLM providers), optional key.
- Validate the base URL server-side. Reuse `isAllowedHermesUrl` in
  `src/lib/api/url.ts` (private/loopback allow-list with SSRF block-list) and
  rename it to something provider-neutral.
- Route through the existing OpenAI-compatible path in `src/lib/ai/provider.ts`
  and `runOpenAiWithTools` in `src/lib/ai/tool-loop.ts`.
- Docker note: on macOS, Ollama must run on the host (no GPU in Docker); the
  app container reaches it at `http://host.docker.internal:11434/v1`.
- Small local models call tools less reliably: keep the deterministic fallback
  and surface a clear error when the model returns no valid drafts.

## Done when
A campaign "Run agent" completes in `cloud` mode against a local Ollama model,
with tests for URL validation and provider resolution.

## Implementation (2026-10-27)

Local/Custom now displays as Local / OpenAI-compatible and resolves to the local
slug. Admins can set its base URL and exact model name; a saved Custom key is
optional. Saved Models still override provider-level models per task.

The server validates the URL with isAllowedProviderUrl (legacy runtime alias
retained). Metadata URLs, URL credentials/query/fragment and redirects are
rejected. PROVIDER_ALLOWED_HOSTS allows deployment-owned exact DNS names. Chat,
AI drafting/intake/classification and authoritative campaign sourcing pass the
local endpoint through. Model tags such as qwen3:8b are supported. Empty drafts
are an explicit error if the real search found profiles; genuinely empty search
results remain honest successful empty results. Deterministic sourcing remains
available with the provider disabled.

Tests: ai-provider, mcp-tool-loop (actual loopback HTTP tool roundtrip),
hermes-cloud-authority and sourcing-agent-route-authority. DOCKER.md documents
setup, task-default selection, privacy limits, and the campaign acceptance steps.
Direct Azure api-key/api-version endpoints need a later dedicated adapter;
OpenAI-compatible gateways can use this provider.

Acceptance is still pending: this Windows session has no Docker executable and
no Ollama service/model at localhost:11434. Do not close this issue until a real
campaign completes against an installed local model with the Docker database.