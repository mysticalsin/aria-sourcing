#!/usr/bin/env python3

import ipaddress
import json
import os
import sys
import urllib.request


def main() -> dict[str, str]:
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
    with urllib.request.urlopen(request, timeout=8) as response:
        if response.status != 200 or int(response.headers.get("content-length", "0") or 0) > 65_536:
            raise ValueError("readiness response is invalid")
        encoded = response.read(65_537)
        if len(encoded) > 65_536:
            raise ValueError("readiness response is too large")
        body = json.loads(encoded)
    if body != {"status": "healthy", "service": "deer-flow-gateway"}:
        raise ValueError("DeerFlow identity is invalid")
    return {"mode": "deerflow", "status": "ready"}


try:
    print(json.dumps(main(), separators=(",", ":")))
except Exception:
    print("Private readiness probe failed closed.", file=sys.stderr)
    raise SystemExit(1)
