#!/usr/bin/env python3
"""Write summary.json for one integration sweep. No network."""
import hashlib
import json
import sys
from pathlib import Path


def journey_note(root: Path, pw_exit: int, steps: list) -> str:
    if steps:
        return ""
    matrix = root / "journey-matrix.json"
    if matrix.is_file():
        lead = (
            "The journey file exists and lists zero finished steps. "
            "Playwright exit was %s." % pw_exit
        )
    else:
        lead = (
            "Playwright exit was %s and journey-matrix.json was not written, "
            "so the test did not record a journey." % pw_exit
        )
    log = root / "logs" / "playwright.log"
    if log.is_file():
        lines = [
            line.strip()
            for line in log.read_text(errors="replace").splitlines()
            if line.strip()
        ]
        detail = ""
        if lines:
            detail = " Last playwright log lines: " + " | ".join(lines[-8:])[:700]
    else:
        detail = " playwright.log is missing."
    return (
        lead
        + " An empty journey list is a harness record, not a product pass."
        + detail
    )


def write_summary(art: str, sha: str, compose_exit: str, pw_exit: str) -> None:
    root = Path(art)
    files = sorted(
        p
        for p in root.rglob("*")
        if p.is_file() and p.name not in ("summary.json", "SHA256SUMS")
    )
    lines = []
    for path in files:
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        lines.append("%s  %s" % (digest, path.relative_to(root)))
    (root / "SHA256SUMS").write_text("\n".join(lines) + ("\n" if lines else ""))
    matrix = []
    matrix_path = root / "journey-matrix.json"
    if matrix_path.exists():
        matrix = json.loads(matrix_path.read_text()).get("steps", [])
    cases = []
    cases_path = root / "stress" / "cases.json"
    if cases_path.exists():
        cases = json.loads(cases_path.read_text())
    summary = {
        "head": sha,
        "composeExit": int(compose_exit),
        "playwrightExit": int(pw_exit),
        "journeys": matrix,
        "stress": cases,
    }
    note = journey_note(root, int(pw_exit), matrix)
    if note:
        summary["journeysNote"] = note
    (root / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(art)


if __name__ == "__main__":
    write_summary(*sys.argv[1:5])
