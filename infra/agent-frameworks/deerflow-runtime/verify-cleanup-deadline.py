#!/usr/bin/env python3
"""Process-level regressions for the DeerFlow cleanup deadline guard."""

from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path


CHILD = r'''
import asyncio
import importlib.util
import sys
import time
from types import SimpleNamespace

target, mode = sys.argv[1:]
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("aria_cleanup_guard_under_test", target)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)

async def cleanup(*_args, **_kwargs):
    if mode == "blocking-delete":
        time.sleep(5)
        return
    if mode == "hung-delete":
        await asyncio.Event().wait()
        return
    stop = asyncio.Event()

    async def ignores_cancellation():
        while True:
            try:
                await stop.wait()
            except asyncio.CancelledError:
                continue

    worker = asyncio.create_task(ignores_cancellation())
    await asyncio.sleep(0)
    worker.cancel()
    await worker

runs = SimpleNamespace(_delete_temporary_wait_state=cleanup)
guard.install_cleanup_deadline(runs, deadline_seconds=0.05)
asyncio.run(runs._delete_temporary_wait_state(object(), None, mode))
'''


def verify_case(target: Path, mode: str) -> None:
    before = time.monotonic()
    result = subprocess.run(
        [sys.executable, "-c", CHILD, str(target), mode],
        check=False,
        capture_output=True,
        timeout=1,
    )
    assert result.returncode == 70, (mode, result.returncode, result.stderr.decode())
    assert time.monotonic() - before < 0.8, f"{mode} cleanup exceeded its process bound"


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: verify-cleanup-deadline.py CLEANUP_GUARD_PY")
    target = Path(sys.argv[1])
    for mode in ("hung-task", "hung-delete", "blocking-delete"):
        verify_case(target, mode)


if __name__ == "__main__":
    main()
