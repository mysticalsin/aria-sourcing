"""Bound ARIA's patched DeerFlow cleanup without changing its audited file."""

from __future__ import annotations

import asyncio
import math
import os
import threading
from collections.abc import Callable
from types import ModuleType


CLEANUP_DEADLINE_SECONDS = 10.0
_MARKER = "__aria_cleanup_deadline_installed__"


def install_cleanup_deadline(
    runs_module: ModuleType,
    *,
    deadline_seconds: float = CLEANUP_DEADLINE_SECONDS,
    exit_process: Callable[[int], None] = os._exit,
) -> None:
    """Terminate the single worker when temporary-state cleanup cannot finish."""
    if not math.isfinite(deadline_seconds) or deadline_seconds <= 0:
        raise ValueError("cleanup deadline is invalid")
    cleanup = getattr(runs_module, "_delete_temporary_wait_state", None)
    if not callable(cleanup):
        raise RuntimeError("patched DeerFlow cleanup is unavailable")
    if getattr(cleanup, _MARKER, False):
        return
    async def bounded_cleanup(*args, **kwargs) -> None:
        watchdog = threading.Timer(deadline_seconds, exit_process, args=(70,))
        watchdog.daemon = True
        watchdog.start()
        cleanup_task = asyncio.create_task(cleanup(*args, **kwargs))
        try:
            await cleanup_task
        finally:
            watchdog.cancel()

    setattr(bounded_cleanup, _MARKER, True)
    setattr(runs_module, "_delete_temporary_wait_state", bounded_cleanup)
