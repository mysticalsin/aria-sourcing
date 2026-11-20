import base64

from odoo.exceptions import ValidationError
from odoo.tests import TransactionCase


STAGE_KEYS = (
    'to_rate',
    'to_assess',
    'to_interview',
    'shoot',
    'qm',
    'to_hire',
    'hired',
    'rejected',
    'withdrawn',
)


class AriaRecruitmentCommon(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        manager = cls.env.ref('hr_recruitment.group_hr_recruitment_manager')
        admin = cls.env.ref('base.user_admin')
        admin.sudo().write({'group_ids': [(4, manager.id)]})
        cls.stage = {
            key: cls.env.ref(f'aria_recruitment.stage_{key}')
            for key in STAGE_KEYS
        }
        cls.job = cls.env['hr.job'].create({'name': 'Synthetic Plastic Designer'})

    def applicant(self, stage_key='to_rate', name=None, email=None):
        count = self.env['hr.applicant'].search_count([]) + 1
        record = self.env['hr.applicant'].create({
            'partner_name': name or f'Alex Example {count}',
            'email_from': email or f'alex.{count}.example@example.test',
            'job_id': self.job.id,
            'stage_id': self.stage[stage_key].id,
            'aria_smart_need_id': 'NEED-SYN-1001',
            'aria_smart_candidate_id': f'CAND-SYN-{1000 + count}',
            'aria_utm_link': f'https://aria.example.test/c/{count}?utm_source=aria&utm_medium=test',
        })
        self.assertEqual(
            record.stage_id.aria_stage_key,
            stage_key,
            'initial placement did not stick on the requested stage',
        )
        return record

    def contract(self, applicant, kind='contract', name='synthetic-contract.pdf'):
        return self.env['ir.attachment'].create({
            'name': name,
            'res_model': 'hr.applicant',
            'res_id': applicant.id,
            'datas': base64.b64encode(b'%PDF-1.4\n% synthetic document\n%%EOF\n'),
            'mimetype': 'application/pdf',
            'aria_document_kind': kind,
        })

    def audits(self, applicant, **extra):
        domain = [
            '|',
            ('applicant_id', '=', applicant.id),
            ('applicant_res_id', '=', applicant.id),
        ]
        for field_name, value in extra.items():
            domain.append((field_name, '=', value))
        return self.env['aria.recruitment.transition.audit'].sudo().search(domain, order='id')

    def move(self, applicant, stage_key):
        """Attempt a stage change and return the ValidationError, if any.

        ``assertRaises`` rolls back a savepoint, which would hide the audit
        written for the refused attempt. Catch the error directly instead.
        """
        error = None
        try:
            applicant.write({'stage_id': self.stage[stage_key].id})
        except ValidationError as exc:
            error = exc
        return error

    def notes(self, applicant):
        return applicant.message_ids.filtered(lambda message: 'ARIA_TRANSITION' in (message.body or ''))
