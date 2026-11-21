import psycopg2

from odoo.exceptions import UserError, ValidationError
from odoo.service.model import call_kw
from odoo.tests import tagged
from odoo.tests.common import new_test_user

from odoo.addons.aria_recruitment.models.dna_adapter import (
    DnaAdapter,
    FakeDnaAdapter,
    register_adapter,
    resolve_adapter,
    unregister_adapter,
)

from .common import AriaRecruitmentCommon


@tagged('post_install', '-at_install', 'aria_recruitment')
class TestHireGate(AriaRecruitmentCommon):
    def test_sql_update_cannot_enter_hired_without_contract_and_dna(self):
        applicant = self.applicant('to_hire', name='Sql Example', email='sql.example@example.test')
        hired_id = self.stage['hired'].id
        with self.assertRaises(psycopg2.Error):
            self.env.cr.execute(
                "UPDATE hr_applicant SET stage_id = %s WHERE id = %s",
                (hired_id, applicant.id),
            )
        self.env.invalidate_all()
        self.assertEqual(applicant.stage_id.aria_stage_key, 'to_hire')

    def test_hire_without_contract_rejected(self):
        applicant = self.applicant('to_hire')
        applicant.aria_dna_integration_status = 'complete'
        self.contract(applicant, kind='cv', name='synthetic-cv.pdf')

        error = self.move(applicant, 'hired')
        self.assertTrue(error)
        self.assertIn('contract', str(error))

        self.assertEqual(applicant.stage_id.aria_stage_key, 'to_hire')
        audit = self.audits(applicant, result='refused', to_stage_key='hired')
        self.assertEqual(len(audit), 1)
        self.assertEqual(audit.user_id, self.env.user)
        self.assertTrue(audit.transitioned_at)
        self.assertEqual(audit.from_stage_key, 'to_hire')
        self.assertIn('contract', audit.reason)
        self.assertTrue(self.notes(applicant))

    def test_hire_with_contract_but_dna_incomplete_rejected(self):
        applicant = self.applicant('to_hire')
        self.contract(applicant)
        applicant.aria_dna_integration_status = 'incomplete'

        error = self.move(applicant, 'hired')
        self.assertTrue(error)
        self.assertIn('DNA', str(error))

        self.assertEqual(applicant.stage_id.aria_stage_key, 'to_hire')
        audit = self.audits(applicant, result='refused', to_stage_key='hired')
        self.assertEqual(len(audit), 1)
        self.assertIn('DNA', audit.reason)
        self.assertNotIn('contract document is not attached', audit.reason)
        note = self.notes(applicant)
        self.assertTrue(note)
        self.assertIn('refused', note[0].body)

    def test_hire_happy_path(self):
        applicant = self.applicant('to_hire')
        self.contract(applicant)
        applicant.aria_dna_integration_status = 'complete'

        applicant.write({'stage_id': self.stage['hired'].id})

        self.assertEqual(applicant.stage_id.aria_stage_key, 'hired')
        self.assertTrue(applicant.stage_id.hired_stage)
        audit = self.audits(applicant, result='allowed', to_stage_key='hired')
        self.assertEqual(len(audit), 1)
        self.assertEqual(audit.from_stage_key, 'to_hire')
        self.assertEqual(audit.user_id, self.env.user)
        self.assertTrue(audit.transitioned_at)
        self.assertEqual(audit.reason, 'transition allowed')
        self.assertIn('result=allowed', self.notes(applicant)[0].body)

    def test_bypass_via_rpc_write_rejected(self):
        applicant = self.applicant('to_hire')
        applicant.aria_dna_integration_status = 'integrated'

        error = None
        try:
            call_kw(
                self.env['hr.applicant'],
                'write',
                [[applicant.id], {'stage_id': self.stage['hired'].id}],
                {},
            )
        except ValidationError as exc:
            error = exc

        self.assertTrue(error)
        self.assertIn('contract', str(error))

        self.assertEqual(applicant.stage_id.aria_stage_key, 'to_hire')
        audit = self.audits(applicant, result='refused', to_stage_key='hired')
        self.assertEqual(len(audit), 1)
        self.assertIn('contract', audit.reason)
        self.assertTrue(self.notes(applicant))

    def test_bypass_via_import_rejected(self):
        applicant = self.applicant('to_hire')
        applicant.aria_dna_integration_status = 'complete'
        self.contract(applicant, kind='cv', name='not-a-contract.pdf')

        result = self.env['hr.applicant'].with_context(import_file=True).load(
            ['.id', 'stage_id/.id'],
            [[str(applicant.id), str(self.stage['hired'].id)]],
        )

        applicant.invalidate_recordset()
        self.assertEqual(applicant.stage_id.aria_stage_key, 'to_hire')
        messages = result.get('messages') or []
        self.assertTrue(any(message.get('type') == 'error' for message in messages))
        blob = ' '.join(message.get('message') or '' for message in messages)
        self.assertTrue('contract' in blob or 'hire' in blob.lower())
        audit = self.audits(applicant, result='refused', to_stage_key='hired')
        self.assertEqual(len(audit), 1)
        self.assertEqual(audit.from_stage_key, 'to_hire')
        self.assertIn('ARIA_TRANSITION', self.notes(applicant)[0].body)

    def test_bypass_via_sudo_or_stage_sequence_edit_rejected(self):
        hired = self.stage['hired']
        to_rate = self.stage['to_rate']
        hired.sudo().write({'sequence': -100, 'fold': False})
        to_rate.sudo().write({'sequence': 500})

        created = self.env['hr.applicant'].sudo().create({
            'partner_name': 'Sam Example',
            'email_from': 'sam.example@example.test',
            'job_id': self.job.id,
        })
        self.assertNotEqual(created.stage_id.aria_stage_key, 'hired')
        self.assertFalse(created.stage_id.hired_stage)
        hijack = self.audits(created, result='refused', to_stage_key='hired')
        self.assertTrue(hijack)
        self.assertIn('sequence', hijack[0].reason)

        applicant = self.applicant('to_hire')
        applicant.aria_dna_integration_status = 'complete'
        user = new_test_user(
            self.env,
            login='riley.example@example.test',
            groups='hr_recruitment.group_hr_recruitment_user',
        )
        error = None
        try:
            applicant.with_user(user).sudo().write({'stage_id': hired.id})
        except ValidationError as exc:
            error = exc
        self.assertTrue(error)

        self.assertEqual(applicant.stage_id.aria_stage_key, 'to_hire')
        audit = self.audits(applicant, result='refused', to_stage_key='hired')
        self.assertEqual(len(audit), 1)
        self.assertTrue(audit.sudo_used)
        self.assertEqual(audit.user_id, user)

        with self.assertRaises(UserError):
            to_rate.sudo().write({'hired_stage': True})
        with self.assertRaises(UserError):
            hired.sudo().write({'hired_stage': False})
        with self.assertRaises(UserError):
            hired.sudo().write({'aria_stage_key': 'to_rate'})

    def test_every_transition_audited(self):
        applicant = self.applicant('to_rate')
        for key in ('to_assess', 'to_interview', 'shoot', 'qm', 'to_hire'):
            applicant.write({'stage_id': self.stage[key].id})
        error = self.move(applicant, 'hired')
        self.assertTrue(error)
        self.assertIn('contract', str(error))
        self.contract(applicant)
        applicant.aria_dna_integration_status = 'integrated'
        applicant.write({'stage_id': self.stage['hired'].id})

        other = self.applicant('to_rate', name='Blake Example')
        error = self.move(other, 'shoot')
        self.assertTrue(error)
        self.assertIn('not allowed', str(error))
        other.write({'stage_id': self.stage['withdrawn'].id})

        audits = self.audits(applicant, event_kind='stage')
        self.assertEqual(
            [(audit.from_stage_key, audit.to_stage_key, audit.result) for audit in audits],
            [
                ('to_rate', 'to_assess', 'allowed'),
                ('to_assess', 'to_interview', 'allowed'),
                ('to_interview', 'shoot', 'allowed'),
                ('shoot', 'qm', 'allowed'),
                ('qm', 'to_hire', 'allowed'),
                ('to_hire', 'hired', 'refused'),
                ('to_hire', 'hired', 'allowed'),
            ],
        )
        for audit in audits:
            self.assertEqual(audit.user_id, self.env.user)
            self.assertTrue(audit.transitioned_at)
            self.assertTrue(audit.from_stage_key)
            self.assertTrue(audit.to_stage_key)
            self.assertTrue(audit.reason)
            matched = self.notes(applicant).filtered(
                lambda message, row=audit: (
                    f'result={row.result}' in (message.body or '')
                    and f'to={row.to_stage_key}' in (message.body or '')
                    and f'from={row.from_stage_key}' in (message.body or '')
                )
            )
            self.assertTrue(matched, audit.reason)

        other_audits = self.audits(other, event_kind='stage')
        self.assertEqual(
            [(audit.from_stage_key, audit.to_stage_key, audit.result) for audit in other_audits],
            [
                ('to_rate', 'shoot', 'refused'),
                ('to_rate', 'withdrawn', 'allowed'),
            ],
        )
        self.assertEqual(len(self.notes(other)), 2)

    def test_smart_cross_keys_and_utm_link(self):
        applicant = self.applicant('to_rate')
        self.assertEqual(applicant.aria_smart_need_id, 'NEED-SYN-1001')
        self.assertTrue(applicant.aria_smart_candidate_id.startswith('CAND-SYN-'))
        self.assertIn('utm_source=aria', applicant.aria_utm_link)
        self.assertIn('example.test', applicant.aria_utm_link)

    def test_dna_adapter_is_fake_pluggable_and_offline(self):
        from pathlib import Path

        import odoo.addons.aria_recruitment.models.dna_adapter as dna_module

        text = Path(dna_module.__file__).read_text(encoding='utf-8')
        for banned in ('requests', 'urllib', 'http.client', 'socket', 'ftplib'):
            self.assertNotIn(banned, text)
        self.assertIsInstance(resolve_adapter('fake'), FakeDnaAdapter)
        self.assertEqual(
            self.env['ir.config_parameter'].get_param('aria_recruitment.dna_adapter'),
            'fake',
        )

        class ScriptedDna(DnaAdapter):
            def integration_status(self, applicant):
                return 'integrated'

        register_adapter('scripted', ScriptedDna)
        try:
            self.env['ir.config_parameter'].sudo().set_param(
                'aria_recruitment.dna_adapter',
                'scripted',
            )
            applicant = self.applicant('to_hire')
            applicant.aria_dna_integration_status = 'pending'
            self.contract(applicant)
            applicant.write({'stage_id': self.stage['hired'].id})
            self.assertEqual(applicant.stage_id.aria_stage_key, 'hired')

            self.env['ir.config_parameter'].sudo().set_param(
                'aria_recruitment.dna_adapter',
                'not-a-live-endpoint',
            )
            other = self.applicant('to_hire', name='Casey Example')
            other.aria_dna_integration_status = 'complete'
            self.contract(other)
            error = self.move(other, 'hired')
            self.assertTrue(error)
            self.assertEqual(other.stage_id.aria_stage_key, 'to_hire')
            self.assertIn('DNA', self.audits(other, result='refused')[0].reason)
        finally:
            unregister_adapter('scripted')
