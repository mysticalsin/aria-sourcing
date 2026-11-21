from odoo import api, fields, models
from odoo.exceptions import AccessError, UserError, ValidationError

PDF_MIMETYPE = 'application/pdf'


class IrAttachment(models.Model):
    _inherit = 'ir.attachment'

    aria_document_kind = fields.Selection(
        [
            ('contract', 'Contract'),
            ('cv', 'CV'),
            ('other', 'Other'),
        ],
        string='Aria document kind',
        index=True,
        help='A contract kind is required before an applicant can enter Hired.',
    )
    aria_contract_set_by = fields.Many2one('res.users', string='Contract set by', readonly=True, copy=False)
    aria_contract_set_at = fields.Datetime(string='Contract set at', readonly=True, copy=False)

    def _aria_can_mark_contract(self):
        user = self.env.user
        return bool(
            self.env.su
            or user.has_group('base.group_system')
            or user.has_group('hr_recruitment.group_hr_recruitment_manager')
            or user.has_group('hr.group_hr_user')
        )

    def _aria_can_unlock_hired_contract(self):
        return bool(self.env.su or self.env.user.has_group('base.group_system'))

    def _aria_file_is_nonempty_pdf(self, vals, record=None):
        mimetype = vals.get('mimetype') if 'mimetype' in vals else (record.mimetype if record else '')
        if 'datas' in vals:
            payload = vals.get('datas')
        elif 'raw' in vals:
            payload = vals.get('raw')
        elif record is not None:
            payload = record.datas or record.raw
        else:
            payload = False
        return mimetype == PDF_MIMETYPE and bool(payload)

    def _aria_stamp_contract(self, vals):
        vals['aria_contract_set_by'] = self.env.uid
        vals['aria_contract_set_at'] = fields.Datetime.now()
        return vals

    def _aria_audit_contract(self, attachment):
        if attachment.res_model != 'hr.applicant' or not attachment.res_id:
            return
        applicant = self.env['hr.applicant'].browse(attachment.res_id).exists()
        if not applicant:
            return
        self.env['aria.recruitment.transition.audit'].sudo().create({
            'applicant_id': applicant.id,
            'applicant_res_id': applicant.id,
            'company_id': applicant.company_id.id or self.env.company.id,
            'user_id': self.env.uid,
            'transitioned_at': fields.Datetime.now(),
            'from_stage_id': applicant.stage_id.id,
            'to_stage_id': applicant.stage_id.id,
            'from_stage_key': applicant.stage_id.aria_stage_key or '',
            'to_stage_key': applicant.stage_id.aria_stage_key or '',
            'result': 'allowed',
            'reason': f'contract document registered by {self.env.user.display_name}',
            'event_kind': 'contract',
            'sudo_used': bool(self.env.su),
        })

    def _aria_check_contract_vals(self, vals, record=None):
        kind = vals.get('aria_document_kind') if 'aria_document_kind' in vals else (record.aria_document_kind if record else False)
        if kind != 'contract':
            return
        if not self._aria_can_mark_contract():
            raise AccessError('Only a recruitment manager or HR user can mark a contract document.')
        if not self._aria_file_is_nonempty_pdf(vals, record):
            raise ValidationError('A contract document must be a non-empty PDF.')
        self._aria_stamp_contract(vals)

    def _aria_locked_hired_contract(self):
        self.ensure_one()
        if self.aria_document_kind != 'contract' or self.res_model != 'hr.applicant' or not self.res_id:
            return False
        applicant = self.env['hr.applicant'].sudo().browse(self.res_id).exists()
        return bool(applicant and applicant._aria_is_hired_stage(applicant.stage_id))

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            self._aria_check_contract_vals(vals)
        records = super().create(vals_list)
        for record in records:
            if record.aria_document_kind == 'contract':
                self._aria_audit_contract(record)
        return records

    def write(self, vals):
        for attachment in self:
            if attachment._aria_locked_hired_contract() and not attachment._aria_can_unlock_hired_contract():
                if 'aria_document_kind' in vals and vals.get('aria_document_kind') != 'contract':
                    raise UserError('The contract on a hired applicant is locked.')
                if 'datas' in vals or 'raw' in vals:
                    raise UserError('The contract on a hired applicant is locked.')
            if vals.get('aria_document_kind') == 'contract' or (
                'aria_document_kind' not in vals and attachment.aria_document_kind == 'contract' and ('datas' in vals or 'raw' in vals or 'mimetype' in vals)
            ):
                attachment._aria_check_contract_vals(dict(vals), attachment)
        stamped = dict(vals)
        if stamped.get('aria_document_kind') == 'contract':
            self._aria_stamp_contract(stamped)
        return super().write(stamped)

    def unlink(self):
        for attachment in self:
            if attachment._aria_locked_hired_contract() and not attachment._aria_can_unlock_hired_contract():
                raise UserError('The contract on a hired applicant is locked.')
        return super().unlink()
