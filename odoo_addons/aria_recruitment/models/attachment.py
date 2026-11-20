from odoo import fields, models


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
