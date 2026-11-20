"""Explicit recruitment state machine, built only from the shared spec."""

from __future__ import annotations

from .pipeline_spec import HIRE_GUARD, load_pipeline_spec

SPEC = load_pipeline_spec()
STAGE_ORDER = tuple(stage['key'] for stage in SPEC['stages'])
DISPLAY_NAMES = {stage['key']: stage['name'] for stage in SPEC['stages']}
EDGES = {
    stage['key']: frozenset(edge['to'] for edge in stage['transitions'])
    for stage in SPEC['stages']
}
GUARDS = {
    (stage['key'], edge['to']): edge['guard']
    for stage in SPEC['stages']
    for edge in stage['transitions']
    if edge.get('guard')
}
DNA_PASSING_STATUSES = frozenset(
    SPEC['guard_definitions'][HIRE_GUARD]['dna_passing_statuses']
)
TERMINAL_KEYS = frozenset(stage['key'] for stage in SPEC['stages'] if stage['terminal'])
HIRED_KEY = 'hired'


class TransitionDecision:
    """One allowed or refused attempt to change stage."""

    def __init__(self, allowed, reason, from_key, to_key, *, noop=False, initial=False):
        self.allowed = bool(allowed)
        self.result = 'allowed' if self.allowed else 'refused'
        self.reason = reason
        self.from_key = from_key or ''
        self.to_key = to_key or ''
        self.noop = bool(noop)
        self.initial = bool(initial)

    def __repr__(self):
        return f'TransitionDecision({self.result}, {self.from_key!r} -> {self.to_key!r}, {self.reason!r})'


def evaluate_guard(guard, *, contract_attached, dna_status):
    """Return (holds, reason). Unknown guards fail closed and are not executed."""
    if guard != HIRE_GUARD:
        return False, 'hire refused: unknown guard'
    problems = []
    if not contract_attached:
        problems.append('contract document is not attached')
    status = (dna_status or '').strip()
    if status not in DNA_PASSING_STATUSES:
        problems.append('DNA integration is not integrated/complete')
    if problems:
        return False, 'hire refused: ' + '; '.join(problems)
    return True, ''


def decide_stage(
    *,
    from_key,
    to_key,
    contract_attached,
    dna_status,
    same_stage=False,
    clearing=False,
    target_tampered=False,
):
    """Decide a transition.

    ``from_key`` is empty when the applicant is not yet on a spec stage.
    Entering Hired is never an initial placement: the only edge is
    ``to_hire -> hired`` and it carries the legal guard.
    """
    from_key = from_key or ''
    to_key = to_key or ''
    if clearing:
        return TransitionDecision(False, 'clearing the stage is not allowed', from_key, to_key)
    if target_tampered:
        return TransitionDecision(
            False,
            'hire refused: hired flag is only valid on the hired stage',
            from_key,
            to_key,
        )
    if same_stage:
        return TransitionDecision(True, 'stage unchanged', from_key, to_key, noop=True)
    if not from_key:
        if to_key == HIRED_KEY:
            return TransitionDecision(False, 'transition -> hired is not allowed', from_key, to_key)
        if to_key not in EDGES:
            return TransitionDecision(
                False,
                f'transition -> {to_key or "unknown"} is not allowed',
                from_key,
                to_key,
            )
        return TransitionDecision(True, 'initial placement', from_key, to_key, initial=True)
    if from_key not in EDGES or to_key not in EDGES[from_key]:
        return TransitionDecision(
            False,
            f'transition {from_key} -> {to_key or "unknown"} is not allowed',
            from_key,
            to_key,
        )
    guard = GUARDS.get((from_key, to_key))
    if guard:
        holds, reason = evaluate_guard(
            guard,
            contract_attached=contract_attached,
            dna_status=dna_status,
        )
        if not holds:
            return TransitionDecision(False, reason, from_key, to_key)
    return TransitionDecision(True, 'transition allowed', from_key, to_key)
