"""ARIA's guarded ASGI entrypoint for the pinned DeerFlow gateway."""

from aria_runtime_policy import RuntimePolicyApp, enforce_runtime_environment


enforce_runtime_environment()

from app.gateway.app import app as deerflow_app  # noqa: E402
from app.gateway.routers import runs
from aria_cleanup_guard import install_cleanup_deadline


install_cleanup_deadline(runs)
app = RuntimePolicyApp(deerflow_app)
