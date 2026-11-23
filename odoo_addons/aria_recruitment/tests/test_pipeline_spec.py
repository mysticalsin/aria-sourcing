from odoo.exceptions import ValidationError
from odoo.tests import tagged

from odoo.addons.aria_recruitment.models.pipeline_spec import load_pipeline_spec, spec_path
from odoo.addons.aria_recruitment.models.state_machine import (
    DISPLAY_NAMES,
    DNA_PASSING_STATUSES,
    EDGES,
    GUARDS,
    HIRED_KEY,
    STAGE_ORDER,
    TERMINAL_KEYS,
    decide_stage,
    evaluate_guard,
)

from .common import STAGE_KEYS, AriaRecruitmentCommon

EXPECTED_NAMES = {
    'to_rate': 'To Rate',
    'to_assess': 'To Assess',
    'to_interview': 'To Interview',
    'shoot': 'Shoot',
    'qm': 'QM',
    'to_hire': 'To Hire',
    'hired': 'Hired',
    'rejected': 'Rejected',
    'withdrawn': 'Withdrawn',
}

EXPECTED_EDGES = {
    'to_rate': frozenset({'to_assess', 'rejected', 'withdrawn'}),
    'to_assess': frozenset({'to_rate', 'to_interview', 'rejected', 'withdrawn'}),
    'to_interview': frozenset({'to_assess', 'shoot', 'rejected', 'withdrawn'}),
    'shoot': frozenset({'to_interview', 'qm', 'rejected', 'withdrawn'}),
    'qm': frozenset({'shoot', 'to_hire', 'rejected', 'withdrawn'}),
    'to_hire': frozenset({'qm', 'hired', 'rejected', 'withdrawn'}),
    'hired': frozenset(),
    'rejected': frozenset(),
    'withdrawn': frozenset(),
}


@tagged('post_install', '-at_install', 'aria_recruitment')
class TestPipelineSpec(AriaRecruitmentCommon):
    def test_addon_matches_pipeline_spec(self):
        path = spec_path()
        self.assertEqual(path.name, 'pipeline_stages.json')
        self.assertEqual(path.parent.name, 'spec')
        self.assertEqual(path.parent.parent.name, 'aria_recruitment')

        spec = load_pipeline_spec()
        self.assertEqual(spec['spec_version'], 1)
        self.assertEqual([stage['key'] for stage in spec['stages']], list(STAGE_KEYS))
        self.assertEqual(STAGE_ORDER, STAGE_KEYS)
        self.assertEqual(DISPLAY_NAMES, EXPECTED_NAMES)
        self.assertEqual(EDGES, EXPECTED_EDGES)
        self.assertEqual(GUARDS, {('to_hire', 'hired'): 'contract_attached && dna_integrated'})
        self.assertEqual(DNA_PASSING_STATUSES, frozenset({'integrated', 'complete'}))
        self.assertEqual(TERMINAL_KEYS, frozenset({'hired', 'rejected', 'withdrawn'}))
        self.assertEqual(HIRED_KEY, 'hired')

        for row in spec['stages']:
            self.assertEqual(row['name'], EXPECTED_NAMES[row['key']])
            stage = self.env.ref(f"aria_recruitment.stage_{row['key']}")
            self.assertEqual(stage.aria_stage_key, row['key'])
            self.assertEqual(stage.name, row['name'])
            self.assertEqual(stage.sequence, row['sequence'])
            self.assertEqual(stage.sequence, row['order'] * 10)
            self.assertEqual(bool(stage.hired_stage), row['hired'])
            self.assertEqual(bool(stage.aria_terminal), row['terminal'])
            self.assertEqual(bool(stage.fold), row['terminal'])

        hired_edges = [
            (stage['key'], edge)
            for stage in spec['stages']
            for edge in stage['transitions']
            if edge['to'] == 'hired'
        ]
        self.assertEqual(len(hired_edges), 1)
        self.assertEqual(hired_edges[0][0], 'to_hire')
        self.assertEqual(hired_edges[0][1]['guard'], 'contract_attached && dna_integrated')

        before_ids = {
            key: self.stage[key].id
            for key in STAGE_KEYS
        }
        self.env['hr.recruitment.stage']._aria_sync_stages_from_spec()
        self.assertEqual(
            self.env['hr.recruitment.stage'].search_count([('aria_stage_key', '!=', False)]),
            9,
        )
        for key, stage_id in before_ids.items():
            self.assertEqual(self.env.ref(f'aria_recruitment.stage_{key}').id, stage_id)
        self.assertEqual(
            self.env['ir.config_parameter'].get_param('aria_recruitment.pipeline_spec_version'),
            '1',
        )

    def test_state_machine_guards_match_spec(self):
        allowed, _reason = evaluate_guard(
            'contract_attached && dna_integrated',
            contract_attached=True,
            dna_status='integrated',
        )
        self.assertTrue(allowed)
        allowed, _reason = evaluate_guard(
            'contract_attached && dna_integrated',
            contract_attached=True,
            dna_status='complete',
        )
        self.assertTrue(allowed)
        allowed, reason = evaluate_guard(
            'contract_attached && dna_integrated',
            contract_attached=False,
            dna_status='pending',
        )
        self.assertFalse(allowed)
        self.assertIn('contract', reason)
        self.assertIn('DNA', reason)
        allowed, reason = evaluate_guard(
            'true',
            contract_attached=True,
            dna_status='complete',
        )
        self.assertFalse(allowed)
        self.assertIn('unknown guard', reason)

        refused = decide_stage(
            from_key='to_rate',
            to_key='hired',
            contract_attached=True,
            dna_status='complete',
        )
        self.assertFalse(refused.allowed)
        self.assertIn('not allowed', refused.reason)

        hired = decide_stage(
            from_key='to_hire',
            to_key='hired',
            contract_attached=True,
            dna_status='integrated',
        )
        self.assertTrue(hired.allowed)
        blocked = decide_stage(
            from_key='hired',
            to_key='to_rate',
            contract_attached=True,
            dna_status='complete',
        )
        self.assertFalse(blocked.allowed)

        applicant = self.applicant('to_rate')
        error = self.move(applicant, 'hired')
        self.assertTrue(error)
        self.assertIn('not allowed', str(error))
        self.assertEqual(applicant.stage_id.aria_stage_key, 'to_rate')
