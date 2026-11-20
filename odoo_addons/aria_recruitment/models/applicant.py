from datetime import timedelta

from markupsafe import Markup

from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .dna_adapter import resolve_adapter
from .state_machine import TransitionDecision, decide_stage

INTERVIEW_STAGE_KEYS = ('to_interview', 'shoot', 'qm')
ITW_KINDS = ('itw1', 'itw2', 'itw3_signature')


class HrApplicant(models.Model):
    _inherit = 'hr.applicant'

    aria_smart_need_id = fields.Char(string='Smart need id', index=True, copy=False)
    aria_smart_candidate_id = fields.Char(string='Smart candidate id', index=True, copy=False)
    aria_utm_link = fields.Char(string='Aria source / UTM link')
    aria_dna_integration_status = fields.Selection(
        [
            ('pending', 'Pending'),
            ('incomplete', 'Incomplete'),
            ('failed', 'Failed'),
            ('integrated', 'Integrated'),
            ('complete', 'Complete'),
        ],
        string='DNA status (fake adapter)',
        default='pending',
        required=True,
        help=(
            'Value read by the built-in fake DNA adapter. A registered adapter '
            'replaces that reading. This module never calls DNA over the network.'
        ),
    )
    aria_itw_grade = fields.Float(string='ITW grade')
    aria_itw_stars = fields.Integer(string='Stars', default=0)
    aria_proposal_status = fields.Selection(
        [
            ('none', 'No proposal'),
            ('to_propose', 'To propose'),
            ('proposed', 'Proposed'),
            ('accepted', 'Accepted'),
            ('refused', 'Refused'),
        ],
        string='Proposal status',
        default='none',
        required=True,
    )
    aria_last_itw_on = fields.Date(string='Last ITW', copy=False)
    aria_itw_stale = fields.Boolean(
        string='Stale (7 days)',
        compute='_compute_aria_itw_stale',
        search='_search_aria_itw_stale',
    )

    @api.constrains('aria_itw_stars')
    def _check_aria_itw_stars(self):
        for applicant in self:
            if applicant.aria_itw_stars < 0 or applicant.aria_itw_stars > 5:
                raise ValidationError('ITW stars must be between 0 and 5.')

    def _compute_aria_itw_stale(self):
        stages = self.env['hr.recruitment.stage'].search([
            ('aria_stage_key', 'in', list(INTERVIEW_STAGE_KEYS)),
        ])
        fresh_ids = self._aria_fresh_itw_applicant_ids()
        stage_ids = set(stages.ids)
        for applicant in self:
            applicant.aria_itw_stale = applicant.stage_id.id in stage_ids and applicant.id not in fresh_ids

    def _search_aria_itw_stale(self, operator, value):
        if operator not in ('=', '!='):
            return NotImplemented
        want_stale = bool(value) if operator == '=' else not bool(value)
        stages = self.env['hr.recruitment.stage'].search([
            ('aria_stage_key', 'in', list(INTERVIEW_STAGE_KEYS)),
        ])
        fresh = list(self._aria_fresh_itw_applicant_ids()) or [0]
        if want_stale:
            return [('stage_id', 'in', stages.ids), ('id', 'not in', fresh)]
        return ['|', ('stage_id', 'not in', stages.ids), ('id', 'in', fresh)]

    @api.model
    def _aria_fresh_itw_applicant_ids(self):
        horizon = fields.Date.context_today(self) - timedelta(days=7)
        stages = self.env['hr.recruitment.stage'].search([
            ('aria_stage_key', 'in', list(INTERVIEW_STAGE_KEYS)),
        ])
        dated = self.env['hr.applicant'].sudo().search([
            ('stage_id', 'in', stages.ids),
            ('aria_last_itw_on', '>=', horizon),
        ])
        activity_types = self.env['mail.activity.type'].sudo().search([
            ('aria_itw_kind', 'in', list(ITW_KINDS)),
        ])
        activities = self.env['mail.activity'].sudo().search([
            ('res_model', '=', 'hr.applicant'),
            ('activity_type_id', 'in', activity_types.ids),
            ('date_deadline', '>=', horizon),
        ])
        return set(dated.ids) | set(activities.mapped('res_id'))

    def _aria_contract_attached(self):
        self.ensure_one()
        return bool(self.env['ir.attachment'].sudo().search_count([
            ('res_model', '=', 'hr.applicant'),
            ('res_id', '=', self.id),
            ('aria_document_kind', '=', 'contract'),
        ]))

    def _aria_dna_status(self):
        self.ensure_one()
        configured = self.env['ir.config_parameter'].sudo().get_param(
            'aria_recruitment.dna_adapter',
            'fake',
        ) or 'fake'
        status = resolve_adapter(configured).integration_status(self)
        return (status or '').strip()

    def _aria_stage_target(self, value):
        stage = self.env['hr.recruitment.stage']
        if not value:
            return stage
        if isinstance(value, models.BaseModel):
            return value.exists()
        return stage.browse(int(value)).exists()

    def _aria_is_hired_stage(self, stage):
        return bool(stage) and bool(stage.aria_stage_key == 'hired' or stage.hired_stage)

    def _aria_decide(self, target):
        self.ensure_one()
        tampered = bool(target) and bool(target.hired_stage) and target.aria_stage_key != 'hired'
        to_key = 'hired' if self._aria_is_hired_stage(target) else (target.aria_stage_key or '')
        return decide_stage(
            from_key=self.stage_id.aria_stage_key or '',
            to_key=to_key,
            contract_attached=self._aria_contract_attached() if target else False,
            dna_status=self._aria_dna_status() if target else '',
            same_stage=bool(target) and target == self.stage_id,
            clearing=not target,
            target_tampered=tampered,
        )

    def _aria_record_transition(self, from_stage, to_stage, decision):
        """Write the audit and the chatter note for one attempt.

        Allowed attempts stay in the business transaction. Refused attempts
        are committed on their own cursor so a later rollback (RPC error,
        import savepoint, or the test runner) still keeps the record.
        There is no context flag that skips the gate.
        """
        self.ensure_one()
        body = Markup(
            '<p>ARIA_TRANSITION result=%(result)s from=%(frm)s to=%(to)s '
            'user=%(user)s reason=%(reason)s</p>'
        ) % {
            'result': decision.result,
            'frm': decision.from_key or '-',
            'to': decision.to_key or '-',
            'user': self.env.user.display_name,
            'reason': decision.reason,
        }
        vals = {
            'applicant_res_id': self.id if isinstance(self.id, int) else 0,
            'user_id': self.env.uid,
            'transitioned_at': fields.Datetime.now(),
            'from_stage_id': from_stage.id if from_stage else False,
            'to_stage_id': to_stage.id if to_stage else False,
            'from_stage_key': decision.from_key,
            'to_stage_key': decision.to_key,
            'result': decision.result,
            'reason': decision.reason,
            'sudo_used': bool(self.env.su),
        }
        if not decision.allowed:
            vals['applicant_id'] = self.id if isinstance(self.id, int) else False
            self.env['aria.recruitment.transition.audit'].sudo().create(vals)
            self.message_post(body=body, message_type='comment', subtype_xmlid='mail.mt_note')
            try:
                self._aria_commit_refusal(vals, body)
            except Exception:
                # The business transaction still has the audit. A second
                # connection is only there so a later full rollback keeps a copy.
                pass
            return
        vals['applicant_id'] = self.id
        self.env['aria.recruitment.transition.audit'].sudo().create(vals)
        self.message_post(body=body, message_type='comment', subtype_xmlid='mail.mt_note')

    def _aria_commit_refusal(self, vals, body):
        """Persist a refused attempt outside the caller's transaction.

        A separate cursor is required because Odoo rolls the business
        transaction back when the refusal is raised (RPC, import savepoint,
        and the test runner's assertRaises). The audit stores the applicant
        id as an integer so it does not wait on the caller's row lock.
        """
        registry = self.env.registry
        applicant_res_id = vals.get('applicant_res_id') or 0
        with registry.cursor() as cr:
            env = api.Environment(cr, self.env.uid, {})
            audit_vals = dict(vals)
            audit_vals['applicant_id'] = False
            env['aria.recruitment.transition.audit'].sudo().create(audit_vals)
            env['mail.message'].sudo().with_context(
                mail_create_nosubscribe=True,
                mail_notify_force_send=False,
                tracking_disable=True,
            ).create({
                'model': 'hr.applicant',
                'res_id': applicant_res_id,
                'body': str(body),
                'message_type': 'comment',
                'subtype_id': env.ref('mail.mt_note').id,
                'author_id': env.user.partner_id.id,
                'email_from': 'aria-audit@example.test',
                'reply_to': 'aria-audit@example.test',
            })
            cr.commit()

    @api.model
    def _aria_record_orphan(self, decision, to_stage):
        self.env['aria.recruitment.transition.audit'].sudo().create({
            'user_id': self.env.uid,
            'transitioned_at': fields.Datetime.now(),
            'to_stage_id': to_stage.id if to_stage else False,
            'from_stage_key': decision.from_key,
            'to_stage_key': decision.to_key,
            'result': decision.result,
            'reason': decision.reason,
            'sudo_used': bool(self.env.su),
        })

    def _aria_first_open_stage(self):
        self.ensure_one()
        domain = [('fold', '=', False)]
        if self.job_id:
            domain = ['|', ('job_ids', '=', False), ('job_ids', '=', self.job_id.id)] + domain
        else:
            domain.append(('job_ids', '=', False))
        return self.env['hr.recruitment.stage'].search(domain, order='sequence, id', limit=1)

    def _aria_note_sequence_hijack(self):
        """A folded-off Hired stage sorted first must not become the default."""
        self.ensure_one()
        first = self._aria_first_open_stage()
        if not self._aria_is_hired_stage(first):
            return
        to_rate = self.env['hr.recruitment.stage'].search([('aria_stage_key', '=', 'to_rate')], limit=1)
        if self._aria_is_hired_stage(self.stage_id) and to_rate:
            super(HrApplicant, self).write({'stage_id': to_rate.id})
        decision = TransitionDecision(
            False,
            'hire refused: stage sequence cannot place an applicant in Hired',
            '',
            'hired',
        )
        self._aria_record_transition(self.env['hr.recruitment.stage'], first, decision)

    @api.depends('job_id')
    def _compute_stage(self):
        previous = {applicant.id: applicant.stage_id for applicant in self}
        super()._compute_stage()
        to_rate = self.env['hr.recruitment.stage'].search([
            ('aria_stage_key', '=', 'to_rate'),
        ], limit=1)
        for applicant in self:
            if previous.get(applicant.id):
                continue
            if to_rate and self._aria_is_hired_stage(applicant.stage_id):
                applicant.stage_id = to_rate

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if not vals.get('stage_id'):
                continue
            target = self._aria_stage_target(vals['stage_id'])
            decision = decide_stage(
                from_key='',
                to_key='hired' if self._aria_is_hired_stage(target) else (target.aria_stage_key or ''),
                contract_attached=False,
                dna_status='pending',
                clearing=not target,
                target_tampered=bool(target) and bool(target.hired_stage) and target.aria_stage_key != 'hired',
            )
            if not decision.allowed:
                self._aria_record_orphan(decision, target)
                raise ValidationError(decision.reason)
        records = super().create(vals_list)
        for record, vals in zip(records, vals_list):
            if vals.get('stage_id'):
                target = self._aria_stage_target(vals['stage_id'])
                if target and record.stage_id != target and not self._aria_is_hired_stage(target):
                    super(HrApplicant, record).write({'stage_id': target.id})
            else:
                record._aria_note_sequence_hijack()
        return records

    def write(self, vals):
        if 'stage_id' not in vals:
            return super().write(vals)
        target = self._aria_stage_target(vals.get('stage_id'))
        moves = []
        noops = self.env['hr.applicant']
        for applicant in self:
            if target and applicant.stage_id == target:
                noops |= applicant
                continue
            decision = applicant._aria_decide(target)
            moves.append((applicant, decision))
        for applicant, decision in moves:
            applicant._aria_record_transition(applicant.stage_id, target, decision)
        allowed = self.env['hr.applicant']
        refused = []
        for applicant, decision in moves:
            if decision.allowed:
                allowed |= applicant
            else:
                refused.append(decision.reason)
        for applicant in noops:
            super(HrApplicant, applicant).write(dict(vals))
        for applicant in allowed:
            super(HrApplicant, applicant).write(dict(vals))
        if refused:
            raise ValidationError(refused[0])
        return True

    @api.model
    def _aria_preview_imports(self, fields, data):
        paths = [field.split('/') for field in fields]
        dbid_index = None
        xmlid_index = None
        stage_index = None
        stage_mode = None
        for index, parts in enumerate(paths):
            if parts == ['.id']:
                dbid_index = index
            elif parts == ['id']:
                xmlid_index = index
            elif parts and parts[0] == 'stage_id':
                stage_index = index
                if parts == ['stage_id', '.id']:
                    stage_mode = 'dbid'
                elif parts == ['stage_id', 'id']:
                    stage_mode = 'xmlid'
                else:
                    stage_mode = 'name'
        if stage_index is None:
            return []
        previews = []
        Stage = self.env['hr.recruitment.stage']
        for row in data:
            if stage_index >= len(row) or not row[stage_index]:
                continue
            raw_stage = row[stage_index]
            if stage_mode == 'dbid':
                target = Stage.browse(int(raw_stage)).exists()
            elif stage_mode == 'xmlid':
                target = self.env.ref(raw_stage, raise_if_not_found=False)
            else:
                target = Stage.search([('name', '=', raw_stage)], limit=1)
            applicant = self.env['hr.applicant']
            if dbid_index is not None and dbid_index < len(row) and row[dbid_index]:
                applicant = self.browse(int(row[dbid_index])).exists()
            elif xmlid_index is not None and xmlid_index < len(row) and row[xmlid_index]:
                applicant = self.env.ref(row[xmlid_index], raise_if_not_found=False)
            if applicant:
                decision = applicant._aria_decide(target)
                from_stage = applicant.stage_id
            else:
                decision = decide_stage(
                    from_key='',
                    to_key='hired' if (target and (target.aria_stage_key == 'hired' or target.hired_stage)) else (target.aria_stage_key or ''),
                    contract_attached=False,
                    dna_status='pending',
                    clearing=not target,
                    target_tampered=bool(target) and bool(target.hired_stage) and target.aria_stage_key != 'hired',
                )
                from_stage = Stage
            previews.append({
                'applicant_id': applicant.id if applicant else False,
                'from_stage': from_stage,
                'to_stage': target,
                'decision': decision,
            })
        return previews

    @api.model
    def load(self, fields, data):
        """Import goes through create/write, which enforce the gate.

        A refused row rolls back inside ``load``'s savepoint, including the
        audit written by ``write``. Record that attempt again after ``load``
        returns so the refusal survives the rollback.
        """
        previews = self._aria_preview_imports(fields, data)
        audit = self.env['aria.recruitment.transition.audit'].sudo()
        before = {}
        for preview in previews:
            if not preview['applicant_id'] or preview['decision'].noop:
                continue
            before[preview['applicant_id']] = audit.search_count([
                ('applicant_id', '=', preview['applicant_id']),
                ('to_stage_key', '=', preview['decision'].to_key),
                ('result', '=', preview['decision'].result),
            ])
        result = super().load(fields, data)
        self.env.invalidate_all()
        for preview in previews:
            decision = preview['decision']
            if decision.noop:
                continue
            applicant = self.browse(preview['applicant_id']).exists() if preview['applicant_id'] else self.browse()
            if applicant:
                count = audit.search_count([
                    ('applicant_id', '=', applicant.id),
                    ('to_stage_key', '=', decision.to_key),
                    ('result', '=', decision.result),
                ])
                if count == before.get(applicant.id, 0):
                    applicant._aria_record_transition(preview['from_stage'], preview['to_stage'], decision)
            elif not decision.allowed:
                self._aria_record_orphan(decision, preview['to_stage'])
        return result
