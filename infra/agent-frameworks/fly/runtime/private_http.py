import urllib.request


class RejectRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(
        self,
        _request: urllib.request.Request,
        _file_pointer: object,
        _code: int,
        _message: str,
        _headers: object,
        _new_url: str,
    ) -> None:
        return None


_NO_REDIRECT_OPENER = urllib.request.build_opener(
    urllib.request.ProxyHandler({}),
    RejectRedirects(),
)


def open_without_redirect(
    request: urllib.request.Request,
    *,
    timeout: int,
) -> object:
    return _NO_REDIRECT_OPENER.open(request, timeout=timeout)
