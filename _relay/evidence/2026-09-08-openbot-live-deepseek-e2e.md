# Live DeepSeek OpenBot E2E (2026-09-08)

Operator-supplied DeepSeek key used as Aria `DEEPSEEK_API_KEY` for a live same-key gate.
**Secret was not committed.** Key material lived only under `/tmp/aria-e2e/deepseek.key` for the run.

## Result: 20/20 passed

| Step | Result |
| --- | --- |
| Aria resolves provider `deepseek` | ok |
| OpenBot Bearer = Aria DeepSeek key accepted | ok |
| Foreign Bearer rejected (401) | ok |
| `POST /api/openbot/v1/chat/completions` → live DeepSeek 200 | ok |
| `GET /api/openbot/v1/models` → `aria:deepseek` / `deepseek-chat` | ok |
| Live DeepSeek element pick → `e1` (message control) | ok |
| LinkedIn OpenBot send (LLM-assisted) | ok |
| ComputerSupervisor `linkedin_send` with stable `computer_id` | ok |

## How to re-run

```bash
umask 077
printf '%s' "$DEEPSEEK_API_KEY" > /tmp/aria-e2e/deepseek.key
npx tsx tests/openbot-live-deepseek.mts
```

## Ops note

Rotate this DeepSeek key if it was shared in chat — treat as exposed.
