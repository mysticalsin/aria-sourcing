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
