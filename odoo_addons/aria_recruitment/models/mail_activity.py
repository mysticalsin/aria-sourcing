from datetime import timedelta

from odoo import api, fields, models

from .applicant import ITW_KINDS


class MailActivityType(models.Model):
    _inherit = 'mail.activity.type'

    aria_itw_kind = fields.Selection(
        [
            ('itw1', 'ITW1'),
            ('itw2', 'ITW2'),
            ('itw3_signature', 'ITW3-signature'),
            ('itw_report', 'Interview report'),
        ],
        string='Aria ITW kind',
        index=True,
    )


class MailActivity(models.Model):
    _inherit = 'mail.activity'

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        records._aria_touch_itw_applicants(use_deadline=True)
        return records

    def _aria_touch_itw_applicants(self, use_deadline=True):
        today = fields.Date.context_today(self)
        for activity in self:
            kind = activity.activity_type_id.aria_itw_kind
            if kind not in ITW_KINDS or activity.res_model != 'hr.applicant' or not activity.res_id:
                continue
            applicant = self.env['hr.applicant'].browse(activity.res_id).exists()
            if not applicant:
                continue
            touched = activity.date_deadline if use_deadline else today
            if not touched:
                continue
            if not applicant.aria_last_itw_on or touched > applicant.aria_last_itw_on:
                applicant.aria_last_itw_on = touched

    def _aria_feedback_is_report(self, feedback, attachment_ids):
        text = feedback.strip() if isinstance(feedback, str) else ''
        return bool(text) or bool(attachment_ids)

    def _action_done(self, feedback=False, attachment_ids=None):
        pending_reports = []
        if not self._aria_feedback_is_report(feedback, attachment_ids):
            for activity in self:
                kind = activity.activity_type_id.aria_itw_kind
                if kind in ITW_KINDS and activity.res_model == 'hr.applicant' and activity.res_id:
                    pending_reports.append({
                        'res_id': activity.res_id,
                        'user_id': activity.user_id.id,
                        'itw_name': activity.activity_type_id.name,
                    })
        self._aria_touch_itw_applicants(use_deadline=False)
        messages, next_activities = super()._action_done(feedback=feedback, attachment_ids=attachment_ids)
        report_type = self.env.ref('aria_recruitment.mail_activity_itw_report', raise_if_not_found=False)
        if report_type and pending_reports:
            yesterday = fields.Date.context_today(self) - timedelta(days=1)
            model_id = self.env['ir.model']._get_id('hr.applicant')
            for item in pending_reports:
                self.env['mail.activity'].create({
                    'activity_type_id': report_type.id,
                    'summary': 'Incomplete ITW',
                    'note': f'Interview report missing after {item["itw_name"]}.',
                    'date_deadline': yesterday,
                    'res_model_id': model_id,
                    'res_id': item['res_id'],
                    'user_id': item['user_id'] or self.env.uid,
                })
        return messages, next_activities
