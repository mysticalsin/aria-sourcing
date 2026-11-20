"""Create the synthetic company data the Playwright journey signs in as.

Demo data stays off. Nothing here is a real person, a real company, or a
credential for a deployed database. The DNA adapter is set to ``fake`` only
for this disposable database.
"""
import json
import os
from pathlib import Path

PASSWORD = os.environ["ARIA_E2E_PASSWORD"]


def _groups(*xmlids):
    return [(4, env.ref(xmlid).id) for xmlid in xmlids]


env["ir.config_parameter"].sudo().set_param("aria_recruitment.dna_adapter", "fake")

Users = env["res.users"].with_context(no_reset_password=True, mail_create_nolog=True, mail_notrack=True)
manager = Users.create({
    "name": "HR Manager Example",
    "login": "hr.manager@example.test",
    "password": PASSWORD,
    "group_ids": _groups(
        "base.group_user",
        "hr.group_hr_user",
        "hr_recruitment.group_hr_recruitment_manager",
    ),
})
recruiter = Users.create({
    "name": "Recruiter Example",
    "login": "recruiter@example.test",
    "password": PASSWORD,
    "group_ids": _groups(
        "base.group_user",
        "hr_recruitment.group_hr_recruitment_user",
    ),
})
dna_user = Users.create({
    "name": "DNA Integration Example",
    "login": "dna.integration@example.test",
    "password": PASSWORD,
    "group_ids": _groups(
        "base.group_user",
        "hr_recruitment.group_hr_recruitment_user",
        "aria_recruitment.group_dna_integration",
    ),
})

job = env["hr.job"].with_context(mail_create_nolog=True).create({
    "name": "Synthetic Need NEED-SYN-1001",
})
to_rate = env["hr.recruitment.stage"].search([("aria_stage_key", "=", "to_rate")], limit=1)
applicant = env["hr.applicant"].with_context(
    mail_create_nosubscribe=True,
    mail_create_nolog=True,
    tracking_disable=True,
).create({
    "partner_name": "Ada Example",
    "email_from": "ada.example@example.test",
    "job_id": job.id,
    "stage_id": to_rate.id,
    "aria_smart_need_id": "NEED-SYN-1001",
    "aria_smart_candidate_id": "CAND-SYN-2002",
    "aria_utm_link": "https://example.test/aria?utm_source=synthetic",
})
if applicant.stage_id.aria_stage_key != "to_rate":
    raise SystemExit(f"applicant landed on {applicant.stage_id.aria_stage_key}, expected to_rate")

action = env.ref("aria_recruitment.action_transition_audit")
state = {
    "applicant_id": applicant.id,
    "applicant_name": "Ada Example",
    "audit_action_id": action.id,
    "users": {
        "manager": {"login": manager.login, "password": PASSWORD, "name": manager.name},
        "recruiter": {"login": recruiter.login, "password": PASSWORD, "name": recruiter.name},
        "dna": {"login": dna_user.login, "password": PASSWORD, "name": dna_user.name},
    },
}
Path("/opt/e2e-state/state.json").write_text(json.dumps(state), encoding="utf-8")
env.cr.commit()
print("E2E_READY", applicant.id)
