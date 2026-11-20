from pathlib import Path
from unittest.mock import patch

from odoo import api, fields
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.service.model import call_kw
from odoo.tests import tagged
from odoo.tests.common import new_test_user

from .common import AriaRecruitmentCommon


@tagged('post_install', '-at_install', 'aria_recruitment')
class TestSentinelFindings(AriaRecruitmentCommon):
    def test_date_closed_alone_refused_and_audited(self):
        applicant = self.applicant('to_hire')
        applicant.aria_dna_integration_status = 'complete'
        before = applicant.date_closed

        error = None
        try:
            applicant.write({'date_closed': fields.Datetime.now()})
        except ValidationError as exc:
            error = exc

        self.assertTrue(error)
        self.assertIn('hire', str(error).lower())
        self.assertFalse(applicant.date_closed or before)
        self.assertEqual(applicant.stage_id.aria_stage_key, 'to_hire')
        self.assertFalse(applicant.application_status == 'hired')
        audit = self.audits(applicant, result='refused', to_stage_key='hired')
        self.assertTrue(audit)
        self.assertTrue(self.notes(applicant))

    def test_application_status_hired_refused_and_audited(self):
        applicant = self.applicant('to_assess')
        error = None
        try:
            applicant.write({'application_status': 'hired'})
        except ValidationError as exc:
            error = exc
        self.assertTrue(error)
        self.assertNotEqual(applicant.application_status, 'hired')
        self.assertFalse(applicant.date_closed)
        self.assertTrue(self.audits(applicant, result='refused', to_stage_key='hired'))

    def test_contract_kind_requires_manager_pdf_and_records_setter(self):
        applicant = self.applicant('to_hire')
        recruiter = new_test_user(
            self.env,
            login='recruiter.synthetic@example.test',
            groups='hr_recruitment.group_hr_recruitment_user',
        )
        with self.assertRaises(AccessError):
            self.env['ir.attachment'].with_user(recruiter).create({
                'name': 'synthetic-contract.pdf',
                'res_model': 'hr.applicant',
                'res_id': applicant.id,
                'datas': 'JVBERi0xLjQKJSVFT0Y=',
                'mimetype': 'application/pdf',
                'aria_document_kind': 'contract',
            })
        with self.assertRaises(ValidationError):
            self.env['ir.attachment'].create({
                'name': 'empty.pdf',
                'res_model': 'hr.applicant',
                'res_id': applicant.id,
                'datas': False,
                'mimetype': 'application/pdf',
                'aria_document_kind': 'contract',
            })
        with self.assertRaises(ValidationError):
            self.env['ir.attachment'].create({
                'name': 'notes.txt',
                'res_model': 'hr.applicant',
                'res_id': applicant.id,
                'datas': 'bm90IGEgcGRm',
                'mimetype': 'text/plain',
                'aria_document_kind': 'contract',
            })
        contract = self.contract(applicant)
        self.assertEqual(contract.aria_contract_set_by, self.env.user)
        self.assertTrue(contract.aria_contract_set_at)

    def test_hired_contract_locked_except_system(self):
        manager = new_test_user(
            self.env,
            login='manager.synthetic@example.test',
            groups='hr_recruitment.group_hr_recruitment_manager',
        )
        applicant = self.applicant('to_hire')
        applicant.aria_dna_integration_status = 'complete'
        contract = self.env['ir.attachment'].with_user(manager).create({
            'name': 'synthetic-contract.pdf',
            'res_model': 'hr.applicant',
            'res_id': applicant.id,
            'datas': 'JVBERi0xLjQKJSVFT0Y=',
            'mimetype': 'application/pdf',
            'aria_document_kind': 'contract',
        })
        applicant.write({'stage_id': self.stage['hired'].id})
        with self.assertRaises(UserError):
            contract.with_user(manager).write({'aria_document_kind': 'other'})
        with self.assertRaises(UserError):
            contract.with_user(manager).unlink()
        self.assertTrue(contract.exists())
        self.assertEqual(contract.aria_document_kind, 'contract')
        contract.with_user(self.env.ref('base.user_admin')).unlink()
        self.assertFalse(contract.exists())

    def test_recruiter_cannot_set_dna_status_or_parameter(self):
        recruiter = new_test_user(
            self.env,
            login='dna.recruiter@example.test',
            groups='hr_recruitment.group_hr_recruitment_user',
        )
        applicant = self.applicant('to_hire')
        with self.assertRaises(AccessError):
            applicant.with_user(recruiter).write({'aria_dna_integration_status': 'complete'})
        with self.assertRaises(AccessError):
            self.env['ir.config_parameter'].with_user(recruiter).set_param(
                'aria_recruitment.dna_adapter',
                'fake',
            )

    def test_unconfigured_dna_adapter_fails_closed(self):
        shipped = Path(__file__).resolve().parents[1].joinpath('data', 'dna_parameter.xml').read_text(encoding='utf-8')
        self.assertIn('unconfigured', shipped)
        self.assertNotIn('<field name="value">fake</field>', shipped)
        self.env['ir.config_parameter'].sudo().set_param('aria_recruitment.dna_adapter', 'unconfigured')
        applicant = self.applicant('to_hire')
        applicant.sudo().write({'aria_dna_integration_status': 'complete'})
        self.contract(applicant)
        error = self.move(applicant, 'hired')
        self.assertTrue(error)
        self.assertIn('DNA', str(error))
        self.assertEqual(applicant.stage_id.aria_stage_key, 'to_hire')
        self.env['ir.config_parameter'].sudo().set_param('aria_recruitment.dna_adapter', 'fake')

    def test_spec_sync_context_rejected_over_rpc(self):
        hired = self.stage['hired']
        with self.assertRaises(UserError):
            call_kw(
                self.env['hr.recruitment.stage'],
                'write',
                [[hired.id], {'name': 'Smuggled Hired'}],
                {'context': {'aria_spec_sync': True, 'install_mode': True}},
            )
        self.assertEqual(hired.name, 'Hired')

    def test_create_employee_requires_hire_gate(self):
        applicant = self.applicant('to_hire')
        before = self.env['hr.employee'].search_count([])
        error = None
        try:
            applicant.create_employee_from_applicant()
        except ValidationError as exc:
            error = exc
        self.assertTrue(error)
        self.assertIn('hire', str(error).lower())
        self.assertEqual(self.env['hr.employee'].search_count([]), before)
        self.assertTrue(self.audits(applicant, result='refused', to_stage_key='hired'))
        self.assertEqual(applicant.stage_id.aria_stage_key, 'to_hire')

    def test_refused_create_audit_commits_independently(self):
        reason = 'transition -> hired is not allowed'

        def count():
            with self.env.registry.cursor() as cr:
                env = api.Environment(cr, self.env.uid, {})
                return env['aria.recruitment.transition.audit'].sudo().search_count([
                    ('reason', '=', reason),
                    ('result', '=', 'refused'),
                    ('to_stage_key', '=', 'hired'),
                    ('applicant_id', '=', False),
                ])

        before = count()
        with self.assertRaises(ValidationError):
            self.env['hr.applicant'].create({
                'partner_name': 'Quinn Example',
                'email_from': 'quinn.example@example.test',
                'job_id': self.job.id,
                'stage_id': self.stage['hired'].id,
            })
        self.assertEqual(count(), before + 1)

    def test_refusal_audit_failure_is_logged(self):
        applicant = self.applicant('to_hire')
        logger_name = 'odoo.addons.aria_recruitment.models.applicant'
        with self.assertLogs(logger_name, level='ERROR') as captured:
            with patch(
                'odoo.addons.aria_recruitment.models.applicant.HrApplicant._aria_commit_refusal',
                side_effect=RuntimeError('synthetic audit disk failure'),
            ):
                error = self.move(applicant, 'hired')
        self.assertTrue(error)
        self.assertTrue(any('synthetic audit disk failure' in line or 'refusal audit' in line for line in captured.output))

    def test_audit_company_rule(self):
        applicant = self.applicant('to_hire')
        self.move(applicant, 'hired')
        audit = self.audits(applicant, result='refused')[:1]
        self.assertTrue(audit.company_id)
        other = self.env['res.company'].create({'name': 'Synthetic Other Co'})
        outsider = new_test_user(
            self.env,
            login='otherco.synthetic@example.test',
            groups='hr_recruitment.group_hr_recruitment_manager',
        )
        outsider.sudo().write({'company_ids': [(6, 0, [other.id])], 'company_id': other.id})
        visible = self.env['aria.recruitment.transition.audit'].with_user(outsider).search([
            ('id', '=', audit.id),
        ])
        self.assertFalse(visible)

    def test_multi_record_write_is_atomic(self):
        allowed = self.applicant('to_hire', name='Allowed Example')
        allowed.aria_dna_integration_status = 'complete'
        self.contract(allowed)
        blocked = self.applicant('to_hire', name='Blocked Example')
        error = None
        try:
            (allowed | blocked).write({'stage_id': self.stage['hired'].id})
        except ValidationError as exc:
            error = exc
        self.assertTrue(error)
        self.assertEqual(allowed.stage_id.aria_stage_key, 'to_hire')
        self.assertEqual(blocked.stage_id.aria_stage_key, 'to_hire')
        self.assertTrue(self.audits(blocked, result='refused'))

    def test_identical_refusals_are_coalesced(self):
        applicant = self.applicant('to_hire')
        first = self.move(applicant, 'hired')
        second = self.move(applicant, 'hired')
        self.assertTrue(first and second)
        audits = self.audits(applicant, result='refused', to_stage_key='hired')
        self.assertEqual(len(audits), 1)
        self.assertGreaterEqual(audits.attempt_count, 2)

    def test_ci_image_digests_are_pinned(self):
        compose = Path(__file__).resolve().parents[1].joinpath('ci', 'docker-compose.yml').read_text(encoding='utf-8')
        self.assertIn(
            'postgres:16@sha256:3950ad7c3148ca2175ef1b6c36c9efbf78957ae8fbe8b3a5d7c35af50500382f',
            compose,
        )
        self.assertIn(
            'odoo:19@sha256:03a47921f9eef2c225ded1167fe7828465d2b3177883f30d173bb1c3c792949b',
            compose,
        )
        self.assertIn('aria_recruitment', compose)
