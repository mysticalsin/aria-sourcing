import logging
import secrets
from datetime import timedelta

from markupsafe import Markup

from odoo import SUPERUSER_ID, api, fields, models
from odoo.exceptions import AccessError, UserError, ValidationError

from .dna_adapter import resolve_adapter
from .state_machine import DNA_PASSING_STATUSES, TransitionDecision, decide_stage

_logger = logging.getLogger(__name__)

INTERVIEW_STAGE_KEYS = ('to_interview', 'shoot', 'qm')
ITW_KINDS = ('itw1', 'itw2', 'itw3_signature')
REFUSAL_COALESCE_SECONDS = 120
PDF_MIMETYPE = 'application/pdf'


class HrApplicant(models.Model):
    _inherit = 'hr.applicant'

    aria_smart_need_id = fields.Char(string='Smart need id', index=True, copy=False)
    aria_smart_candidate_id = fields.Char(string='Smart candidate id', index=True, copy=False)
    aria_utm_link = fields.Char(string='Aria source / UTM link')
    aria_dna_adapter_name = fields.Char(
        string='DNA adapter',
        compute='_compute_aria_dna_adapter_name',
        groups='aria_recruitment.group_dna_integration,base.group_system',
        help='The configured DNA adapter. Production stays unconfigured until an operator sets aria_recruitment.dna_adapter. The fake adapter is test and demo only.',
    )
    aria_opt_out = fields.Boolean(string='Opt out', copy=False, help='When set, outreach is refused and the refusal is audited.')
    aria_erased = fields.Boolean(string='Erased', copy=False, readonly=True)
    aria_erased_at = fields.Datetime(string='Erased at', copy=False, readonly=True)
    aria_retention_deadline = fields.Date(string='Retention deadline', copy=False)
    aria_contract_filename = fields.Char(string='Contract filename')
    aria_contract_pdf = fields.Binary(
        string='Contract PDF',
        attachment=False,
        help='Uploading a PDF here registers it as the contract document. Only a recruitment manager or HR user can do that.',
    )
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
        groups='aria_recruitment.group_dna_integration,base.group_system',
        help=(
            'Read by the fake DNA adapter only when aria_recruitment.dna_adapter '
            'is set to fake. Recruiters cannot write this. With no adapter '
            'configured, the hire gate fails closed.'
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

    @api.depends_context('uid')
    def _compute_aria_dna_adapter_name(self):
        configured = (self.env['ir.config_parameter'].sudo().get_param(
            'aria_recruitment.dna_adapter',
            '',
        ) or '').strip() or 'unconfigured'
        for applicant in self:
            applicant.aria_dna_adapter_name = configured

    def _aria_audit_gdpr(self, reason, result='allowed'):
        """Audit a GDPR action without copying personal data into the reason."""
        self.ensure_one()
        vals = {
            'applicant_id': self.id,
            'applicant_res_id': self.id,
            'company_id': self.company_id.id or self.env.company.id,
            'user_id': self.env.uid,
            'transitioned_at': fields.Datetime.now(),
            'from_stage_id': self.stage_id.id,
            'to_stage_id': self.stage_id.id,
            'from_stage_key': self.stage_id.aria_stage_key or '',
            'to_stage_key': self.stage_id.aria_stage_key or '',
            'result': result,
            'reason': reason,
            'sudo_used': bool(self.env.su),
            'event_kind': 'gdpr',
        }
        self.env['aria.recruitment.transition.audit'].sudo().create(vals)
        if result == 'refused':
            try:
                self._aria_commit_refusal(vals, '')
            except Exception:
                _logger.exception('Aria GDPR refusal audit failed to commit')

    def _aria_record_opt_outs(self, applicants):
        for applicant in applicants:
            applicant._aria_audit_gdpr('opt-out recorded')

    def _aria_blocks_outreach(self):
        """Return a fixed reason when this person must not be contacted."""
        self.ensure_one()
        if self.aria_erased:
            return 'outreach blocked: personal data was erased'
        if self.aria_opt_out:
            return 'outreach blocked by opt-out'
        if self._aria_is_hired_outcome():
            return 'outreach blocked: applicant is hired'
        return False

    def _aria_refuse_outreach(self):
        for applicant in self:
            reason = applicant._aria_blocks_outreach()
            if not reason:
                continue
            applicant._aria_audit_gdpr(reason, result='refused')
            raise UserError(reason)
        return False

    def _aria_message_is_outbound(self, values):
        """True when this post would leave the database as mail to the person."""
        message_type = values.get('message_type') or 'notification'
        if message_type in ('email', 'email_outgoing'):
            return True
        subtype_xmlid = values.get('subtype_xmlid')
        if subtype_xmlid == 'mail.mt_note':
            return False
        if subtype_xmlid == 'mail.mt_comment':
            return True
        subtype_id = values.get('subtype_id')
        if subtype_id:
            comment = self.env.ref('mail.mt_comment', raise_if_not_found=False)
            note = self.env.ref('mail.mt_note', raise_if_not_found=False)
            if note and subtype_id == note.id:
                return False
            if comment and subtype_id == comment.id:
                return True
        return bool(values.get('partner_ids')) and message_type == 'comment'

    def _aria_redact_chatter(self):
        """Replace stored messages with a stub that has no personal data."""
        self.ensure_one()
        messages = self.env['mail.message'].sudo().search([
            ('model', '=', 'hr.applicant'),
            ('res_id', '=', self.id),
        ])
        if not messages:
            return
        tracking = self.env['mail.tracking.value'].sudo().search([
            ('mail_message_id', 'in', messages.ids),
        ])
        if tracking:
            tracking.unlink()
        messages.write({
            'body': Markup('<p>personal data erased</p>'),
            'subject': False,
            'email_from': False,
            'reply_to': False,
            'record_name': 'Erased',
        })

    def _aria_drop_contract_files(self):
        attachments = self.env['ir.attachment'].sudo().search([
            ('res_model', '=', 'hr.applicant'),
            ('res_id', '=', self.id),
            ('aria_document_kind', '=', 'contract'),
        ])
        if attachments:
            attachments.unlink()

    def _aria_erase_personal_data(self):
        self.ensure_one()
        if self.aria_erased:
            return
        super(HrApplicant, self).write({
            'partner_name': 'Erased',
            'email_from': False,
            'partner_phone': False,
            'linkedin_profile': False,
            'applicant_notes': False,
            'aria_smart_candidate_id': False,
            'aria_utm_link': False,
            'aria_contract_filename': False,
            'aria_contract_pdf': False,
            'aria_erased': True,
            'aria_erased_at': fields.Datetime.now(),
        })
        partner = self.partner_id
        if partner and not partner.user_ids:
            partner.sudo().write({
                'name': 'Erased',
                'email': False,
                'phone': False,
            })
        self._aria_drop_contract_files()
        self._aria_redact_chatter()

    def action_aria_outreach(self):
        self._aria_refuse_outreach()
        for applicant in self:
            applicant._aria_audit_gdpr('outreach permitted')
        return True

    def action_aria_approve_outreach(self):
        """Refuse a new outreach approval once the person opted out, was erased, or is hired."""
        self._aria_refuse_outreach()
        for applicant in self:
            applicant._aria_audit_gdpr('outreach approval permitted')
        return True

    def message_post(self, **kwargs):
        if self._aria_message_is_outbound(kwargs):
            self._aria_refuse_outreach()
        return super().message_post(**kwargs)

    def _aria_install_hire_guard(self):
        """Block a direct SQL move onto Hired unless the adapter and contract pass.

        The guard calls aria_recruitment_dna_adapter_status(). That function
        returns the status recorded by resolve_adapter for this transaction.
        A direct update that did not call the adapter fails closed. The
        contract must contain bytes: a zero-length row with a store name does
        not count.
        """
        self.env.cr.execute(
            """
            CREATE OR REPLACE FUNCTION aria_recruitment_dna_adapter_status()
            RETURNS text
            LANGUAGE plpgsql
            AS $dna$
            DECLARE
                configured text;
                called_name text;
                called_status text;
            BEGIN
                SELECT btrim(value) INTO configured
                  FROM ir_config_parameter
                 WHERE key = 'aria_recruitment.dna_adapter'
                 LIMIT 1;
                configured := COALESCE(configured, '');
                IF configured = '' OR configured IN ('unconfigured', 'none') THEN
                    RETURN 'unconfigured';
                END IF;
                called_name := COALESCE(current_setting('aria.dna_adapter', true), '');
                called_status := btrim(COALESCE(current_setting('aria.dna_status', true), ''));
                IF called_name = configured AND called_status <> '' THEN
                    RETURN called_status;
                END IF;
                RETURN 'missing-adapter';
            END;
            $dna$
            """
        )
        self.env.cr.execute(
            """
            CREATE OR REPLACE FUNCTION aria_recruitment_hire_guard()
            RETURNS trigger
            LANGUAGE plpgsql
            AS $guard$
            DECLARE
                hired boolean;
                dna text;
                has_contract boolean;
            BEGIN
                IF TG_OP = 'UPDATE' AND NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
                    RETURN NEW;
                END IF;
                SELECT (COALESCE(aria_stage_key, '') = 'hired' OR COALESCE(hired_stage, false))
                  INTO hired
                  FROM hr_recruitment_stage
                 WHERE id = NEW.stage_id;
                IF NOT COALESCE(hired, false) THEN
                    RETURN NEW;
                END IF;
                dna := btrim(COALESCE(aria_recruitment_dna_adapter_status(), ''));
                SELECT EXISTS (
                    SELECT 1
                      FROM ir_attachment
                     WHERE res_model = 'hr.applicant'
                       AND res_id = NEW.id
                       AND aria_document_kind = 'contract'
                       AND (
                            COALESCE(octet_length(db_datas), 0) > 0
                            OR (
                                COALESCE(file_size, 0) > 0
                                AND COALESCE(store_fname, '') <> ''
                            )
                       )
                ) INTO has_contract;
                IF dna NOT IN ('integrated', 'complete')
                   OR NOT COALESCE(has_contract, false) THEN
                    RAISE EXCEPTION 'hire refused: a signed contract and cleared DNA are required'
                        USING ERRCODE = 'check_violation';
                END IF;
                RETURN NEW;
            END;
            $guard$
            """
        )
        self.env.cr.execute("DROP TRIGGER IF EXISTS aria_recruitment_hire_guard_trg ON hr_applicant")
        self.env.cr.execute(
            """
            CREATE TRIGGER aria_recruitment_hire_guard_trg
            BEFORE INSERT OR UPDATE OF stage_id ON hr_applicant
            FOR EACH ROW
            EXECUTE FUNCTION aria_recruitment_hire_guard()
            """
        )

    def init(self):
        self.env.cr.execute(
            """
            SELECT 1
              FROM information_schema.columns
             WHERE table_name = 'ir_attachment'
               AND column_name = 'aria_document_kind'
            """
        )
        if self.env.cr.fetchone():
            self._aria_install_hire_guard()

    def action_aria_erase(self):
        for applicant in self:
            if applicant.aria_erased:
                continue
            applicant._aria_erase_personal_data()
            applicant._aria_audit_gdpr('personal data erased')
        return True

    def action_aria_apply_retention(self):
        today = fields.Date.context_today(self)
        for applicant in self:
            deadline = applicant.aria_retention_deadline
            if applicant.aria_erased or not deadline or deadline > today:
                continue
            applicant._aria_erase_personal_data()
            applicant._aria_audit_gdpr('retention applied')
        return True

    def _aria_register_contract_upload(self, vals):
        """Turn a form upload into a contract attachment under the caller's rights."""
        datas = vals.get('aria_contract_pdf')
        if not datas:
            return
        filename = vals.get('aria_contract_filename') or 'contract.pdf'
        if not isinstance(filename, str) or not filename.strip():
            filename = 'contract.pdf'
        mimetype = 'application/pdf' if filename.lower().endswith('.pdf') else 'application/octet-stream'
        for applicant in self:
            self.env['ir.attachment'].create({
                'name': filename,
                'datas': datas,
                'mimetype': mimetype,
                'res_model': 'hr.applicant',
                'res_id': applicant.id,
                'type': 'binary',
                'aria_document_kind': 'contract',
            })

    def _aria_contract_attached(self):
        """A contract counts only when the stored file is non-empty."""
        self.ensure_one()
        attachments = self.env['ir.attachment'].sudo().search([
            ('res_model', '=', 'hr.applicant'),
            ('res_id', '=', self.id),
            ('aria_document_kind', '=', 'contract'),
        ])
        for attachment in attachments:
            payload = attachment.with_context(bin_size=False).db_datas
            if payload:
                return True
            if (attachment.file_size or 0) > 0 and (attachment.store_fname or ''):
                return True
        return False

    def _aria_can_set_dna(self):
        return bool(
            self.env.su
            or self.env.user.has_group('base.group_system')
            or self.env.user.has_group('aria_recruitment.group_dna_integration')
        )

    def _aria_dna_status(self):
        self.ensure_one()
        configured = (self.env['ir.config_parameter'].sudo().get_param(
            'aria_recruitment.dna_adapter',
            '',
        ) or '').strip()
        if not configured or configured in ('unconfigured', 'none'):
            return 'unconfigured'
        status = resolve_adapter(configured).integration_status(self.sudo())
        return (status or '').strip()

    def _aria_record_dna_adapter_call(self):
        """Call the DNA adapter and record its result for the database guard."""
        self.ensure_one()
        configured = (self.env['ir.config_parameter'].sudo().get_param(
            'aria_recruitment.dna_adapter',
            '',
        ) or '').strip()
        status = self._aria_dna_status()
        self.env.cr.execute(
            "SELECT set_config('aria.dna_adapter', %s, true), set_config('aria.dna_status', %s, true)",
            [configured, status or ''],
        )

    def _aria_clear_dna_adapter_call(self):
        self.env.cr.execute(
            "SELECT set_config('aria.dna_adapter', '', true), set_config('aria.dna_status', '', true)"
        )

    def _aria_is_hired_outcome(self):
        self.ensure_one()
        return bool(self.date_closed) or self._aria_is_hired_stage(self.stage_id)

    def _aria_hire_authorized(self):
        token = self.env.context.get('aria_hire_authorized')
        expected = getattr(self.env.registry, '_aria_hire_token', None)
        return bool(token) and token == expected

    def _aria_outcome_decision(self, vals):
        """Return ``(decision, target_stage)`` when this write touches a hire.

        ``None`` means the vals do not change stage and do not assert a hire.
        A hire date or ``application_status='hired'`` without the Hired stage
        is refused even when the contract and DNA checks would otherwise pass.
        """
        self.ensure_one()
        stage_in = 'stage_id' in vals
        date_in = 'date_closed' in vals and bool(vals.get('date_closed'))
        status_in = vals.get('application_status') == 'hired'
        if not stage_in and not date_in and not status_in:
            return None
        from_key = self.stage_id.aria_stage_key or ''
        if not stage_in and not self._aria_is_hired_outcome():
            return TransitionDecision(
                False,
                'hire refused: the hire date cannot be set without an authorised move to Hired',
                from_key,
                'hired',
            ), self.env['hr.recruitment.stage']
        if not stage_in:
            return TransitionDecision(
                True,
                'already hired',
                from_key,
                from_key or 'hired',
                noop=True,
            ), self.stage_id
        target = self._aria_stage_target(vals.get('stage_id'))
        return self._aria_decide(target), target

    def _aria_check_dna_write(self, vals):
        if 'aria_dna_integration_status' in vals and not self._aria_can_set_dna():
            raise AccessError('Only the DNA integration group can set the DNA status.')

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
            'company_id': (self.company_id.id or self.env.company.id),
            'user_id': self.env.uid,
            'transitioned_at': fields.Datetime.now(),
            'from_stage_id': from_stage.id if from_stage else False,
            'to_stage_id': to_stage.id if to_stage else False,
            'from_stage_key': decision.from_key,
            'to_stage_key': decision.to_key,
            'result': decision.result,
            'reason': decision.reason,
            'sudo_used': bool(self.env.su),
            'event_kind': 'stage',
        }
        if not decision.allowed and self._aria_coalesce_refusal(decision):
            return
        if not decision.allowed:
            vals['applicant_id'] = self.id if isinstance(self.id, int) else False
            self.env['aria.recruitment.transition.audit'].sudo().create(vals)
            self.message_post(body=body, message_type='comment', subtype_xmlid='mail.mt_note')
            try:
                self._aria_commit_refusal(vals, body)
            except Exception:
                _logger.exception('Aria hire-gate refusal audit failed to commit')
            return
        vals['applicant_id'] = self.id
        self.env['aria.recruitment.transition.audit'].sudo().create(vals)
        self.message_post(body=body, message_type='comment', subtype_xmlid='mail.mt_note')

    def _aria_coalesce_refusal(self, decision):
        """Collapse an identical recent refusal into the existing audit row."""
        if not isinstance(self.id, int):
            return False
        horizon = fields.Datetime.now() - timedelta(seconds=REFUSAL_COALESCE_SECONDS)
        existing = self.env['aria.recruitment.transition.audit'].sudo().search([
            ('applicant_res_id', '=', self.id),
            ('from_stage_key', '=', decision.from_key or ''),
            ('to_stage_key', '=', decision.to_key or ''),
            ('result', '=', 'refused'),
            ('reason', '=', decision.reason),
            ('transitioned_at', '>=', horizon),
        ], order='id desc', limit=1)
        if not existing:
            return False
        token = secrets.token_hex(16)
        self.env.registry._aria_audit_coalesce_token = token
        try:
            existing.with_context(aria_audit_coalesce=token).write({
                'attempt_count': (existing.attempt_count or 1) + 1,
                'transitioned_at': fields.Datetime.now(),
            })
        finally:
            self.env.registry._aria_audit_coalesce_token = None
        return True

    def _aria_commit_refusal(self, vals, body):
        """Persist a refused attempt outside the caller's transaction.

        Rows created in the caller's transaction (a user, a company) are not
        visible here. Keep the audit with only foreign keys that already
        exist, and log anything that still cannot be stored.
        """
        registry = self.env.registry
        try:
            with registry.cursor() as cr:
                env = api.Environment(cr, SUPERUSER_ID, {})
                audit_vals = dict(vals)
                audit_vals['applicant_id'] = False

                def visible(table, record_id):
                    if not record_id:
                        return False
                    cr.execute(f'SELECT 1 FROM {table} WHERE id = %s', (record_id,))
                    return bool(cr.fetchone())

                if not visible('res_users', audit_vals.get('user_id')):
                    _logger.error(
                        'Aria refusal audit user %s is not committed; the row keeps no personal foreign key',
                        audit_vals.get('user_id'),
                    )
                    audit_vals['user_id'] = SUPERUSER_ID
                if not visible('res_company', audit_vals.get('company_id')):
                    audit_vals['company_id'] = env.ref('base.main_company').id
                for field_name in ('from_stage_id', 'to_stage_id'):
                    if audit_vals.get(field_name) and not visible('hr_recruitment_stage', audit_vals[field_name]):
                        audit_vals[field_name] = False
                env['aria.recruitment.transition.audit'].sudo().create(audit_vals)
                env.flush_all()
                cr.commit()
        except Exception:
            _logger.exception('Aria hire-gate refusal audit failed to commit')
        return body

    @api.model
    def _aria_record_orphan(self, decision, to_stage):
        vals = {
            'applicant_id': False,
            'applicant_res_id': 0,
            'company_id': self.env.company.id,
            'user_id': self.env.uid,
            'transitioned_at': fields.Datetime.now(),
            'to_stage_id': to_stage.id if to_stage else False,
            'from_stage_key': decision.from_key,
            'to_stage_key': decision.to_key,
            'result': decision.result,
            'reason': decision.reason,
            'sudo_used': bool(self.env.su),
            'event_kind': 'stage',
        }
        body = Markup('<p>ARIA_TRANSITION result=%(result)s from=%(frm)s to=%(to)s reason=%(reason)s</p>') % {
            'result': decision.result,
            'frm': decision.from_key or '-',
            'to': decision.to_key or '-',
            'reason': decision.reason,
        }
        try:
            self._aria_commit_refusal(vals, body)
        except Exception:
            _logger.exception('Aria hire-gate refusal audit failed to commit')

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
            if vals.get('aria_contract_pdf'):
                record._aria_register_contract_upload(vals)
            if vals.get('stage_id'):
                target = self._aria_stage_target(vals['stage_id'])
                if target and record.stage_id != target and not self._aria_is_hired_stage(target):
                    super(HrApplicant, record).write({'stage_id': target.id})
            else:
                record._aria_note_sequence_hijack()
        return records

    @api.depends('stage_id.hired_stage')
    def _compute_date_closed(self):
        before = {applicant.id: applicant.date_closed for applicant in self}
        super()._compute_date_closed()
        if self._aria_hire_authorized():
            return
        for applicant in self:
            if applicant.date_closed and not before.get(applicant.id):
                applicant.date_closed = False

    def onchange(self, values, field_names, fields_spec, *args):
        result = super().onchange(values, field_names, fields_spec, *args)
        if self._aria_hire_authorized():
            return result
        value = (result or {}).get('value') or {}
        if not value:
            return result
        if value.get('date_closed') or value.get('application_status') == 'hired':
            value.pop('date_closed', None)
            if value.get('application_status') == 'hired':
                value['application_status'] = 'ongoing'
            result['value'] = value
        return result

    def create_employee_from_applicant(self):
        self.ensure_one()
        hired_stage = self._aria_is_hired_stage(self.stage_id)
        dna_ok = self._aria_dna_status() in DNA_PASSING_STATUSES
        if not (hired_stage and self._aria_contract_attached() and dna_ok):
            decision = TransitionDecision(
                False,
                'hire refused: creating an employee requires the hire gate',
                self.stage_id.aria_stage_key or '',
                'hired',
            )
            self._aria_record_transition(self.stage_id, self.env['hr.recruitment.stage'].search([
                ('aria_stage_key', '=', 'hired'),
            ], limit=1), decision)
            raise ValidationError(decision.reason)
        return super().create_employee_from_applicant()

    def write(self, vals):
        opting_out = self.filtered(lambda applicant: not applicant.aria_opt_out) if vals.get('aria_opt_out') else self.browse()
        if vals.get('aria_contract_pdf'):
            self._aria_register_contract_upload(vals)
        self._aria_check_dna_write(vals)
        if not any(key in vals for key in ('stage_id', 'date_closed', 'application_status')):
            result = super().write(vals)
            self._aria_record_opt_outs(opting_out)
            return result
        if 'application_status' in vals and not any(key in vals for key in ('stage_id', 'date_closed')):
            # Non-stored. An attempted hired status is a hire unless the person is already hired.
            if vals.get('application_status') == 'hired':
                decisions = []
                for applicant in self:
                    outcome = applicant._aria_outcome_decision(vals)
                    if outcome is None:
                        decisions.append((applicant, None, applicant.stage_id))
                    else:
                        decisions.append((applicant, outcome[0], outcome[1]))
                blocked = [
                    item for item in decisions
                    if item[1] is not None and not item[1].allowed and not item[1].noop
                ]
                if blocked:
                    self._aria_finish_refusals(blocked)
            vals = {key: value for key, value in vals.items() if key != 'application_status'}
            if not vals:
                return True
        decisions = []
        for applicant in self:
            outcome = applicant._aria_outcome_decision(vals)
            if outcome is None:
                decisions.append((applicant, None, None))
            else:
                decisions.append((applicant, outcome[0], outcome[1]))
        blocked = [item for item in decisions if item[1] is not None and not item[1].allowed and not item[1].noop]
        if blocked:
            audited = []
            for applicant, decision, target in decisions:
                if decision is None or decision.noop:
                    decision = TransitionDecision(
                        False,
                        'hire refused: the write was refused because another applicant in the batch failed the hire gate',
                        applicant.stage_id.aria_stage_key or '',
                        'hired',
                    )
                elif decision.allowed:
                    decision = TransitionDecision(
                        False,
                        'hire refused: the write was refused because another applicant in the batch failed the hire gate',
                        decision.from_key,
                        decision.to_key,
                    )
                audited.append((applicant, decision, target or applicant.stage_id))
            self._aria_finish_refusals(audited)
        token = secrets.token_hex(16)
        self.env.registry._aria_hire_token = token
        try:
            for applicant, decision, target in decisions:
                if decision is not None and not decision.noop:
                    applicant._aria_record_transition(applicant.stage_id, target, decision)
                calls_adapter = bool(
                    decision is not None
                    and decision.allowed
                    and not decision.noop
                    and target
                    and applicant._aria_is_hired_stage(target)
                )
                if calls_adapter:
                    applicant._aria_record_dna_adapter_call()
                try:
                    super(HrApplicant, applicant.with_context(aria_hire_authorized=token)).write(dict(vals))
                finally:
                    if calls_adapter:
                        applicant._aria_clear_dna_adapter_call()
        finally:
            self.env.registry._aria_hire_token = None
        self._aria_record_opt_outs(opting_out)
        return True

    def _aria_finish_refusals(self, decisions):
        for applicant, decision, target in decisions:
            applicant._aria_record_transition(applicant.stage_id, target, decision)
        raise ValidationError(decisions[0][1].reason)

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
