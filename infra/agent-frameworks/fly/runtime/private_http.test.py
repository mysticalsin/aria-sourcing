#!/usr/bin/env python3

import http.server
import importlib
import os
import threading
import urllib.error
import urllib.request

import private_http


class TargetHandler(http.server.BaseHTTPRequestHandler):
    calls = 0

    def do_GET(self) -> None:
        type(self).calls += 1
        self.send_response(200)
        self.end_headers()

    def log_message(self, _format: str, *_args: object) -> None:
        return


class RedirectHandler(http.server.BaseHTTPRequestHandler):
    target_url = ""

    def do_GET(self) -> None:
        self.send_response(302)
        self.send_header("Location", type(self).target_url)
        self.end_headers()

    def log_message(self, _format: str, *_args: object) -> None:
        return


class ProxyHandler(http.server.BaseHTTPRequestHandler):
    calls = 0

    def do_GET(self) -> None:
        type(self).calls += 1
        self.send_response(200)
        self.end_headers()

    def log_message(self, _format: str, *_args: object) -> None:
        return


def serve(handler: type[http.server.BaseHTTPRequestHandler]) -> http.server.HTTPServer:
    server = http.server.HTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


target = serve(TargetHandler)
redirector = serve(RedirectHandler)
proxy = serve(ProxyHandler)
RedirectHandler.target_url = f"http://127.0.0.1:{target.server_port}/health"

try:
    request = urllib.request.Request(
        f"http://127.0.0.1:{redirector.server_port}/health",
        method="GET",
    )
    try:
        private_http.open_without_redirect(request, timeout=1)
    except urllib.error.HTTPError as error:
        assert error.code == 302
    else:
        raise AssertionError("redirecting readiness request was accepted")
    assert TargetHandler.calls == 0, "readiness transport followed a redirect"

    proxy_keys = ("HTTP_PROXY", "http_proxy", "NO_PROXY", "no_proxy")
    previous_proxy_environment = {key: os.environ.get(key) for key in proxy_keys}
    proxy_url = f"http://127.0.0.1:{proxy.server_port}"
    os.environ.update({
        "HTTP_PROXY": proxy_url,
        "http_proxy": proxy_url,
        "NO_PROXY": "",
        "no_proxy": "",
    })
    try:
        importlib.reload(private_http)
        proxied_request = urllib.request.Request(
            "http://authority.invalid/health",
            method="GET",
        )
        try:
            private_http.open_without_redirect(proxied_request, timeout=1)
        except urllib.error.URLError:
            pass
        else:
            raise AssertionError("proxy-supplied readiness response was accepted")
        assert ProxyHandler.calls == 0, "readiness transport used an inherited proxy"
    finally:
        for key, value in previous_proxy_environment.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        importlib.reload(private_http)
finally:
    proxy.shutdown()
    redirector.shutdown()
    target.shutdown()
