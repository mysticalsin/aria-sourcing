"""Enforce ARIA's memory-only DeerFlow process policy on every request."""

from __future__ import annotations

import os
from collections.abc import MutableMapping


POLICY_HEADER = (b"x-aria-runtime-policy", b"memory-only-v1")
TRACING_FLAGS = (
    "LANGSMITH_TRACING",
    "LANGCHAIN_TRACING_V2",
    "LANGCHAIN_TRACING",
    "LANGFUSE_TRACING",
    "MONOCLE_TRACING",
)
PROHIBITED_ENVIRONMENT = (
    "DATABASE_URL",
    "DEERFLOW_DATABASE_URL",
    "DEERFLOW_DATABASE_HOST",
    "DEERFLOW_DATABASE_PASSWORD",
    "DEERFLOW_DATABASE_PASSWORD_FILE",
    "DEER_FLOW_STREAM_BRIDGE_REDIS_URL",
    "DEERFLOW_STREAM_BRIDGE_REDIS_URL",
    "DEERFLOW_STREAM_BRIDGE_REDIS_HOST",
    "REDIS_URL",
    "DEERFLOW_REDIS_PASSWORD",
    "DEERFLOW_REDIS_PASSWORD_FILE",
    "ARIA_DB_PASSWORD_B64",
    "ARIA_REDIS_PASSWORD_B64",
    "LANGSMITH_API_KEY",
    "LANGCHAIN_API_KEY",
    "LANGFUSE_PUBLIC_KEY",
    "LANGFUSE_SECRET_KEY",
    "LANGFUSE_BASE_URL",
    "MONOCLE_EXPORTERS",
    "OKAHU_API_KEY",
)


def enforce_runtime_environment(environment: MutableMapping[str, str] = os.environ) -> None:
    for name in PROHIBITED_ENVIRONMENT:
        environment.pop(name, None)
    for name in TRACING_FLAGS:
        environment[name] = "false"


class RuntimePolicyApp:
    def __init__(self, app, *, environment: MutableMapping[str, str] = os.environ) -> None:
        self.app = app
        self.environment = environment

    async def __call__(self, scope, receive, send) -> None:
        enforce_runtime_environment(self.environment)

        async def policy_send(message) -> None:
            enforce_runtime_environment(self.environment)
            if scope.get("type") == "http" and message.get("type") == "http.response.start":
                headers = [item for item in message.get("headers", []) if item[0].lower() != POLICY_HEADER[0]]
                message = {**message, "headers": [*headers, POLICY_HEADER]}
            await send(message)

        try:
            await self.app(scope, receive, policy_send)
        finally:
            enforce_runtime_environment(self.environment)
