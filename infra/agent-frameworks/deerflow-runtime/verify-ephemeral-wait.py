#!/usr/bin/env python3
"""Dependency-free behavioral test for ARIA's patched DeerFlow wait route."""

from __future__ import annotations

import ast
import asyncio
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace


class HTTPException(Exception):
    def __init__(self, *, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class ProcessTerminated(BaseException):
    def __init__(self, code: int) -> None:
        super().__init__(code)
        self.code = code


class StartFailure(Exception):
    pass


class WaitFailure(Exception):
    pass


class SerializeFailure(Exception):
    pass


class QuietLogger:
    def exception(self, *_args, **_kwargs) -> None:
        return None

    def critical(self, *_args, **_kwargs) -> None:
        return None


class FakeOS:
    def __init__(self, state) -> None:
        self.state = state

    def _exit(self, code: int) -> None:
        self.state.calls.append(("process_exit", code))
        raise ProcessTerminated(code)


class Component:
    def __init__(self, state, label: str, *, fail: bool = False) -> None:
        self.state = state
        self.label = label
        self.fail = fail

    async def delete(self, identifier: str) -> None:
        self.state.calls.append((self.label, identifier))
        if self.fail:
            raise RuntimeError(self.label)

    async def delete_by_thread(self, identifier: str) -> None:
        await self.delete(identifier)

    async def cleanup(self, identifier: str, *, delay: float) -> None:
        assert delay == 0
        await self.delete(identifier)


class RunStore(Component):
    async def list_by_thread(self, thread_id: str, *, user_id, limit: int):
        assert user_id is None
        assert limit == 100
        self.state.calls.append(("run_store_discovery", thread_id))
        if self.fail and self.label == "run_store_discovery":
            raise RuntimeError(self.label)
        if self.state.record is None:
            return []
        return [{"run_id": self.state.record.run_id, "thread_id": thread_id}]


class RunManager(Component):
    async def list_by_thread(self, thread_id: str, *, user_id, limit: int):
        assert user_id is None
        assert limit == 100
        self.state.calls.append(("run_manager_discovery", thread_id))
        if self.fail and self.label == "run_manager_discovery":
            raise RuntimeError(self.label)
        return [] if self.state.record is None else [self.state.record]


class Checkpointer(Component):
    async def aget_tuple(self, config):
        self.state.calls.append(("serialize_source", config["configurable"]["thread_id"]))
        return SimpleNamespace(checkpoint={"channel_values": {"messages": [{"content": "serialized"}]}})

    async def adelete_thread(self, identifier: str) -> None:
        await self.delete(identifier)


class PathManager:
    def __init__(self, state) -> None:
        self.state = state

    def delete_thread_dir(self, identifier: str, *, user_id: str | None = None) -> None:
        self.state.calls.append(("thread_files", identifier, user_id))


class Body:
    def __init__(self, *, on_completion: str, thread_id: str | None = None) -> None:
        configurable = {"model_name": "aria-model"}
        if thread_id is not None:
            configurable["thread_id"] = thread_id
        self.config = {"configurable": configurable}
        self.on_completion = on_completion


def load_functions(target: Path):
    tree = ast.parse(target.read_text(encoding="utf-8"), filename=str(target))
    names = {
        "_configured_thread_id",
        "_delete_temporary_wait_state",
        "_shielded_delete_temporary_wait_state",
        "stateless_wait",
    }
    functions = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in names:
            node.decorator_list = []
            functions.append(node)
    if {node.name for node in functions} != names:
        raise AssertionError("patched wait functions are incomplete")
    module = ast.fix_missing_locations(ast.Module(body=functions, type_ignores=[]))
    return module


def make_environment(
    module,
    *,
    fail_label: str | None = None,
    start_failure: bool = False,
    wait_result: bool = True,
    wait_failure: bool = False,
    wait_block: bool = False,
    serialize_failure: bool = False,
    worker_task: bool = False,
):
    state = SimpleNamespace(calls=[], record=None, wait_started=asyncio.Event())
    checkpointer = Checkpointer(state, "checkpointer", fail=fail_label == "checkpointer")
    components = {
        "run_store": RunStore(state, "run_store", fail=fail_label == "run_store"),
        "run_events": Component(state, "run_events", fail=fail_label == "run_events"),
        "thread_store": Component(state, "thread_store", fail=fail_label == "thread_store"),
        "stream_bridge": Component(state, "stream_bridge", fail=fail_label == "stream_bridge"),
        "run_manager": RunManager(state, "run_manager", fail=fail_label == "run_manager"),
    }
    paths = PathManager(state)

    async def background_run():
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            state.calls.append(("worker_cancelled", "run-exact"))
            raise

    async def start_run(_body, thread_id, _request):
        state.calls.append(("start", thread_id))
        state.record = SimpleNamespace(
            run_id="run-exact",
            thread_id=thread_id,
            task=asyncio.create_task(background_run()) if worker_task else None,
            status=SimpleNamespace(value="success"),
            error=None,
        )
        if start_failure:
            raise StartFailure("start failed")
        return state.record

    async def wait_for_run_completion(*_args):
        state.calls.append(("wait", "run-exact"))
        state.wait_started.set()
        if wait_block:
            await asyncio.Event().wait()
        if wait_failure:
            raise WaitFailure("wait failed")
        return wait_result

    async def run_file_io(func, *args, **kwargs):
        return func(*args, **kwargs)

    def serialize(values):
        state.calls.append(("serialize", values))
        if serialize_failure:
            raise SerializeFailure("serialization failed")
        return {"serialized": values}

    namespace = {
        "Body": Body,
        "HTTPException": HTTPException,
        "Request": object,
        "RunCreateRequest": object,
        "asyncio": asyncio,
        "get_checkpointer": lambda _request: checkpointer,
        "get_run_store": lambda _request: components["run_store"],
        "get_run_event_store": lambda _request: components["run_events"],
        "get_thread_store": lambda _request: components["thread_store"],
        "get_stream_bridge": lambda _request: components["stream_bridge"],
        "get_run_manager": lambda _request: components["run_manager"],
        "get_paths": lambda: paths,
        "get_effective_user_id": lambda: "owner-exact",
        "logger": QuietLogger(),
        "os": FakeOS(state),
        "run_file_io": run_file_io,
        "serialize_channel_values_for_api": serialize,
        "start_run": start_run,
        "wait_for_run_completion": wait_for_run_completion,
        "uuid": uuid,
    }
    exec(compile(module, "<patched-runs>", "exec"), namespace)
    return namespace, state


def cleanup_labels(state) -> list[str]:
    return [call[0] for call in state.calls]


def assert_exact_cleanup(state) -> None:
    labels = cleanup_labels(state)
    for label in (
        "run_manager_discovery",
        "run_store_discovery",
        "checkpointer",
        "run_store",
        "run_events",
        "thread_store",
        "stream_bridge",
        "run_manager",
        "thread_files",
    ):
        assert label in labels, label
    thread_id = state.record.thread_id
    assert ("checkpointer", thread_id) in state.calls
    assert ("run_store", "run-exact") in state.calls
    assert ("run_events", thread_id) in state.calls
    assert ("thread_store", thread_id) in state.calls
    assert ("stream_bridge", "run-exact") in state.calls
    assert ("run_manager", "run-exact") in state.calls
    assert ("thread_files", thread_id, "owner-exact") in state.calls


async def verify_success(module) -> None:
    namespace, state = make_environment(module)
    result = await namespace["stateless_wait"](Body(on_completion="delete"), object())
    assert result["serialized"]["messages"][0]["content"] == "serialized"
    labels = cleanup_labels(state)
    assert labels.index("serialize") < labels.index("checkpointer")
    assert_exact_cleanup(state)


async def verify_incomplete_cleans_and_preserves_error(module) -> None:
    namespace, state = make_environment(module, wait_result=False, worker_task=True)
    try:
        await namespace["stateless_wait"](Body(on_completion="delete"), object())
    except HTTPException as exc:
        assert exc.status_code == 500
        assert exc.detail == "Temporary run did not complete"
    else:
        raise AssertionError("incomplete temporary run returned success")
    assert "worker_cancelled" in cleanup_labels(state)
    assert_exact_cleanup(state)


async def verify_wait_exception_cleans_and_preserves_error(module) -> None:
    namespace, state = make_environment(module, wait_failure=True, worker_task=True)
    try:
        await namespace["stateless_wait"](Body(on_completion="delete"), object())
    except WaitFailure:
        pass
    else:
        raise AssertionError("wait failure was replaced or swallowed")
    assert_exact_cleanup(state)


async def verify_start_exception_cleans_and_preserves_error(module) -> None:
    namespace, state = make_environment(module, start_failure=True, worker_task=True)
    try:
        await namespace["stateless_wait"](Body(on_completion="delete"), object())
    except StartFailure:
        pass
    else:
        raise AssertionError("start failure was replaced or swallowed")
    assert "worker_cancelled" in cleanup_labels(state)
    assert_exact_cleanup(state)


async def verify_serialization_exception_cleans(module) -> None:
    namespace, state = make_environment(module, serialize_failure=True)
    try:
        await namespace["stateless_wait"](Body(on_completion="delete"), object())
    except HTTPException as exc:
        assert exc.status_code == 500
        assert exc.detail == "Temporary run result serialization failed"
    else:
        raise AssertionError("serialization failure returned a result")
    assert_exact_cleanup(state)


async def verify_handler_cancellation_is_shielded(module) -> None:
    namespace, state = make_environment(module, wait_block=True, worker_task=True)
    request_task = asyncio.create_task(namespace["stateless_wait"](Body(on_completion="delete"), object()))
    await asyncio.wait_for(state.wait_started.wait(), timeout=1)
    request_task.cancel()
    try:
        await request_task
    except asyncio.CancelledError:
        pass
    else:
        raise AssertionError("request cancellation was swallowed")
    assert "worker_cancelled" in cleanup_labels(state)
    assert_exact_cleanup(state)


async def verify_cleanup_failure_terminates_worker(module) -> None:
    namespace, state = make_environment(module, fail_label="run_store")
    try:
        await namespace["stateless_wait"](Body(on_completion="delete"), object())
    except ProcessTerminated as exc:
        assert exc.code == 70
    else:
        raise AssertionError("cleanup uncertainty left the worker serving")
    labels = cleanup_labels(state)
    assert labels.index("run_store") < labels.index("thread_files") < labels.index("process_exit")
    assert "run_manager" in labels


async def verify_existing_thread_is_never_deleted(module) -> None:
    namespace, state = make_environment(module)
    try:
        await namespace["stateless_wait"](
            Body(on_completion="delete", thread_id="caller-owned-thread"),
            object(),
        )
    except HTTPException as exc:
        assert exc.status_code == 400
    else:
        raise AssertionError("caller-owned thread accepted destructive completion")
    assert state.calls == []


async def verify_keep_preserves_state(module) -> None:
    namespace, state = make_environment(module)
    result = await namespace["stateless_wait"](Body(on_completion="keep"), object())
    assert result["serialized"]["messages"][0]["content"] == "serialized"
    assert cleanup_labels(state) == ["start", "serialize_source", "serialize"]


async def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: verify-ephemeral-wait.py PATCHED_RUNS_PY")
    module = load_functions(Path(sys.argv[1]))
    await verify_success(module)
    await verify_incomplete_cleans_and_preserves_error(module)
    await verify_wait_exception_cleans_and_preserves_error(module)
    await verify_start_exception_cleans_and_preserves_error(module)
    await verify_serialization_exception_cleans(module)
    await verify_handler_cancellation_is_shielded(module)
    await verify_cleanup_failure_terminates_worker(module)
    await verify_existing_thread_is_never_deleted(module)
    await verify_keep_preserves_state(module)


if __name__ == "__main__":
    asyncio.run(main())
