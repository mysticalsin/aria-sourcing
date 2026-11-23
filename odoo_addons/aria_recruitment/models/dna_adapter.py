"""Pluggable DNA integration check.

DNA is Mantu's ERP. This module ships a fake adapter and a registry.
Nothing here opens a connection, reads a credential, or builds a URL.
"""

from __future__ import annotations


class DnaAdapter:
    """Interface a future in-process adapter can implement."""

    def integration_status(self, applicant) -> str:
        raise NotImplementedError


class FakeDnaAdapter(DnaAdapter):
    """Test and demo double.

    Status comes from the applicant field the demo sets. There is no
    transport behind it.
    """

    def integration_status(self, applicant) -> str:
        return applicant.aria_dna_integration_status or 'pending'


class MissingDnaAdapter(DnaAdapter):
    """Fail closed when the configured name is not registered."""

    def __init__(self, name):
        self.name = name

    def integration_status(self, applicant) -> str:
        return 'missing-adapter'


REGISTRY: dict[str, type] = {}


def register_adapter(name, adapter_cls):
    if not name or name == 'fake':
        raise ValueError('the fake adapter name is reserved')
    REGISTRY[name] = adapter_cls


def unregister_adapter(name):
    REGISTRY.pop(name, None)


def resolve_adapter(name):
    if not name or name == 'fake':
        return FakeDnaAdapter()
    adapter_cls = REGISTRY.get(name)
    if adapter_cls is None:
        return MissingDnaAdapter(name)
    return adapter_cls()
