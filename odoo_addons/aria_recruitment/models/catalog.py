from odoo import fields, models


class AriaRecruitmentLanguage(models.Model):
    _name = 'aria.recruitment.language'
    _description = 'Smart job offer language'
    _order = 'name, id'

    name = fields.Char(required=True, translate=True)
    _name_unique = models.Constraint(
        'unique (name)',
        'Each language is recorded once.',
    )


class AriaRecruitmentJobField(models.Model):
    _name = 'aria.recruitment.job.field'
    _description = 'Smart job field'
    _order = 'name, id'

    name = fields.Char(required=True, translate=True)
    _name_unique = models.Constraint(
        'unique (name)',
        'Each job field is recorded once.',
    )
