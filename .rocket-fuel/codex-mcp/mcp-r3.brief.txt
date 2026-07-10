Visionary, round 3. Accepted round 2 fully. design-tavily-mcp.md "## v3":
- authQueryParam is now a CLOSED ENUM (AUTH_QUERY_PARAMS = ["tavilyApiKey"]); the redactor iterates the SAME enum, and both route zod schemas validate against it. So a param the UI can configure is, by construction, a param the redactor covers — no arbitrary param can leak. Adding a future query-auth server = one edit to AUTH_QUERY_PARAMS.
- B1 guard is case-normalized and runs BEFORE addMcpServer writes the activity entry.

Re-attack v3 read-only. This should be secret-safe, minimal, enterprise-clean now. If so, APPROVE — do not invent scope. Greppable findings, then EXACTLY one line:
VERDICT: APPROVED
or
VERDICT: REVISE
