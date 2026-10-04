#!/usr/bin/env python3
"""Install ARIA's audited ephemeral-wait cleanup into one pinned DeerFlow file."""

from __future__ import annotations

import hashlib
import os
import sys
from pathlib import Path


PINNED_COMMIT = "fabadae4168db81f0eaaf62f209050f978e2f691"
EXPECTED_INPUT_SHA256 = "60d4a8c7d17d4336d183165464853eb24ba5a07c3b7ccf4786a170fa8ca6fa40"
EXPECTED_OUTPUT_SHA256 = "79b6601066faa937a2d0b5551f7e1a5311304f1e7b28962c1ccee72cea05d6e7"


IMPORTS_BEFORE = """import logging
import uuid

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from app.gateway.authz import require_permission
from app.gateway.deps import get_checkpointer, get_feedback_repo, get_run_event_store, get_run_manager, get_run_store, get_stream_bridge
from app.gateway.pagination import trim_run_message_page
from app.gateway.routers.thread_runs import RunCreateRequest
from app.gateway.services import sse_consumer, start_run, wait_for_run_completion
from deerflow.runtime import serialize_channel_values_for_api
"""

IMPORTS_AFTER = """import asyncio
import logging
import os
import uuid

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from app.gateway.authz import require_permission
from app.gateway.deps import (
    get_checkpointer,
    get_feedback_repo,
    get_run_event_store,
    get_run_manager,
    get_run_store,
    get_stream_bridge,
    get_thread_store,
)
from app.gateway.pagination import trim_run_message_page
from app.gateway.routers.thread_runs import RunCreateRequest
from app.gateway.services import sse_consumer, start_run, wait_for_run_completion
from deerflow.config.paths import get_paths
from deerflow.runtime import serialize_channel_values_for_api
from deerflow.runtime.user_context import get_effective_user_id
from deerflow.utils.file_io import run_file_io
"""

RESOLVER_BEFORE = '''def _resolve_thread_id(body: RunCreateRequest) -> str:
    """Return the thread_id from the request body, or generate a new one."""
    thread_id = (body.config or {}).get("configurable", {}).get("thread_id")
    if thread_id:
        return str(thread_id)
    return str(uuid.uuid4())
'''

RESOLVER_AFTER = '''def _configured_thread_id(body: RunCreateRequest) -> str | None:
    """Return the caller-provided thread ID, if it is a valid config value."""
    configurable = (body.config or {}).get("configurable")
    if not isinstance(configurable, dict):
        return None
    thread_id = configurable.get("thread_id")
    return str(thread_id) if thread_id else None


def _resolve_thread_id(body: RunCreateRequest) -> str:
    """Return the thread_id from the request body, or generate a new one."""
    return _configured_thread_id(body) or str(uuid.uuid4())


async def _delete_temporary_wait_state(request: Request, record, thread_id: str) -> None:
    """Stop the temporary run and erase every in-process/temp-file projection.

    All independent cleanup steps run even when one fails. Any residual-state
    uncertainty terminates this single-worker process, clearing its memory and
    ephemeral root before Fly or Compose may report it ready again.
    """
    failures: list[str] = []

    def component(label: str, getter):
        try:
            return getter(request)
        except BaseException:
            failures.append(label)
            logger.exception("Temporary wait cleanup step failed: %s", label)
            return None

    async def attempt(label: str, operation):
        try:
            return await operation()
        except BaseException:
            failures.append(label)
            logger.exception("Temporary wait cleanup step failed: %s", label)
            return None

    async def cancel_and_drain(candidate) -> None:
        task = candidate.task
        if task is None:
            return
        if not task.done():
            task.cancel()
        try:
            await task
        except BaseException:
            pass
        if not task.done():
            raise RuntimeError("temporary run task did not stop")

    checkpointer = component("checkpointer_access", get_checkpointer)
    run_store = component("run_store_access", get_run_store)
    event_store = component("run_events_access", get_run_event_store)
    thread_store = component("thread_store_access", get_thread_store)
    bridge = component("stream_bridge_access", get_stream_bridge)
    run_mgr = component("run_manager_access", get_run_manager)

    records = {}
    run_ids: set[str] = set()
    if record is not None:
        if record.thread_id != thread_id:
            failures.append("record_thread_mismatch")
        else:
            records[record.run_id] = record
            run_ids.add(record.run_id)

    if run_mgr is not None:
        discovered = await attempt(
            "run_manager_discovery",
            lambda: run_mgr.list_by_thread(thread_id, user_id=None, limit=100),
        )
        for candidate in discovered or []:
            if candidate.thread_id != thread_id:
                failures.append("run_manager_thread_mismatch")
                continue
            records[candidate.run_id] = candidate
            run_ids.add(candidate.run_id)

    if run_store is not None:
        stored = await attempt(
            "run_store_discovery",
            lambda: run_store.list_by_thread(thread_id, user_id=None, limit=100),
        )
        for row in stored or []:
            run_id = row.get("run_id")
            if row.get("thread_id") != thread_id or not isinstance(run_id, str) or not run_id:
                failures.append("run_store_thread_mismatch")
                continue
            run_ids.add(run_id)

    for candidate in records.values():
        await attempt(
            "run_task",
            lambda candidate=candidate: cancel_and_drain(candidate),
        )

    delete_checkpoints = getattr(checkpointer, "adelete_thread", None) if checkpointer is not None else None
    if checkpointer is not None and not callable(delete_checkpoints):
        failures.append("checkpointer")
    elif delete_checkpoints is not None:
        await attempt("checkpointer", lambda: delete_checkpoints(thread_id))

    if run_store is not None:
        for run_id in run_ids:
            await attempt("run_store", lambda run_id=run_id: run_store.delete(run_id))
    if event_store is not None:
        await attempt("run_events", lambda: event_store.delete_by_thread(thread_id))
    if thread_store is not None:
        await attempt("thread_store", lambda: thread_store.delete(thread_id))
    if bridge is not None:
        for run_id in run_ids:
            await attempt("stream_bridge", lambda run_id=run_id: bridge.cleanup(run_id, delay=0))
    if run_mgr is not None:
        for run_id in run_ids:
            await attempt("run_manager", lambda run_id=run_id: run_mgr.cleanup(run_id, delay=0))
    await attempt(
        "thread_files",
        lambda: run_file_io(
            get_paths().delete_thread_dir,
            thread_id,
            user_id=get_effective_user_id(),
        ),
    )

    if failures:
        logger.critical("Temporary wait cleanup could not prove erasure; terminating worker")
        os._exit(70)
        raise RuntimeError("process termination unexpectedly returned")


async def _shielded_delete_temporary_wait_state(request: Request, record, thread_id: str) -> None:
    """Finish exact cleanup even when the HTTP handler is cancelled."""
    cleanup_task = asyncio.create_task(_delete_temporary_wait_state(request, record, thread_id))
    cancelled = False
    while not cleanup_task.done():
        try:
            await asyncio.shield(cleanup_task)
        except asyncio.CancelledError:
            cancelled = True
    cleanup_task.result()
    if cancelled:
        raise asyncio.CancelledError
'''

WAIT_BEFORE = '''@router.post("/wait", response_model=dict)
async def stateless_wait(body: RunCreateRequest, request: Request) -> dict:
    """Create a run and block until completion.

    If ``config.configurable.thread_id`` is provided, the run is created
    on the given thread so that conversation history is preserved.
    Otherwise a new temporary thread is created.
    """
    thread_id = _resolve_thread_id(body)
    bridge = get_stream_bridge(request)
    run_mgr = get_run_manager(request)
    record = await start_run(body, thread_id, request)

    completed = True
    if record.task is not None:
        completed = await wait_for_run_completion(bridge, record, request, run_mgr)

    if completed:
        checkpointer = get_checkpointer(request)
        config = {"configurable": {"thread_id": thread_id}}
        try:
            checkpoint_tuple = await checkpointer.aget_tuple(config)
            if checkpoint_tuple is not None:
                checkpoint = getattr(checkpoint_tuple, "checkpoint", {}) or {}
                channel_values = checkpoint.get("channel_values", {})
                return serialize_channel_values_for_api(channel_values)
        except Exception:
            logger.exception("Failed to fetch final state for run %s", record.run_id)

    return {"status": record.status.value, "error": record.error}
'''

WAIT_AFTER = '''@router.post("/wait", response_model=dict)
async def stateless_wait(body: RunCreateRequest, request: Request) -> dict:
    """Create a run, serialize its terminal result, then erase temp state."""
    configured_thread_id = _configured_thread_id(body)
    if body.on_completion == "delete" and configured_thread_id is not None:
        raise HTTPException(status_code=400, detail="on_completion=delete requires a temporary thread")

    thread_id = configured_thread_id or str(uuid.uuid4())
    bridge = get_stream_bridge(request)
    run_mgr = get_run_manager(request)
    record = None
    try:
        record = await start_run(body, thread_id, request)

        completed = True
        if record.task is not None:
            completed = await wait_for_run_completion(bridge, record, request, run_mgr)
        if not completed:
            raise HTTPException(status_code=500, detail="Temporary run did not complete")

        result = {"status": record.status.value, "error": record.error}
        checkpointer = get_checkpointer(request)
        config = {"configurable": {"thread_id": thread_id}}
        try:
            checkpoint_tuple = await checkpointer.aget_tuple(config)
            if checkpoint_tuple is not None:
                checkpoint = getattr(checkpoint_tuple, "checkpoint", {}) or {}
                channel_values = checkpoint.get("channel_values", {})
                result = serialize_channel_values_for_api(channel_values)
        except Exception as exc:
            logger.exception("Failed to fetch final state for run %s", record.run_id)
            raise HTTPException(status_code=500, detail="Temporary run result serialization failed") from exc
        return result
    finally:
        if body.on_completion == "delete":
            await _shielded_delete_temporary_wait_state(request, record, thread_id)
'''


def replace_once(source: str, before: str, after: str, label: str) -> str:
    if source.count(before) != 1:
        raise RuntimeError(f"Pinned DeerFlow {label} preimage drifted")
    return source.replace(before, after, 1)


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: patch-ephemeral-wait.py PATH_TO_RUNS_PY", file=sys.stderr)
        return 64

    target = Path(sys.argv[1])
    original = target.read_bytes()
    if hashlib.sha256(original).hexdigest() != EXPECTED_INPUT_SHA256:
        print(
            f"refusing to patch DeerFlow outside audited commit {PINNED_COMMIT}",
            file=sys.stderr,
        )
        return 65

    source = original.decode("utf-8")
    source = replace_once(source, IMPORTS_BEFORE, IMPORTS_AFTER, "imports")
    source = replace_once(source, RESOLVER_BEFORE, RESOLVER_AFTER, "thread resolver")
    source = replace_once(source, WAIT_BEFORE, WAIT_AFTER, "wait route")
    patched = source.encode("utf-8")
    if hashlib.sha256(patched).hexdigest() != EXPECTED_OUTPUT_SHA256:
        print("patched DeerFlow output did not match its audited checksum", file=sys.stderr)
        return 66

    temporary = target.with_name(f".{target.name}.aria-patch-{os.getpid()}")
    temporary.write_bytes(patched)
    temporary.chmod(target.stat().st_mode & 0o777)
    os.replace(temporary, target)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
