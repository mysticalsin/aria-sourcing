from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import os
import socket
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


WORKER_DIRECTORY = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "graphify_lessons_worker", WORKER_DIRECTORY / "worker.py"
)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("could not load worker module")
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)


def valid_payload() -> dict:
    return {
        "schemaVersion": 1,
        "workspaceFingerprint": "a" * 64,
        "lessons": [
            {
                "lessonId": "018f47d2-9d32-7a54-8f21-4aa937c604e9",
                "authorityVersion": 1,
                "roleFingerprint": "b" * 64,
                "queryFingerprint": "c" * 64,
                "sourcePlatform": "github",
                "strategy": "language",
                "outcome": "useful",
                "promotionStatus": "promoted",
                "evidence": {
                    "independentRuns": 3,
                    "independentReviewerCount": 2,
                    "resultCount": 15,
                    "reviewedCount": 8,
                    "positiveCount": 6,
                    "negativeCount": 2,
                },
            }
        ],
    }


class GraphifyLessonsWorkerTests(unittest.TestCase):
    def write_input(self, root: Path, payload: dict) -> Path:
        input_path = root / "input.json"
        input_path.write_text(json.dumps(payload), encoding="utf-8")
        return input_path

    def test_compiles_redacted_graph_and_manifest_without_network(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output = root / "output"
            input_path = self.write_input(root, valid_payload())

            with patch.object(
                socket, "create_connection", side_effect=AssertionError("network access")
            ):
                manifest = worker.compile_lessons(input_path, output)

            graph_path = output / "graph.json"
            manifest_path = output / "manifest.json"
            graph = json.loads(graph_path.read_text(encoding="utf-8"))
            saved_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

            self.assertEqual(manifest, saved_manifest)
            self.assertEqual(
                saved_manifest["graphify"]["commit"], worker.GRAPHIFY_COMMIT
            )
            self.assertFalse(saved_manifest["graphify"]["semanticLlmUsed"])
            self.assertTrue(saved_manifest["graphify"]["queryLoggingDisabled"])
            self.assertEqual(graph["built_at_commit"], worker.GRAPHIFY_COMMIT)
            self.assertTrue(graph["directed"])
            self.assertGreater(saved_manifest["nodeCount"], 0)
            self.assertGreater(saved_manifest["edgeCount"], 0)
            self.assertEqual(
                saved_manifest["graphSha256"],
                hashlib.sha256(graph_path.read_bytes()).hexdigest(),
            )
            self.assertEqual(
                saved_manifest["attachments"],
                [{
                    "lessonId": valid_payload()["lessons"][0]["lessonId"],
                    "expectedVersion": 1,
                    "clusterRef": "community:0",
                }],
            )
            self.assertEqual(os.environ["GRAPHIFY_QUERY_LOG_DISABLE"], "1")
            self.assertNotIn("GRAPHIFY_QUERY_LOG_ENABLE", os.environ)
            self.assertNotIn("GRAPHIFY_QUERY_LOG_RESPONSES", os.environ)

    def test_output_is_deterministic_for_equivalent_input(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            payload = valid_payload()
            first_input = self.write_input(root, payload)
            first_output = root / "first"
            second_output = root / "second"

            worker.compile_lessons(first_input, first_output)
            first_input.write_text(
                json.dumps(payload, indent=4, sort_keys=True), encoding="utf-8"
            )
            worker.compile_lessons(first_input, second_output)

            self.assertEqual(
                (first_output / "graph.json").read_bytes(),
                (second_output / "graph.json").read_bytes(),
            )
            self.assertEqual(
                (first_output / "manifest.json").read_bytes(),
                (second_output / "manifest.json").read_bytes(),
            )

    def test_rejects_candidate_pii_and_free_text_fields_before_output(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            payload = valid_payload()
            payload["lessons"][0]["candidateName"] = "Ada Example"
            output = root / "output"

            with self.assertRaisesRegex(worker.WorkerInputError, "invalid field set"):
                worker.compile_lessons(self.write_input(root, payload), output)
            self.assertFalse(output.exists())

    def test_rejects_non_opaque_identifiers(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            payload = valid_payload()
            payload["lessons"][0]["queryFingerprint"] = "ada@example.com"

            with self.assertRaisesRegex(worker.WorkerInputError, "lowercase"):
                worker.compile_lessons(
                    self.write_input(root, payload), root / "output"
                )

    def test_accepts_every_fixed_source_platform_and_draft_review_state(self) -> None:
        payload = valid_payload()
        payload["lessons"][0]["promotionStatus"] = "draft"
        for platform in sorted(worker._SOURCE_PLATFORMS):
            with self.subTest(platform=platform), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                candidate = copy.deepcopy(payload)
                candidate["lessons"][0]["sourcePlatform"] = platform
                manifest = worker.compile_lessons(
                    self.write_input(root, candidate), root / "output"
                )
                self.assertEqual(manifest["lessonCount"], 1)

    def test_rejects_uncorroborated_and_inconsistent_evidence(self) -> None:
        cases = []
        uncorroborated = valid_payload()
        uncorroborated["lessons"][0]["evidence"]["independentRuns"] = 1
        cases.append(uncorroborated)
        inconsistent = valid_payload()
        inconsistent["lessons"][0]["evidence"]["positiveCount"] = 9
        cases.append(inconsistent)

        for payload in cases:
            with self.subTest(payload=payload):
                with tempfile.TemporaryDirectory() as temporary:
                    root = Path(temporary)
                    with self.assertRaises(worker.WorkerInputError):
                        worker.compile_lessons(
                            self.write_input(root, payload), root / "output"
                        )

    def test_accepts_reviewed_zero_result_dead_ends(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            payload = valid_payload()
            evidence = payload["lessons"][0]["evidence"]
            evidence.update({
                "resultCount": 0,
                "reviewedCount": 2,
                "positiveCount": 0,
                "negativeCount": 2,
            })
            payload["lessons"][0]["outcome"] = "dead_end"

            manifest = worker.compile_lessons(
                self.write_input(root, payload), root / "output"
            )
            self.assertEqual(manifest["lessonCount"], 1)

    def test_rejects_duplicate_lessons_and_symlink_input(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            payload = valid_payload()
            payload["lessons"].append(copy.deepcopy(payload["lessons"][0]))
            with self.assertRaisesRegex(worker.WorkerInputError, "unique"):
                worker.compile_lessons(
                    self.write_input(root, payload), root / "output"
                )

            target = self.write_input(root, valid_payload())
            link = root / "linked-input.json"
            link.symlink_to(target)
            with self.assertRaisesRegex(worker.WorkerInputError, "symbolic link"):
                worker.compile_lessons(link, root / "linked-output")

    def test_refuses_a_shared_output_while_another_worker_owns_it(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output = root / "output"
            output.mkdir()
            (output / ".graphify-lessons.lock").write_text("another-worker\n")

            with self.assertRaisesRegex(worker.WorkerInputError, "already in use"):
                worker.compile_lessons(self.write_input(root, valid_payload()), output)
            self.assertFalse((output / "graph.json").exists())

    def test_container_and_dependency_contract_is_bounded(self) -> None:
        requirements = (WORKER_DIRECTORY / "requirements.txt").read_text(
            encoding="utf-8"
        )
        dependency_lock = (WORKER_DIRECTORY / "requirements.lock").read_text(
            encoding="utf-8"
        )
        dockerfile = (WORKER_DIRECTORY / "Dockerfile").read_text(encoding="utf-8")

        self.assertIn(worker.GRAPHIFY_REPOSITORY.removesuffix(".git"), requirements)
        self.assertIn(worker.GRAPHIFY_COMMIT, requirements)
        self.assertIn("networkx==3.6.1", dependency_lock)
        self.assertIn("--hash=sha256:", dependency_lock)
        self.assertNotIn("[", requirements)
        self.assertIn("--require-hashes", dockerfile)
        self.assertIn("--no-deps", dockerfile)
        self.assertIn("pip check", dockerfile)
        self.assertNotIn("apt-get", dockerfile)
        self.assertNotIn("git+", requirements)
        self.assertIn("GRAPHIFY_QUERY_LOG_DISABLE=1", dockerfile)
        self.assertIn("USER 10001:10001", dockerfile)
        self.assertNotIn("EXPOSE", dockerfile)
        self.assertNotIn("graphify.serve", dockerfile)


if __name__ == "__main__":
    unittest.main()
