# Vendored Graphify artifact

`graphifyy-0.9.14-py3-none-any.whl` is the bounded, pure-Python project artifact
used by the offline lesson worker.

- Upstream: `https://github.com/Graphify-Labs/graphify.git`
- Audited commit: `94d3099540550d58dd121ec3e67cf93e80364079`
- Upstream tag at that commit: `v0.9.14`
- License: MIT; the wheel contains `graphifyy-0.9.14.dist-info/licenses/LICENSE`
- Wheel SHA-256: `8c9410e3ac190f7f35863f5ef4d6cb89f3cce560f34719cbfebd29a06cf79f9c`
- Build command: `uv build --offline --wheel --out-dir <output> <clean-upstream-checkout>`

The Docker build installs this wheel with both `--no-deps` and
`--require-hashes`. Every runtime dependency remains independently pinned and
hashed in `../requirements.lock`. Updating Graphify requires a new upstream
audit, a clean exact-commit build, a new hash, container tests, vulnerability
scan, SBOM, provenance attestation, and human release approval.
