from odoo import api, models
from odoo.exceptions import AccessError

DNA_PARAMETER = 'aria_recruitment.dna_adapter'


class IrConfigParameter(models.Model):
    _inherit = 'ir.config_parameter'

    def _aria_check_dna_parameter(self):
        if self.env.su:
            return
        user = self.env.user
        if user.has_group('base.group_system') or user.has_group('aria_recruitment.group_dna_integration'):
            return
        raise AccessError('Only the DNA integration group can change the DNA adapter.')

    def _aria_vals_touch_dna(self, vals):
        if vals.get('key') == DNA_PARAMETER:
            return True
        return any(record.key == DNA_PARAMETER for record in self)

    @api.model_create_multi
    def create(self, vals_list):
        if any(vals.get('key') == DNA_PARAMETER for vals in vals_list):
            self._aria_check_dna_parameter()
        return super().create(vals_list)

    def write(self, vals):
        if self._aria_vals_touch_dna(vals):
            self._aria_check_dna_parameter()
        return super().write(vals)

    @api.model
    def set_param(self, key, value):
        if key == DNA_PARAMETER:
            self._aria_check_dna_parameter()
        return super().set_param(key, value)
