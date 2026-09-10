#!/usr/bin/env python3
"""
Minimal Scrapling-compatible sidecar for Aria.

Upstream: https://github.com/D4Vinci/Scrapling

Contract (matches src/lib/scrapling/adapter.ts):
  POST /fetch  { url, selectors?, sessionId?, timeoutMs? }
  → { title, text, extracted } or { error }

When the Scrapling package is installed, uses Fetcher (stealth-capable).
Otherwise falls back to urllib with honest bot headers so local/dev still works.
"""

from __future__ import annotations

import json
import os
import re
import ssl
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse

HOST = os.environ.get("SCRAPLING_HOST", "0.0.0.0")
PORT = int(os.environ.get("SCRAPLING_PORT", "8091"))
MAX_TEXT = 20_000

_sessions: dict[str, Any] = {}


def _try_scrapling_fetch(url: str, timeout_s: float) -> dict[str, Any] | None:
    try:
        from scrapling.fetchers import Fetcher  # type: ignore
    except Exception:
        return None
    try:
        page = Fetcher.get(url, stealthy_headers=True, timeout=int(timeout_s * 1000))
        html = getattr(page, "html_content", None) or getattr(page, "body", "") or ""
        title = ""
        if hasattr(page, "css_first"):
            node = page.css_first("title")
            title = (getattr(node, "text", None) or str(node) if node else "") or ""
        text = re.sub(r"<[^>]+>", " ", str(html))
        text = re.sub(r"\s+", " ", text).strip()
        return {"title": title.strip(), "text": text[:MAX_TEXT], "extracted": {}, "via": "scrapling"}
    except Exception as err:  # noqa: BLE001
        return {"error": f"scrapling fetch failed: {err}"}


def _urllib_fetch(url: str, timeout_s: float) -> dict[str, Any]:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return {"error": "only absolute http(s) URLs are allowed"}
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "AriaScraplingBridge/1.0 (+research; https://github.com/D4Vinci/Scrapling)",
            "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.8",
        },
        method="GET",
    )
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, timeout=timeout_s, context=ctx) as res:
        raw = res.read(2_000_000)
        charset = res.headers.get_content_charset() or "utf-8"
        html = raw.decode(charset, errors="replace")
    title_m = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    title = re.sub(r"\s+", " ", title_m.group(1)).strip() if title_m else ""
    text = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", html)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return {"title": title, "text": text[:MAX_TEXT], "extracted": {}, "via": "urllib-fallback"}


def fetch_page(payload: dict[str, Any]) -> dict[str, Any]:
    url = str(payload.get("url") or "").strip()
    if not url:
        return {"error": "url is required"}
    timeout_ms = int(payload.get("timeoutMs") or 20_000)
    timeout_s = max(1.0, min(timeout_ms / 1000.0, 60.0))
    selectors = payload.get("selectors") or []
    session_id = str(payload.get("sessionId") or "")

    # Prefer real Scrapling when installed.
    result = _try_scrapling_fetch(url, timeout_s)
    if result is None:
        result = _urllib_fetch(url, timeout_s)
    elif result.get("error"):
        # Soft-fallback so Aria research still works without a perfect Scrapling install.
        fallback = _urllib_fetch(url, timeout_s)
        if not fallback.get("error"):
            fallback["extracted"] = {"scraplingError": result["error"]}
            result = fallback

    if result.get("error"):
        return result

    extracted: dict[str, str] = dict(result.get("extracted") or {})
    # Lightweight selector extraction for CSS-ish "text of first match" hints.
    html_blob = result.get("text") or ""
    if isinstance(selectors, list):
        for sel in selectors[:20]:
            key = str(sel)
            # Best-effort: treat selector string as a plain substring marker.
            if key and key.lower() in html_blob.lower():
                extracted[key] = "matched"
    if session_id:
        _sessions[session_id] = {"lastUrl": url}
        extracted["sessionId"] = session_id
    result["extracted"] = extracted
    return result


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: Any) -> None:  # noqa: A003
        print(f"[scrapling] {self.address_string()} {fmt % args}")

    def _send(self, code: int, payload: dict[str, Any]) -> None:
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(raw)))
        self.send_header("access-control-allow-origin", "*")
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-allow-methods", "GET,POST,OPTIONS")
        self.send_header("access-control-allow-headers", "content-type")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path.startswith("/health"):
            scrapling_ok = False
            try:
                import scrapling  # noqa: F401

                scrapling_ok = True
            except Exception:
                scrapling_ok = False
            return self._send(200, {"ok": True, "scraplingInstalled": scrapling_ok, "sessions": len(_sessions)})
        return self._send(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if not self.path.startswith("/fetch"):
            return self._send(404, {"error": "not found"})
        length = int(self.headers.get("content-length") or 0)
        if length > 100_000:
            return self._send(413, {"error": "body too large"})
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            return self._send(400, {"error": "invalid JSON"})
        if not isinstance(payload, dict):
            return self._send(400, {"error": "JSON object required"})
        result = fetch_page(payload)
        code = 200 if not result.get("error") else 502
        return self._send(code, result)


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(json.dumps({"event": "aria_scrapling_sidecar_ready", "host": HOST, "port": PORT}))
    server.serve_forever()


if __name__ == "__main__":
    main()
