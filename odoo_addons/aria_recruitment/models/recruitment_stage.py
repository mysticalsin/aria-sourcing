from odoo import api, fields, models
from odoo.exceptions import UserError

from .pipeline_spec import load_pipeline_spec


class HrRecruitmentStage(models.Model):
    _inherit = 'hr.recruitment.stage'

    aria_stage_key = fields.Char(string='Stage key', index=True, copy=False)
    aria_terminal = fields.Boolean(string='Terminal', copy=False)
    _aria_stage_key_unique = models.Constraint(
        'unique (aria_stage_key)',
        'Each pipeline stage key can be used only once.',
    )

    @api.model
    def _aria_sync_stages_from_spec(self):
        """Create or update hr.recruitment.stage rows from the shared spec."""
        spec = load_pipeline_spec()
        synced = self.env['hr.recruitment.stage']
        for row in spec['stages']:
            xml_name = f"stage_{row['key']}"
            vals = {
                'name': row['name'],
                'sequence': row['sequence'],
                'aria_stage_key': row['key'],
                'aria_terminal': row['terminal'],
                'hired_stage': row['hired'],
                'fold': row['terminal'],
            }
            stage = self.env.ref(f'aria_recruitment.{xml_name}', raise_if_not_found=False)
            if not stage:
                stage = self.sudo().search([('aria_stage_key', '=', row['key'])], limit=1)
            if stage:
                stage.with_context(aria_spec_sync=True).write(vals)
            else:
                stage = self.with_context(aria_spec_sync=True).create(vals)
            self.env['ir.model.data']._update_xmlids([{
                'xml_id': f'aria_recruitment.{xml_name}',
                'record': stage,
                'noupdate': False,
            }])
            synced |= stage
        self.env['ir.config_parameter'].sudo().set_param(
            'aria_recruitment.pipeline_spec_version',
            str(spec['spec_version']),
        )
        return synced

    @api.model_create_multi
    def create(self, vals_list):
        if not self.env.context.get('aria_spec_sync'):
            for vals in vals_list:
                if vals.get('aria_stage_key'):
                    raise UserError('Stage keys are owned by the pipeline spec.')
                if vals.get('hired_stage'):
                    raise UserError('Only the spec can mark a stage as hired.')
                if vals.get('aria_terminal'):
                    raise UserError('Terminal flags are owned by the pipeline spec.')
        return super().create(vals_list)

    def write(self, vals):
        if not self.env.context.get('aria_spec_sync'):
            protected = {'aria_stage_key', 'aria_terminal', 'name', 'hired_stage'} & set(vals)
            if protected:
                for stage in self:
                    if 'aria_stage_key' in vals and (vals.get('aria_stage_key') or False) != (stage.aria_stage_key or False):
                        raise UserError('Stage keys are immutable.')
                    if 'aria_terminal' in vals and bool(vals.get('aria_terminal')) != bool(stage.aria_terminal):
                        raise UserError('Terminal flags are owned by the pipeline spec.')
                    if stage.aria_stage_key and 'name' in vals and vals['name'] != stage.name:
                        raise UserError('Pipeline stage names are owned by the spec.')
                    if 'hired_stage' in vals:
                        wants_hired = bool(vals.get('hired_stage'))
                        if wants_hired and stage.aria_stage_key != 'hired':
                            raise UserError('Only the Hired stage can be the hired stage.')
                        if stage.aria_stage_key == 'hired' and not wants_hired:
                            raise UserError('The Hired stage cannot lose its hired flag.')
        return super().write(vals)

    def unlink(self):
        if any(stage.aria_stage_key for stage in self):
            raise UserError('Pipeline stages are owned by the spec and cannot be deleted.')
        return super().unlink()
