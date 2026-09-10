#!/usr/bin/env python3
"""
Unified LinkedIn / browser-agent sidecar for Aria.

Implements the HTTP contracts expected by
`src/lib/integrations/linkedin-browser-agents.ts`:

  GET  /health
  POST /analyze   { url }                 -> Orca-style insight
  POST /search    { keywords, limit? }    -> NightTrek-style hits
  POST /act       { type, url? ... }      -> browser-use navigate only
  POST /qualify   { profileUrl?, snippet?, icp } -> Linki/OpenOutreach score

This is a local/dev-friendly stub with honest heuristics. Point every
ARIA_*_URL at this process to exercise the adapters without five services.
LinkedIn Connect/Message is intentionally not automated here.
"""

from __future__ import annotations

import json
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse

HOST = os.environ.get("ARIA_AGENT_SIDECAR_HOST", "0.0.0.0")
PORT = int(os.environ.get("ARIA_AGENT_SIDECAR_PORT", "8092"))


def _slug_label(url: str) -> str:
    try:
        path = urlparse(url).path
        m = re.search(r"/in/([^/]+)", path, re.I)
        slug = (m.group(1) if m else "").replace("-", " ").strip()
        return slug.title() if slug else "this profile"
    except Exception:
        return "this profile"


def analyze(payload: dict[str, Any]) -> dict[str, Any]:
    url = str(payload.get("url") or "").strip()
    if not url:
        return {"error": "url is required"}
    label = _slug_label(url)
    return {
        "url": url,
        "headline": label,
        "focusAreas": ["enterprise AI", "agentic systems", "innovation leadership"],
        "trajectoryNotes": [
            f"Public LinkedIn slug resolved for {label}.",
            "Prefer AriaBot Connect + note for first touch.",
        ],
        "painPoints": [
            "Enterprise adoption of agentic tooling",
            "Cross-team operating model for AI programs",
        ],
        "via": "orca-style",
    }


def search(payload: dict[str, Any]) -> dict[str, Any]:
    keywords = payload.get("keywords") or []
    if not isinstance(keywords, list) or not keywords:
        return {"error": "keywords array is required"}
    limit = int(payload.get("limit") or 5)
    limit = max(1, min(limit, 25))
    seed = "-".join(str(k).strip().lower() for k in keywords[:3] if str(k).strip()) or "operator"
    hits = []
    for i in range(limit):
        slug = f"{seed}-lead-{i+1}"
        hits.append(
            {
                "profileUrl": f"https://www.linkedin.com/in/{slug}/",
                "name": slug.replace("-", " ").title(),
                "title": " ".join(str(k) for k in keywords[:3]),
                "location": str(payload.get("location") or ""),
                "via": "linkedin-agent-tool",
            }
        )
    return {"hits": hits}


def act(payload: dict[str, Any]) -> dict[str, Any]:
    action_type = str(payload.get("type") or "").strip()
    if action_type in ("connect", "message"):
        return {
            "error": "LinkedIn Connect/Message must use AriaBot computers (Take control path)."
        }
    if action_type != "navigate":
        return {"error": f"unsupported action type: {action_type or '(missing)'}"}
    url = str(payload.get("url") or "").strip()
    if not url:
        return {"error": "url is required for navigate"}
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return {"error": "only absolute http(s) URLs are allowed"}
    return {"detail": f"navigated:{url}", "via": "browser-use"}


def qualify(payload: dict[str, Any]) -> dict[str, Any]:
    icp = str(payload.get("icp") or "").strip()
    if not icp:
        return {"error": "icp is required"}
    hay = f"{payload.get('profileUrl') or ''} {payload.get('snippet') or ''} {icp}".lower()
    score = 40
    reasons = ["Heuristic ICP score from sidecar stub."]
    if re.search(r"tonywalteur|agentic|ai|innovation|ultron|mantu", hay):
        score += 32
        reasons.append("Matched enterprise AI / agentic ICP keywords.")
    if "linkedin.com/in/" in hay:
        score += 8
        reasons.append("LinkedIn profile URL present.")
    return {"score": min(score, 99), "reasons": reasons}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: Any) -> None:  # noqa: A003
        return

    def _send(self, code: int, body: dict[str, Any]) -> None:
        raw = json.dumps(body).encode("utf-8")
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _read_json(self) -> dict[str, Any] | None:
        length = int(self.headers.get("content-length") or 0)
        if length <= 0:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            return None

    def do_GET(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] == "/health":
            self._send(
                200,
                {
                    "ok": True,
                    "service": "aria-linkedin-browser-agents",
                    "endpoints": ["/analyze", "/search", "/act", "/qualify"],
                },
            )
            return
        self._send(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        payload = self._read_json()
        if payload is None:
            self._send(400, {"error": "invalid JSON"})
            return
        routes = {
            "/analyze": analyze,
            "/search": search,
            "/act": act,
            "/qualify": qualify,
        }
        fn = routes.get(path)
        if not fn:
            self._send(404, {"error": "not found"})
            return
        result = fn(payload)
        if "error" in result:
            self._send(502, result)
            return
        self._send(200, result)


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"aria linkedin-browser-agents sidecar on http://{HOST}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
