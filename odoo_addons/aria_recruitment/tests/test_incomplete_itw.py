from odoo import fields
from odoo.tests import tagged

from .common import AriaRecruitmentCommon


@tagged('post_install', '-at_install', 'aria_recruitment')
class TestIncompleteItw(AriaRecruitmentCommon):
    def _itw(self, applicant, xmlid):
        return self.env['mail.activity'].create({
            'activity_type_id': self.env.ref(xmlid).id,
            'res_model_id': self.env['ir.model']._get_id('hr.applicant'),
            'res_id': applicant.id,
            'user_id': self.env.user.id,
            'summary': 'Synthetic interview',
            'date_deadline': fields.Date.context_today(applicant),
        })

    def _reports(self, applicant):
        return self.env['mail.activity'].search([
            ('res_model', '=', 'hr.applicant'),
            ('res_id', '=', applicant.id),
            ('activity_type_id', '=', self.env.ref('aria_recruitment.mail_activity_itw_report').id),
        ])

    def test_incomplete_itw_schedules_overdue_report_activity(self):
        today = fields.Date.context_today(self.env['hr.applicant'])
        cases = (
            ('aria_recruitment.mail_activity_itw1', 'done'),
            ('aria_recruitment.mail_activity_itw2', 'blank'),
            ('aria_recruitment.mail_activity_itw3_signature', 'space'),
        )
        for xmlid, how in cases:
            applicant = self.applicant('to_interview')
            activity = self._itw(applicant, xmlid)
            if how == 'done':
                activity.action_done()
            elif how == 'blank':
                activity.action_feedback(feedback='')
            else:
                activity.action_feedback(feedback='  \n')
            report = self._reports(applicant)
            self.assertEqual(len(report), 1, xmlid)
            self.assertEqual(report.summary, 'Incomplete ITW')
            self.assertLess(report.date_deadline, today)
            self.assertEqual(report.state, 'overdue')

        untouched = self.applicant('shoot')
        todo = self.env['mail.activity'].create({
            'activity_type_id': self.env.ref('mail.mail_activity_data_todo').id,
            'res_model_id': self.env['ir.model']._get_id('hr.applicant'),
            'res_id': untouched.id,
            'user_id': self.env.user.id,
        })
        todo.action_done()
        self.assertFalse(self._reports(untouched))

    def test_itw_with_report_does_not_schedule_followup(self):
        applicant = self.applicant('shoot')
        activity = self._itw(applicant, 'aria_recruitment.mail_activity_itw1')
        activity.action_feedback(feedback='Synthetic report: strong fit for the designer need.')
        self.assertFalse(self._reports(applicant))

        other = self.applicant('qm', name='Drew Example')
        attachment = self.env['ir.attachment'].create({
            'name': 'synthetic-itw-notes.txt',
            'datas': 'U3ludGhldGljIGludGVydmlldyBub3Rlcy4=',
            'res_model': 'hr.applicant',
            'res_id': other.id,
        })
        noted = self._itw(other, 'aria_recruitment.mail_activity_itw3_signature')
        noted.action_feedback(feedback=False, attachment_ids=[attachment.id])
        self.assertFalse(self._reports(other))
