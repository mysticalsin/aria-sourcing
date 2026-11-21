from datetime import timedelta

from odoo import fields
from odoo.tests import tagged

from .common import AriaRecruitmentCommon

WEEKLY_COLUMNS = (
    'partner_name',
    'job_id',
    'stage_id',
    'aria_itw_grade',
    'aria_itw_stars',
    'aria_proposal_status',
    'aria_itw_stale',
    'aria_smart_candidate_id',
    'aria_smart_need_id',
)


@tagged('post_install', '-at_install', 'aria_recruitment')
class TestWeeklyList(AriaRecruitmentCommon):
    def _itw(self, applicant, xmlid='aria_recruitment.mail_activity_itw1', deadline=None):
        return self.env['mail.activity'].create({
            'activity_type_id': self.env.ref(xmlid).id,
            'res_model_id': self.env['ir.model']._get_id('hr.applicant'),
            'res_id': applicant.id,
            'user_id': self.env.user.id,
            'summary': 'Synthetic interview',
            'date_deadline': deadline or fields.Date.context_today(applicant),
        })

    def test_weekly_list_tracks_interview_stages(self):
        expected = (
            ('aria_recruitment.mail_activity_itw1', 'ITW1', 'itw1'),
            ('aria_recruitment.mail_activity_itw2', 'ITW2', 'itw2'),
            ('aria_recruitment.mail_activity_itw3_signature', 'ITW3-signature', 'itw3_signature'),
        )
        for xmlid, name, kind in expected:
            activity_type = self.env.ref(xmlid)
            self.assertEqual(activity_type.name, name)
            self.assertEqual(activity_type.aria_itw_kind, kind)
            self.assertEqual(activity_type.res_model, 'hr.applicant')

        placed = {}
        for key in ('to_interview', 'shoot', 'qm'):
            placed[key] = self.applicant(key)
            self._itw(placed[key])
        outsider = self.applicant('to_rate')

        action = self.env.ref('aria_recruitment.action_weekly_list')
        self.assertEqual(
            action.domain,
            "[('stage_id.aria_stage_key', 'in', ['to_interview', 'shoot', 'qm'])]",
        )
        visible = self.env['hr.applicant'].search(eval(action.domain))  # noqa: S307 - action domain is ours
        for key in ('to_interview', 'shoot', 'qm'):
            self.assertIn(placed[key], visible)
        self.assertNotIn(outsider, visible)

    def test_weekly_list_stale_after_seven_days(self):
        today = fields.Date.context_today(self.env['hr.applicant'])
        fresh = self.applicant('to_interview')
        fresh.write({
            'aria_itw_grade': 8.5,
            'aria_itw_stars': 4,
            'aria_proposal_status': 'proposed',
        })
        self._itw(fresh, deadline=today)
        stale = self.applicant('shoot')
        stale.aria_last_itw_on = today - timedelta(days=8)
        boundary = self.applicant('qm')
        boundary.aria_last_itw_on = today - timedelta(days=7)
        outsider = self.applicant('to_rate')
        outsider.aria_last_itw_on = today - timedelta(days=30)

        stale_records = self.env['hr.applicant'].search([('aria_itw_stale', '=', True)])
        self.assertIn(stale, stale_records)
        self.assertNotIn(fresh, stale_records)
        self.assertNotIn(boundary, stale_records)
        self.assertNotIn(outsider, stale_records)
        self.assertTrue(stale.aria_itw_stale)
        self.assertFalse(fresh.aria_itw_stale)
        self.assertFalse(boundary.aria_itw_stale)

        search = self.env.ref('aria_recruitment.view_hr_applicant_weekly_search').arch
        self.assertIn('name="stale_7d"', search)
        self.assertIn("('aria_itw_stale', '=', True)", search)

    def test_weekly_list_export(self):
        today = fields.Date.context_today(self.env['hr.applicant'])
        applicant = self.applicant('qm')
        applicant.write({
            'aria_itw_grade': 7,
            'aria_itw_stars': 5,
            'aria_proposal_status': 'to_propose',
        })
        self._itw(applicant, 'aria_recruitment.mail_activity_itw2', deadline=today)
        exported = applicant.export_data(list(WEEKLY_COLUMNS))
        self.assertEqual(len(exported['datas']), 1)
        row = exported['datas'][0]
        self.assertEqual(row[WEEKLY_COLUMNS.index('partner_name')], applicant.partner_name)
        self.assertEqual(row[WEEKLY_COLUMNS.index('aria_itw_grade')], 7.0)
        self.assertEqual(row[WEEKLY_COLUMNS.index('aria_itw_stars')], 5)
        self.assertEqual(row[WEEKLY_COLUMNS.index('aria_proposal_status')], 'To propose')

        arch = self.env.ref('aria_recruitment.view_hr_applicant_weekly_list').arch
        self.assertIn('<list', arch)
        for field_name in WEEKLY_COLUMNS:
            self.assertIn(f'name="{field_name}"', arch)
