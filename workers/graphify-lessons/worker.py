#!/usr/bin/env python3
"""Compile redacted sourcing lesson aggregates into a Graphify graph.

This batch worker is deliberately outside the request path. It accepts only
opaque identifiers, fixed enums, and integer evidence counters. Candidate
records, free text, search queries, URLs, contact data, and model prompts are
not part of the input schema.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import sys
import tempfile
from pathlib import Path
from typing import Any

# Force Graphify query logging off before importing any Graphify module. This
# worker never invokes query APIs, but the setting keeps future imports safe.
os.environ["GRAPHIFY_QUERY_LOG_DISABLE"] = "1"
os.environ.pop("GRAPHIFY_QUERY_LOG_ENABLE", None)
os.environ.pop("GRAPHIFY_QUERY_LOG_RESPONSES", None)

from graphify.build import build_from_json
from graphify.cluster import cluster, score_all
from graphify.export import to_json


GRAPHIFY_REPOSITORY = "https://github.com/Graphify-Labs/graphify.git"
GRAPHIFY_COMMIT = "94d3099540550d58dd121ec3e67cf93e80364079"
INPUT_SCHEMA_VERSION = 1
MAX_INPUT_BYTES = 2 * 1024 * 1024
MAX_LESSONS = 5_000
MAX_COUNT = 10_000_000
SOURCE_FILE = "server-owned-redacted-lessons-v1"

_FINGERPRINT_RE = re.compile(r"^[0-9a-f]{64}$")
_LESSON_ID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)
_SOURCE_PLATFORMS = {"behance", "dribbble", "github", "linkedin", "stack_overflow"}
_STRATEGIES = {"combined", "keyword", "language", "location"}
_OUTCOMES = {"corrected", "dead_end", "useful"}
_PROMOTION_STATUSES = {"draft", "promoted", "retired", "suspended"}


class WorkerInputError(ValueError):
    """Raised when the redacted input contract is violated."""


def _reject_json_constant(_value: str) -> None:
    raise WorkerInputError("JSON constants must be finite")


def _expect_object(value: Any, context: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise WorkerInputError(f"{context} must be an object")
    return value


def _expect_exact_keys(
    value: dict[str, Any], required: set[str], context: str
) -> None:
    if set(value) != required:
        raise WorkerInputError(f"{context} has an invalid field set")


def _expect_fingerprint(value: Any, context: str) -> str:
    if not isinstance(value, str) or not _FINGERPRINT_RE.fullmatch(value):
        raise WorkerInputError(f"{context} must be a lowercase SHA-256 or HMAC digest")
    return value


def _expect_enum(value: Any, allowed: set[str], context: str) -> str:
    if not isinstance(value, str) or value not in allowed:
        raise WorkerInputError(f"{context} has an unsupported value")
    return value


def _expect_count(value: Any, context: str, *, minimum: int = 0) -> int:
    if type(value) is not int or not minimum <= value <= MAX_COUNT:
        raise WorkerInputError(f"{context} is outside the allowed integer range")
    return value


def _read_json(input_path: Path) -> Any:
    if input_path.is_symlink():
        raise WorkerInputError("input must not be a symbolic link")
    try:
        mode = input_path.stat().st_mode
    except OSError as exc:
        raise WorkerInputError("input is not readable") from exc
    if not stat.S_ISREG(mode):
        raise WorkerInputError("input must be a regular file")
    if input_path.stat().st_size > MAX_INPUT_BYTES:
        raise WorkerInputError("input exceeds the byte limit")
    try:
        raw = input_path.read_bytes()
        text = raw.decode("utf-8")
        return json.loads(text, parse_constant=_reject_json_constant)
    except UnicodeDecodeError as exc:
        raise WorkerInputError("input must be UTF-8") from exc
    except json.JSONDecodeError as exc:
        raise WorkerInputError("input must be valid JSON") from exc


def _validate_payload(raw: Any) -> dict[str, Any]:
    payload = _expect_object(raw, "payload")
    _expect_exact_keys(
        payload,
        {"schemaVersion", "workspaceFingerprint", "lessons"},
        "payload",
    )
    if payload["schemaVersion"] != INPUT_SCHEMA_VERSION:
        raise WorkerInputError("schemaVersion is unsupported")
    workspace_fingerprint = _expect_fingerprint(
        payload["workspaceFingerprint"], "workspaceFingerprint"
    )
    raw_lessons = payload["lessons"]
    if not isinstance(raw_lessons, list) or not 1 <= len(raw_lessons) <= MAX_LESSONS:
        raise WorkerInputError("lessons must be a non-empty bounded array")

    lessons: list[dict[str, Any]] = []
    seen_lesson_ids: set[str] = set()
    for index, raw_lesson in enumerate(raw_lessons):
        context = f"lessons[{index}]"
        lesson = _expect_object(raw_lesson, context)
        _expect_exact_keys(
            lesson,
            {
                "lessonId",
                "authorityVersion",
                "roleFingerprint",
                "queryFingerprint",
                "sourcePlatform",
                "strategy",
                "outcome",
                "promotionStatus",
                "evidence",
            },
            context,
        )
        lesson_id = lesson["lessonId"]
        if not isinstance(lesson_id, str) or not _LESSON_ID_RE.fullmatch(lesson_id):
            raise WorkerInputError(f"{context}.lessonId must be a canonical UUID")
        if lesson_id in seen_lesson_ids:
            raise WorkerInputError("lessonId values must be unique")
        seen_lesson_ids.add(lesson_id)

        evidence = _expect_object(lesson["evidence"], f"{context}.evidence")
        _expect_exact_keys(
            evidence,
            {
                "independentRuns",
                "independentReviewerCount",
                "resultCount",
                "reviewedCount",
                "positiveCount",
                "negativeCount",
            },
            f"{context}.evidence",
        )
        independent_runs = _expect_count(
            evidence["independentRuns"],
            f"{context}.evidence.independentRuns",
            minimum=2,
        )
        independent_reviewer_count = _expect_count(
            evidence["independentReviewerCount"],
            f"{context}.evidence.independentReviewerCount",
            minimum=1,
        )
        result_count = _expect_count(
            evidence["resultCount"], f"{context}.evidence.resultCount"
        )
        reviewed_count = _expect_count(
            evidence["reviewedCount"], f"{context}.evidence.reviewedCount"
        )
        positive_count = _expect_count(
            evidence["positiveCount"], f"{context}.evidence.positiveCount"
        )
        negative_count = _expect_count(
            evidence["negativeCount"], f"{context}.evidence.negativeCount"
        )
        if positive_count + negative_count > reviewed_count:
            raise WorkerInputError("outcome counts cannot exceed reviewedCount")

        lessons.append(
            {
                "lessonId": lesson_id,
                "authorityVersion": _expect_count(
                    lesson["authorityVersion"], f"{context}.authorityVersion", minimum=1
                ),
                "roleFingerprint": _expect_fingerprint(
                    lesson["roleFingerprint"], f"{context}.roleFingerprint"
                ),
                "queryFingerprint": _expect_fingerprint(
                    lesson["queryFingerprint"], f"{context}.queryFingerprint"
                ),
                "sourcePlatform": _expect_enum(
                    lesson["sourcePlatform"], _SOURCE_PLATFORMS, f"{context}.sourcePlatform"
                ),
                "strategy": _expect_enum(
                    lesson["strategy"], _STRATEGIES, f"{context}.strategy"
                ),
                "outcome": _expect_enum(
                    lesson["outcome"], _OUTCOMES, f"{context}.outcome"
                ),
                "promotionStatus": _expect_enum(
                    lesson["promotionStatus"],
                    _PROMOTION_STATUSES,
                    f"{context}.promotionStatus",
                ),
                "evidence": {
                    "independentRuns": independent_runs,
                    "independentReviewerCount": independent_reviewer_count,
                    "resultCount": result_count,
                    "reviewedCount": reviewed_count,
                    "positiveCount": positive_count,
                    "negativeCount": negative_count,
                },
            }
        )

    lessons.sort(
        key=lambda item: (
            item["roleFingerprint"],
            item["queryFingerprint"],
            item["lessonId"],
        )
    )
    return {
        "schemaVersion": INPUT_SCHEMA_VERSION,
        "workspaceFingerprint": workspace_fingerprint,
        "lessons": lessons,
    }


def _node(node_id: str, label: str, **attributes: Any) -> dict[str, Any]:
    return {
        "id": node_id,
        "label": label,
        "file_type": "concept",
        "source_file": SOURCE_FILE,
        **attributes,
    }


def _edge(source: str, target: str, relation: str) -> dict[str, Any]:
    return {
        "source": source,
        "target": target,
        "relation": relation,
        "confidence": "EXTRACTED",
        "confidence_score": 1.0,
        "source_file": SOURCE_FILE,
        "weight": 1.0,
    }


def _build_extraction(payload: dict[str, Any]) -> dict[str, Any]:
    nodes: dict[str, dict[str, Any]] = {}
    edges: dict[tuple[str, str, str], dict[str, Any]] = {}

    def add_node(node: dict[str, Any]) -> None:
        nodes.setdefault(node["id"], node)

    def add_edge(edge: dict[str, Any]) -> None:
        key = (edge["source"], edge["target"], edge["relation"])
        edges.setdefault(key, edge)

    workspace_fingerprint = payload["workspaceFingerprint"]
    workspace_id = f"workspace_{workspace_fingerprint}"
    add_node(
        _node(
            workspace_id,
            f"Workspace {workspace_fingerprint[:12]}",
            entity_kind="workspace_fingerprint",
        )
    )

    for lesson in payload["lessons"]:
        lesson_key = lesson["lessonId"].replace("-", "")
        lesson_id = f"lesson_{lesson_key}"
        role_id = f"role_{lesson['roleFingerprint']}"
        query_id = f"query_{lesson['queryFingerprint']}"
        platform_id = f"platform_{lesson['sourcePlatform']}"
        strategy_id = f"strategy_{lesson['strategy']}"
        outcome_id = f"outcome_{lesson['outcome']}"
        status_id = f"promotion_{lesson['promotionStatus']}"
        evidence = lesson["evidence"]

        add_node(
            _node(
                role_id,
                f"Role {lesson['roleFingerprint'][:12]}",
                entity_kind="role_fingerprint",
            )
        )
        add_node(
            _node(
                query_id,
                f"Query {lesson['queryFingerprint'][:12]}",
                entity_kind="query_fingerprint",
            )
        )
        add_node(
            _node(
                platform_id,
                f"Source platform: {lesson['sourcePlatform']}",
                entity_kind="source_platform",
            )
        )
        add_node(
            _node(
                strategy_id,
                f"Strategy: {lesson['strategy']}",
                entity_kind="strategy",
            )
        )
        add_node(
            _node(
                outcome_id,
                f"Outcome: {lesson['outcome']}",
                entity_kind="outcome",
            )
        )
        add_node(
            _node(
                status_id,
                f"Promotion: {lesson['promotionStatus']}",
                entity_kind="promotion_status",
            )
        )
        add_node(
            _node(
                lesson_id,
                f"Lesson {lesson['lessonId'][:8]}",
                entity_kind="sourcing_lesson",
                authority_version=lesson["authorityVersion"],
                independent_runs=evidence["independentRuns"],
                independent_reviewer_count=evidence["independentReviewerCount"],
                result_count=evidence["resultCount"],
                reviewed_count=evidence["reviewedCount"],
                positive_count=evidence["positiveCount"],
                negative_count=evidence["negativeCount"],
            )
        )

        add_edge(_edge(workspace_id, role_id, "contains_role"))
        add_edge(_edge(role_id, lesson_id, "has_reviewed_lesson"))
        add_edge(_edge(lesson_id, query_id, "references_query_fingerprint"))
        add_edge(_edge(lesson_id, platform_id, "uses_source_platform"))
        add_edge(_edge(lesson_id, strategy_id, "uses_strategy"))
        add_edge(_edge(lesson_id, outcome_id, "has_outcome"))
        add_edge(_edge(lesson_id, status_id, "has_promotion_status"))

    return {
        "nodes": [nodes[node_id] for node_id in sorted(nodes)],
        "edges": [edges[key] for key in sorted(edges)],
        "hyperedges": [],
        "input_tokens": 0,
        "output_tokens": 0,
    }


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _write_json_atomic(path: Path, value: Any) -> None:
    fd, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary_path, 0o640)
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)


def _compile_lessons_locked(input_path: Path, output_directory: Path) -> dict[str, Any]:
    """Validate one redacted export and write one graph/manifest pair."""

    payload = _validate_payload(_read_json(input_path))
    if output_directory.is_symlink():
        raise WorkerInputError("output directory must not be a symbolic link")
    output_directory.mkdir(parents=True, exist_ok=True, mode=0o750)
    if not output_directory.is_dir():
        raise WorkerInputError("output path must be a directory")

    graph_path = output_directory / "graph.json"
    manifest_path = output_directory / "manifest.json"
    if graph_path.is_symlink() or manifest_path.is_symlink():
        raise WorkerInputError("output files must not be symbolic links")

    extraction = _build_extraction(payload)
    graph = build_from_json(extraction, directed=True)
    communities = cluster(graph)
    cohesion = score_all(graph, communities)
    if graph.number_of_nodes() == 0:
        raise RuntimeError("Graphify produced an empty graph")

    fd, temporary_name = tempfile.mkstemp(
        prefix=".graph.json.", dir=output_directory
    )
    os.close(fd)
    temporary_graph = Path(temporary_name)
    try:
        wrote = to_json(
            graph,
            communities,
            str(temporary_graph),
            force=True,
            built_at_commit=GRAPHIFY_COMMIT,
        )
        if wrote is not True:
            raise RuntimeError("Graphify declined to write the graph")
        os.chmod(temporary_graph, 0o640)
        os.replace(temporary_graph, graph_path)
    finally:
        temporary_graph.unlink(missing_ok=True)

    graph_bytes = graph_path.read_bytes()
    community_by_node = {
        node_id: community_id
        for community_id, node_ids in communities.items()
        for node_id in node_ids
    }
    attachments = []
    for lesson in payload["lessons"]:
        lesson_node_id = f"lesson_{lesson['lessonId'].replace('-', '')}"
        community_id = community_by_node.get(lesson_node_id)
        if community_id is None:
            raise RuntimeError("Graphify did not assign a lesson community")
        attachments.append(
            {
                "lessonId": lesson["lessonId"],
                "expectedVersion": lesson["authorityVersion"],
                "clusterRef": f"community:{community_id}",
            }
        )
    manifest = {
        "status": "ok",
        "schemaVersion": 1,
        "inputSchemaVersion": INPUT_SCHEMA_VERSION,
        "workspaceFingerprint": payload["workspaceFingerprint"],
        "inputSha256": _sha256(_canonical_bytes(payload)),
        "graphSha256": _sha256(graph_bytes),
        "lessonCount": len(payload["lessons"]),
        "nodeCount": graph.number_of_nodes(),
        "edgeCount": graph.number_of_edges(),
        "communityCount": len(communities),
        "cohesion": {str(key): cohesion[key] for key in sorted(cohesion)},
        "attachments": attachments,
        "graphify": {
            "repository": GRAPHIFY_REPOSITORY,
            "commit": GRAPHIFY_COMMIT,
            "semanticLlmUsed": False,
            "queryLoggingDisabled": True,
        },
    }
    _write_json_atomic(manifest_path, manifest)
    return manifest


def compile_lessons(input_path: Path, output_directory: Path) -> dict[str, Any]:
    """Compile one export while holding exclusive ownership of the output."""

    # Reject malformed or privacy-unsafe input before creating any output path.
    _validate_payload(_read_json(input_path))
    if output_directory.is_symlink():
        raise WorkerInputError("output directory must not be a symbolic link")
    output_directory.mkdir(parents=True, exist_ok=True, mode=0o750)
    lock_path = output_directory / ".graphify-lessons.lock"
    try:
        lock_fd = os.open(
            lock_path,
            os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0),
            0o600,
        )
    except FileExistsError as exc:
        raise WorkerInputError("output directory is already in use") from exc
    try:
        os.write(lock_fd, f"{os.getpid()}\n".encode("ascii"))
        os.fsync(lock_fd)
        return _compile_lessons_locked(input_path, output_directory)
    finally:
        os.close(lock_fd)
        lock_path.unlink(missing_ok=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Compile redacted sourcing lesson aggregates with Graphify"
    )
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args(argv)

    try:
        manifest = compile_lessons(args.input, args.output)
    except WorkerInputError as exc:
        print(f"graphify-lessons: invalid input: {exc}", file=sys.stderr)
        return 2
    except Exception:
        print("graphify-lessons: processing failed", file=sys.stderr)
        return 1

    print(
        json.dumps(
            {
                "status": "ok",
                "lessonCount": manifest["lessonCount"],
                "nodeCount": manifest["nodeCount"],
                "edgeCount": manifest["edgeCount"],
                "graphSha256": manifest["graphSha256"],
            },
            separators=(",", ":"),
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
