from odoo import fields, models


class HrJob(models.Model):
    _inherit = 'hr.job'

    aria_smart_need_id = fields.Char(string='Smart need id', index=True, copy=False)
    aria_language_ids = fields.Many2many(
        'aria.recruitment.language',
        'aria_job_language_rel',
        'job_id',
        'language_id',
        string='Languages',
    )
    aria_job_field_ids = fields.Many2many(
        'aria.recruitment.job.field',
        'aria_job_field_rel',
        'job_id',
        'field_id',
        string='Job fields',
    )
    aria_experience_level = fields.Selection(
        [
            ('junior', 'Junior'),
            ('mid', 'Mid'),
            ('senior', 'Senior'),
            ('lead', 'Lead'),
            ('expert', 'Expert'),
        ],
        string='Experience level',
        index=True,
    )
    aria_location = fields.Char(string='Location')
    aria_client_id = fields.Many2one(
        'res.partner',
        string='Client company',
        domain=[('is_company', '=', True)],
        help='Client company on the Smart job offer.',
    )
    aria_contract_type = fields.Selection(
        [
            ('permanent', 'Permanent'),
            ('fixed_term', 'Fixed-term'),
            ('freelance', 'Freelance'),
            ('internship', 'Internship'),
            ('cnpj', 'CNPJ'),
        ],
        string='Contract type',
        index=True,
    )
    aria_need_type = fields.Selection(
        [('consulting', 'Consulting'), ('staff', 'Staff')],
        string='Need type',
        index=True,
    )
    aria_need_segment = fields.Selection(
        [('business', 'Business'), ('corporate', 'Corporate')],
        string='Business / Corporate',
        index=True,
    )
    aria_need_category = fields.Selection(
        [('active', 'Active'), ('strategic', 'Strategic')],
        string='Need category',
        index=True,
    )
    aria_need_status = fields.Selection(
        [
            ('anticipated', 'Anticipated'),
            ('waiting', 'Waiting'),
            ('running', 'Running'),
            ('closed', 'Closed'),
        ],
        string='Need status',
        index=True,
    )
    aria_need_priority = fields.Selection(
        [('p1', 'P1'), ('p2', 'P2'), ('p3', 'P3'), ('p4', 'P4')],
        string='Priority',
        index=True,
    )
