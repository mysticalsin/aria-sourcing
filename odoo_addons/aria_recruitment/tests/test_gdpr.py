from datetime import timedelta

from odoo import fields
from odoo.exceptions import UserError
from odoo.tests import tagged

from .common import AriaRecruitmentCommon


@tagged('post_install', '-at_install', 'aria_recruitment')
class TestAriaGdpr(AriaRecruitmentCommon):
    def test_opt_out_blocks_outreach_and_is_audited(self):
        applicant = self.applicant('to_assess', name='Opt Out Example', email='optout.example@example.test')
        applicant.write({'aria_opt_out': True})
        self.assertTrue(applicant.aria_opt_out)
        recorded = self.audits(applicant, event_kind='gdpr', result='allowed')
        self.assertTrue(recorded)
        self.assertNotIn('optout.example', (recorded[0].reason or '').lower())
        with self.assertRaises(UserError):
            applicant.action_aria_outreach()
        blocked = self.audits(applicant, event_kind='gdpr', result='refused')
        self.assertTrue(blocked)
        self.assertIn('opt-out', (blocked[0].reason or '').lower())

    def test_erasure_anonymises_personal_data_and_leaves_an_audit(self):
        applicant = self.applicant('to_rate', name='Mina Example', email='mina.example@example.test')
        applicant.partner_phone = '+1 555 0100'
        applicant.linkedin_profile = 'https://example.test/in/mina'
        applicant.action_aria_erase()
        self.assertTrue(applicant.aria_erased)
        self.assertNotIn('Mina', applicant.partner_name or '')
        self.assertFalse(applicant.email_from)
        self.assertFalse(applicant.partner_phone)
        self.assertFalse(applicant.linkedin_profile)
        audit = self.audits(applicant, event_kind='gdpr')
        self.assertTrue(audit)
        blob = ' '.join(audit.mapped('reason'))
        self.assertNotIn('Mina', blob)
        self.assertNotIn('mina.example', blob.lower())

    def test_retention_action_erases_due_applicants(self):
        due = self.applicant('qm', name='Nia Example', email='nia.example@example.test')
        waiting = self.applicant('qm', name='Otto Example', email='otto.example@example.test')
        yesterday = fields.Date.context_today(due) - timedelta(days=1)
        tomorrow = fields.Date.context_today(due) + timedelta(days=1)
        due.write({'aria_retention_deadline': yesterday})
        waiting.write({'aria_retention_deadline': tomorrow})
        due.action_aria_apply_retention()
        waiting.action_aria_apply_retention()
        self.assertTrue(due.aria_erased)
        self.assertNotIn('Nia', due.partner_name or '')
        self.assertFalse(waiting.aria_erased)
        self.assertIn('Otto', waiting.partner_name or '')
        audit = self.audits(due, event_kind='gdpr')
        self.assertTrue(any('retention' in (row.reason or '') for row in audit))
        self.assertNotIn('nia.example', ' '.join(audit.mapped('reason')).lower())
