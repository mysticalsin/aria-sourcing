#!/usr/bin/env python3

import hashlib
import ipaddress
import json
import os
import sys
import urllib.request

import yaml

from private_http import open_without_redirect


PATCHED_RUNS = "/app/backend/app/gateway/routers/runs.py"
CLEANUP_GUARD = "/app/backend/aria_cleanup_guard.py"
RUNTIME_POLICY = "/app/backend/aria_runtime_policy.py"
RUNTIME_CONFIG = "/opt/aria/deerflow/config.yaml"


def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(64 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def deerflow_runtime_identity() -> dict[str, object]:
    with open(RUNTIME_CONFIG, encoding="utf-8") as source:
        config = yaml.safe_load(source)
    if not isinstance(config, dict):
        raise ValueError("DeerFlow runtime config is invalid")
    identity = {
        "patchedRunsSha256": sha256_file(PATCHED_RUNS),
        "cleanupGuardSha256": sha256_file(CLEANUP_GUARD),
        "runtimePolicySha256": sha256_file(RUNTIME_POLICY),
        "runtimeConfigSha256": sha256_file(RUNTIME_CONFIG),
        "databaseBackend": config.get("database", {}).get("backend"),
        "runEventsBackend": config.get("run_events", {}).get("backend"),
        "streamBridgeType": config.get("stream_bridge", {}).get("type"),
    }
    if any(identity[key] != "memory" for key in ("databaseBackend", "runEventsBackend", "streamBridgeType")):
        raise ValueError("DeerFlow persistence is not memory-only")
    return {
        **identity,
        "tracingDisabled": True,
        "persistenceEnvironmentClean": True,
    }


def main() -> dict[str, object]:
    if sys.argv[1:] != ["deerflow"]:
        raise ValueError("probe mode is invalid")
    address = os.environ.get("FLY_PRIVATE_IP", "")
    if not ipaddress.ip_address(address).is_private or not address.lower().startswith("fdaa:"):
        raise ValueError("private address is invalid")
    request = urllib.request.Request(
        f"http://[{address}]:8001/health",
        method="GET",
        headers={"accept": "application/json"},
    )
    with open_without_redirect(request, timeout=8) as response:
        if response.status != 200 or int(response.headers.get("content-length", "0") or 0) > 65_536:
            raise ValueError("readiness response is invalid")
        runtime_policy = response.headers.get("x-aria-runtime-policy")
        encoded = response.read(65_537)
        if len(encoded) > 65_536:
            raise ValueError("readiness response is too large")
        body = json.loads(encoded)
    if body != {"status": "healthy", "service": "deer-flow-gateway"}:
        raise ValueError("DeerFlow identity is invalid")
    if runtime_policy != "memory-only-v1":
        raise ValueError("DeerFlow worker runtime policy is not active")
    return {"mode": "deerflow", "status": "ready", **deerflow_runtime_identity()}


try:
    print(json.dumps(main(), separators=(",", ":")))
except Exception:
    print("Private readiness probe failed closed.", file=sys.stderr)
    raise SystemExit(1)
