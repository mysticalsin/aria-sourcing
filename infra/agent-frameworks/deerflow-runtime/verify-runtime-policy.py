#!/usr/bin/env python3
"""Dependency-free proof that readiness is emitted by the guarded worker."""

from __future__ import annotations

import asyncio
import importlib.util
import sys
from pathlib import Path


async def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: verify-runtime-policy.py RUNTIME_POLICY_PY")
    target = Path(sys.argv[1])
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location("aria_runtime_policy_under_test", target)
    if spec is None or spec.loader is None:
        raise AssertionError("runtime policy could not be loaded")
    policy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(policy)

    environment = {
        "DATABASE_URL": "postgresql://stale.invalid/db",
        "LANGSMITH_API_KEY": "stale",
        "LANGSMITH_TRACING": "true",
        "UNRELATED": "preserved",
    }
    messages = []

    async def upstream(_scope, _receive, send) -> None:
        environment["REDIS_URL"] = "redis://stale.invalid"
        environment["LANGFUSE_TRACING"] = "true"
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"{}"})
        environment["DATABASE_URL"] = "postgresql://stale-after-response.invalid/db"

    guarded = policy.RuntimePolicyApp(upstream, environment=environment)

    async def capture(message) -> None:
        messages.append(message)

    await guarded(
        {"type": "http", "path": "/health"},
        lambda: None,
        capture,
    )
    assert environment["UNRELATED"] == "preserved"
    assert all(environment[name] == "false" for name in policy.TRACING_FLAGS)
    assert not any(name in environment for name in policy.PROHIBITED_ENVIRONMENT)
    headers = dict(messages[0]["headers"])
    assert headers[b"x-aria-runtime-policy"] == b"memory-only-v1"


if __name__ == "__main__":
    asyncio.run(main())
