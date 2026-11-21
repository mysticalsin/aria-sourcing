import base64
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
        error = None
        try:
            applicant.action_aria_outreach()
        except UserError as exc:
            error = exc
        self.assertTrue(error)
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

    def test_erasure_clears_contract_pdf_and_redacts_chatter(self):
        applicant = self.applicant('to_rate', name='Mina Example', email='mina.example@example.test')
        applicant.message_post(
            body='Hello Mina Example at mina.example@example.test',
            message_type='comment',
            subtype_xmlid='mail.mt_note',
        )
        applicant.write({
            'aria_contract_filename': 'mina-contract.pdf',
            'aria_contract_pdf': base64.b64encode(b'%PDF-1.4\nMina Example\n%%EOF\n'),
        })
        self.assertTrue(applicant.aria_contract_pdf)
        applicant.action_aria_erase()
        self.assertFalse(applicant.aria_contract_pdf)
        chatter = ' '.join(
            f"{message.body or ''} {message.subject or ''} {message.email_from or ''}"
            for message in applicant.message_ids
        )
        self.assertNotIn('Mina', chatter)
        self.assertNotIn('mina.example', chatter.lower())
        self.assertTrue(any('erased' in (message.body or '') for message in applicant.message_ids))
        audit = self.audits(applicant, event_kind='gdpr')
        self.assertTrue(audit)
        self.assertNotIn('Mina', ' '.join(audit.mapped('reason')))

    def test_outbound_mail_and_approval_refused_when_blocked(self):
        opted = self.applicant('to_assess', name='Opt Mail', email='opt.mail.example@example.test')
        opted.write({'aria_opt_out': True})
        error = None
        try:
            opted.message_post(
                body='Offer for opt.mail.example@example.test',
                message_type='email',
                subtype_xmlid='mail.mt_comment',
            )
        except UserError as exc:
            error = exc
        self.assertTrue(error)
        self.assertTrue(self.audits(opted, event_kind='gdpr', result='refused'))
        opted.message_post(
            body='internal note stays',
            message_type='comment',
            subtype_xmlid='mail.mt_note',
        )

        erased = self.applicant('to_rate', name='Erased Mail', email='erased.mail.example@example.test')
        erased.action_aria_erase()
        error = None
        try:
            erased.message_post(
                body='Hello erased.mail.example@example.test',
                message_type='email',
            )
        except UserError as exc:
            error = exc
        self.assertTrue(error)

        hired = self.applicant('to_hire', name='Hired Mail', email='hired.mail.example@example.test')
        hired.aria_dna_integration_status = 'integrated'
        self.contract(hired)
        self.assertFalse(self.move(hired, 'hired'))
        error = None
        try:
            hired.action_aria_approve_outreach()
        except UserError as exc:
            error = exc
        self.assertTrue(error)
        error = None
        try:
            hired.action_aria_outreach()
        except UserError as exc:
            error = exc
        self.assertTrue(error)
        hired.message_post(
            body='ARIA_TRANSITION internal',
            message_type='comment',
            subtype_xmlid='mail.mt_note',
        )

    def test_hired_outbound_mail_is_refused_and_internal_note_stays(self):
        hired = self.applicant('to_hire', name='Hired Post', email='hired.post.example@example.test')
        hired.aria_dna_integration_status = 'integrated'
        self.contract(hired)
        self.assertFalse(self.move(hired, 'hired'))
        error = None
        try:
            hired.message_post(
                body='Offer for hired.post.example@example.test',
                message_type='email',
                subtype_xmlid='mail.mt_comment',
            )
        except UserError as exc:
            error = exc
        self.assertIsNotNone(error)
        self.assertIn('hired', str(error).lower())
        note = hired.message_post(
            body='internal note stays',
            message_type='comment',
            subtype_xmlid='mail.mt_note',
        )
        self.assertIn('internal note stays', note.body or '')
