from odoo import api, fields, models
from odoo.exceptions import UserError


class AriaRecruitmentTransitionAudit(models.Model):
    """Append-only record of every stage transition attempt."""

    _name = 'aria.recruitment.transition.audit'
    _description = 'Recruitment stage transition audit'
    _order = 'id desc'
    _rec_name = 'reason'

    applicant_id = fields.Many2one(
        'hr.applicant',
        string='Applicant',
        index=True,
        ondelete='set null',
        readonly=True,
    )
    applicant_res_id = fields.Integer(
        string='Applicant record id',
        index=True,
        readonly=True,
        help='Kept even when the business transaction that attempted the move is rolled back.',
    )
    user_id = fields.Many2one(
        'res.users',
        string='Who',
        required=True,
        readonly=True,
        index=True,
    )
    transitioned_at = fields.Datetime(
        string='When',
        required=True,
        readonly=True,
        index=True,
    )
    from_stage_id = fields.Many2one('hr.recruitment.stage', string='From stage', readonly=True)
    to_stage_id = fields.Many2one('hr.recruitment.stage', string='To stage', readonly=True)
    from_stage_key = fields.Char(string='From', readonly=True, index=True)
    to_stage_key = fields.Char(string='To', readonly=True, index=True)
    result = fields.Selection(
        [('allowed', 'Allowed'), ('refused', 'Refused')],
        required=True,
        readonly=True,
        index=True,
    )
    reason = fields.Text(required=True, readonly=True)
    sudo_used = fields.Boolean(string='Sudo', readonly=True)

    def write(self, vals):
        raise UserError('Transition audit records are append-only.')

    def unlink(self):
        raise UserError('Transition audit records are append-only.')

    @api.model_create_multi
    def create(self, vals_list):
        return super().create(vals_list)
