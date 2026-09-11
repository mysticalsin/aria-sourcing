#!/usr/bin/env python3
"""
Unified LinkedIn / browser-agent sidecar for Aria.

Implements the HTTP contracts expected by
`src/lib/integrations/linkedin-browser-agents.ts`:

  GET  /health
  POST /analyze   { url }                 -> Orca-style insight from real page text
  POST /search    { keywords, limit? }    -> real DuckDuckGo HTML hits (linkedin.com/in only)
  POST /act       { type, url? ... }      -> browser-use navigate = real fetch
  POST /qualify   { profileUrl?, snippet?, icp } -> token-overlap ICP score

Never invents LinkedIn profile URLs. Connect/Message are refused.
"""

from __future__ import annotations

import html as html_lib
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

HOST = os.environ.get("ARIA_AGENT_SIDECAR_HOST", "0.0.0.0")
PORT = int(os.environ.get("ARIA_AGENT_SIDECAR_PORT", "8092"))
UA = (
    "Mozilla/5.0 (compatible; AriaSourcingBot/1.0; +https://github.com/mysticalsin/aria-sourcing)"
)
STOP = {
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "are",
    "was",
    "were",
    "have",
    "has",
    "you",
    "your",
    "our",
    "their",
    "about",
    "than",
    "then",
    "them",
    "they",
    "who",
    "what",
    "when",
    "where",
    "which",
    "will",
    "can",
    "may",
    "not",
    "but",
    "all",
    "any",
    "out",
    "via",
    "www",
    "http",
    "https",
    "com",
    "linkedin",
}


def _slug_label(url: str) -> str:
    try:
        path = urllib.parse.urlparse(url).path
        m = re.search(r"/in/([^/]+)", path, re.I)
        slug = (m.group(1) if m else "").replace("-", " ").strip()
        return slug.title() if slug else "this profile"
    except Exception:
        return "this profile"


def _is_linkedin_profile(url: str) -> bool:
    try:
        u = urllib.parse.urlparse(url)
        host = (u.hostname or "").lower()
        if not (host == "linkedin.com" or host.endswith(".linkedin.com")):
            return False
        return bool(re.search(r"/in/[^/]+", u.path or "", re.I))
    except Exception:
        return False


def _normalize_profile(url: str) -> str:
    try:
        u = urllib.parse.urlparse(url.strip())
        m = re.search(r"/in/([^/]+)", u.path or "", re.I)
        if not m:
            return url.strip()
        return f"https://www.linkedin.com/in/{m.group(1)}/"
    except Exception:
        return url.strip()


def _fetch(url: str, timeout: float = 15.0) -> tuple[str, str]:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/xhtml+xml"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read(400_000)
        charset = "utf-8"
        ctype = resp.headers.get_content_charset()
        if ctype:
            charset = ctype
        text = raw.decode(charset, errors="replace")
        title_m = re.search(r"<title[^>]*>(.*?)</title>", text, re.I | re.S)
        title = html_lib.unescape(re.sub(r"\s+", " ", title_m.group(1))).strip() if title_m else ""
        # Strip scripts/styles then tags for a rough text body.
        cleaned = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", text)
        cleaned = re.sub(r"(?is)<[^>]+>", " ", cleaned)
        cleaned = html_lib.unescape(re.sub(r"\s+", " ", cleaned)).strip()
        return title, cleaned[:8000]


def _tokenize(text: str) -> list[str]:
    return [
        t
        for t in re.split(r"[^a-z0-9+#.]+", text.lower())
        if len(t) > 2 and t not in STOP
    ]


def _insight_from_text(url: str, title: str, text: str) -> dict[str, Any]:
    label = title or _slug_label(url)
    hay = f"{title}\n{text}".lower()
    focus_pool = [
        "ai",
        "agentic",
        "machine learning",
        "llm",
        "platform",
        "cloud",
        "security",
        "data",
        "product",
        "engineering",
        "innovation",
        "automation",
        "devops",
        "sales",
        "recruiting",
    ]
    focus = [k for k in focus_pool if k in hay][:5]
    sentences = [
        s.strip()
        for s in re.split(r"[.!?\n]+", text)
        if 40 < len(s.strip()) < 220
    ][:8]
    pain_hints = ["scale", "adoption", "transform", "legacy", "growth", "efficiency", "hiring", "delivery"]
    pains = [f"Signals around {k} in public profile text" for k in pain_hints if k in hay][:3]
    return {
        "url": url,
        "headline": label[:160],
        "focusAreas": focus or _tokenize(label)[:3],
        "trajectoryNotes": sentences[:2]
        or [f"Public profile text read for {label}."],
        "painPoints": pains
        or ["Enterprise delivery and adoption pressure (inferred from thin public signal)"],
        "via": "orca-style",
        "evidenceText": text[:1200],
        "text": text[:4000],
        "title": title,
    }


def analyze(payload: dict[str, Any]) -> dict[str, Any]:
    url = str(payload.get("url") or "").strip()
    if not url:
        return {"error": "url is required"}
    clean = _normalize_profile(url) if _is_linkedin_profile(url) else url
    try:
        title, text = _fetch(clean)
        if text.strip():
            return _insight_from_text(clean, title, text)
    except Exception as exc:  # noqa: BLE001
        label = _slug_label(clean)
        return {
            "url": clean,
            "headline": label,
            "focusAreas": _tokenize(label)[:3],
            "trajectoryNotes": [
                f"Public page fetch failed for {label}: {type(exc).__name__}.",
                "Confirm details via AriaBot Take control before outreach.",
            ],
            "painPoints": ["Limited public signal — login wall or bot block"],
            "via": "orca-style",
        }
    label = _slug_label(clean)
    return {
        "url": clean,
        "headline": label,
        "focusAreas": _tokenize(label)[:3],
        "trajectoryNotes": [f"Empty public body for {label}."],
        "painPoints": ["Limited public signal"],
        "via": "orca-style",
    }


def _ddg_search(query: str, limit: int) -> list[dict[str, Any]]:
    """Parse DuckDuckGo HTML results; only keep real linkedin.com/in URLs.

    Uses POST to /html/ (the form endpoint). GET often returns a thin/bot page
    with zero result__a anchors.
    """
    chrome_ua = (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
    data = urllib.parse.urlencode({"q": query, "b": ""}).encode("utf-8")
    req = urllib.request.Request(
        "https://html.duckduckgo.com/html/",
        data=data,
        headers={
            "User-Agent": chrome_ua,
            "Accept": "text/html,application/xhtml+xml",
            "Content-Type": "application/x-www-form-urlencoded",
            "Referer": "https://html.duckduckgo.com/",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        body = resp.read(500_000).decode("utf-8", errors="replace")

    hits: list[dict[str, Any]] = []
    seen: set[str] = set()

    # Anchors may put class before or after href.
    anchor_re = re.compile(
        r'<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)</a>'
        r'|<a[^>]*href="([^"]+)"[^>]*class="[^"]*result__a[^"]*"[^>]*>(.*?)</a>',
        re.I | re.S,
    )
    for m in anchor_re.finditer(body):
        href = html_lib.unescape(m.group(1) or m.group(3) or "")
        title = html_lib.unescape(re.sub(r"<[^>]+>", "", (m.group(2) or m.group(4) or ""))).strip()
        # Protocol-relative redirect: //duckduckgo.com/l/?uddg=<encoded>
        if href.startswith("//"):
            href = "https:" + href
        if "uddg=" in href:
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(href).query)
            enc = (qs.get("uddg") or [""])[0]
            href = urllib.parse.unquote(enc)
        if not _is_linkedin_profile(href):
            continue
        profile = _normalize_profile(href)
        if re.search(r"lead-\d+/?$", profile, re.I):
            continue
        if profile in seen:
            continue
        seen.add(profile)
        snippet = ""
        snip_m = re.search(
            r'class="[^"]*result__snippet[^"]*"[^>]*>(.*?)</(?:a|td|div|span)>',
            body[m.end() : m.end() + 800],
            re.I | re.S,
        )
        if snip_m:
            snippet = html_lib.unescape(re.sub(r"<[^>]+>", " ", snip_m.group(1))).strip()
        hits.append(
            {
                "profileUrl": profile,
                "name": _slug_label(profile) if not title else title.split("|")[0].split("-")[0].strip()[:80],
                "title": title[:160],
                "snippet": snippet[:300],
                "via": "linkedin-agent-tool",
            }
        )
        if len(hits) >= limit:
            break
    return hits


def search(payload: dict[str, Any]) -> dict[str, Any]:
    keywords = payload.get("keywords") or []
    if not isinstance(keywords, list) or not keywords:
        return {"error": "keywords array is required"}
    limit = int(payload.get("limit") or 5)
    limit = max(1, min(limit, 25))
    parts = ["site:linkedin.com/in", *[str(k).strip() for k in keywords if str(k).strip()]]
    loc = str(payload.get("location") or "").strip()
    if loc:
        parts.append(loc)
    query = " ".join(parts)
    try:
        hits = _ddg_search(query, limit)
    except Exception as exc:  # noqa: BLE001
        return {"error": f"search failed: {type(exc).__name__}: {exc}", "hits": []}
    if not hits:
        return {"hits": [], "error": "No public LinkedIn profile URLs found for that query."}
    # Attach location from request when present (DDG rarely returns structured location).
    if loc:
        for h in hits:
            h["location"] = loc
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
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return {"error": "only absolute http(s) URLs are allowed"}
    try:
        title, text = _fetch(url)
    except Exception as exc:  # noqa: BLE001
        return {"error": f"navigate fetch failed: {type(exc).__name__}: {exc}"}
    if not text.strip():
        return {"error": "navigate returned empty body"}
    return {
        "detail": f"Fetched {title or url}",
        "via": "browser-use",
        "title": title,
        "text": text[:4000],
        "url": url,
    }


def qualify(payload: dict[str, Any]) -> dict[str, Any]:
    icp = str(payload.get("icp") or "").strip()
    if not icp:
        return {"error": "icp is required"}
    evidence = f"{payload.get('profileUrl') or ''}\n{payload.get('snippet') or ''}"
    profile = str(payload.get("profileUrl") or "").strip()
    if profile and (_is_linkedin_profile(profile) or profile.startswith("http")):
        try:
            title, text = _fetch(_normalize_profile(profile) if _is_linkedin_profile(profile) else profile)
            evidence += f"\n{title}\n{text[:2000]}"
        except Exception:
            pass
    icp_tokens = list(dict.fromkeys(_tokenize(icp)))
    hay_tokens = set(_tokenize(evidence))
    if not icp_tokens:
        return {"score": 0, "reasons": ["ICP text empty after tokenization."]}
    matched = [t for t in icp_tokens if t in hay_tokens or t in evidence.lower()]
    ratio = len(matched) / len(icp_tokens)
    score = int(35 + ratio * 55)
    reasons = []
    if matched:
        reasons.append(f"Matched ICP tokens: {', '.join(matched[:8])}")
    else:
        reasons.append("No ICP token overlap in available public text.")
    if "linkedin.com/in/" in evidence.lower():
        score += 5
        reasons.append("LinkedIn profile URL present.")
    if len(evidence) > 400:
        score += 3
        reasons.append("Sufficient public text for qualification.")
    return {"score": max(0, min(99, score)), "reasons": reasons}


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
                    "mode": "real-work",
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
        if "error" in result and path != "/search":
            self._send(502, result)
            return
        if "error" in result and path == "/search" and not result.get("hits"):
            self._send(502, result)
            return
        self._send(200, result)


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"aria linkedin-browser-agents sidecar on http://{HOST}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
