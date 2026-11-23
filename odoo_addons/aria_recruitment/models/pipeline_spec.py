"""Load and validate the shared pipeline spec.

The JSON file in ``spec/pipeline_stages.json`` is the source of truth for
stage keys, names, order, transitions, guards, and terminal flags. Odoo
stage rows are generated from it. Later Rust and Go layers load this same
file.
"""

from __future__ import annotations

import json
from pathlib import Path

SPEC_VERSION = 1
HIRE_GUARD = 'contract_attached && dna_integrated'
TOP_LEVEL_KEYS = frozenset({'spec_version', 'guard_definitions', 'stages'})
STAGE_KEYS = frozenset({'key', 'name', 'order', 'sequence', 'terminal', 'hired', 'transitions'})
TRANSITION_KEYS = frozenset({'to', 'guard'})


def spec_path() -> Path:
    return Path(__file__).resolve().parent.parent / 'spec' / 'pipeline_stages.json'


def load_pipeline_spec(path: Path | None = None) -> dict:
    source = Path(path) if path else spec_path()
    with source.open(encoding='utf-8') as handle:
        data = json.load(handle)
    validate_pipeline_spec(data)
    return data


def validate_pipeline_spec(data: dict) -> dict:
    if not isinstance(data, dict):
        raise ValueError('pipeline spec must be an object')
    extra = set(data) - TOP_LEVEL_KEYS
    missing = TOP_LEVEL_KEYS - set(data)
    if extra or missing:
        raise ValueError(f'pipeline spec keys mismatch: missing={sorted(missing)} extra={sorted(extra)}')
    if data['spec_version'] != SPEC_VERSION:
        raise ValueError(f'pipeline spec_version must be {SPEC_VERSION}')

    definition = data['guard_definitions'].get(HIRE_GUARD)
    if not isinstance(definition, dict):
        raise ValueError(f'missing guard definition for {HIRE_GUARD!r}')
    if definition.get('expression') != HIRE_GUARD:
        raise ValueError('hire guard expression does not match its name')
    if definition.get('all') != ['contract_attached', 'dna_integrated']:
        raise ValueError('hire guard must require contract_attached and dna_integrated')
    if definition.get('dna_passing_statuses') != ['integrated', 'complete']:
        raise ValueError('dna_integrated accepts only integrated and complete')

    stages = data['stages']
    if not isinstance(stages, list) or not stages:
        raise ValueError('stages must be a non-empty list')

    seen_keys: set[str] = set()
    hired_edges = 0
    for index, stage in enumerate(stages, start=1):
        if not isinstance(stage, dict):
            raise ValueError('each stage must be an object')
        stage_extra = set(stage) - STAGE_KEYS
        stage_missing = STAGE_KEYS - set(stage)
        if stage_extra or stage_missing:
            raise ValueError(
                f"stage {stage.get('key')!r} fields mismatch: "
                f"missing={sorted(stage_missing)} extra={sorted(stage_extra)}"
            )
        key = stage['key']
        if not isinstance(key, str) or not key or key in seen_keys:
            raise ValueError(f'duplicate or empty stage key {key!r}')
        seen_keys.add(key)
        if stage['order'] != index or stage['sequence'] != index * 10:
            raise ValueError(f'{key} order/sequence must follow the file order')
        if not isinstance(stage['terminal'], bool) or not isinstance(stage['hired'], bool):
            raise ValueError(f'{key} terminal and hired must be booleans')
        if stage['hired'] and key != 'hired':
            raise ValueError('only the hired stage may set hired=true')
        if key == 'hired' and not (stage['hired'] and stage['terminal']):
            raise ValueError('the hired stage must be terminal and hired')
        if stage['terminal'] and stage['transitions']:
            raise ValueError(f'terminal stage {key} cannot declare transitions')
        if not isinstance(stage['name'], str) or not stage['name'].strip():
            raise ValueError(f'{key} needs a display name')

        outgoing: set[str] = set()
        for edge in stage['transitions']:
            if not isinstance(edge, dict):
                raise ValueError(f'{key} has a transition that is not an object')
            edge_extra = set(edge) - TRANSITION_KEYS
            if edge_extra or 'to' not in edge:
                raise ValueError(f'{key} transition fields are invalid')
            target = edge['to']
            if target in outgoing:
                raise ValueError(f'{key} declares {target} more than once')
            outgoing.add(target)
            guard = edge.get('guard')
            if target == 'hired':
                if key != 'to_hire' or guard != HIRE_GUARD:
                    raise ValueError('only to_hire may enter hired, and only behind the legal guard')
                hired_edges += 1
            elif guard:
                raise ValueError(f'unexpected guard on {key} -> {target}')

    unknown_targets = [
        edge['to']
        for stage in stages
        for edge in stage['transitions']
        if edge['to'] not in seen_keys
    ]
    if unknown_targets:
        raise ValueError(f'transitions point at unknown stages: {unknown_targets}')
    if hired_edges != 1:
        raise ValueError('the spec must declare exactly one transition into hired')
    return data
