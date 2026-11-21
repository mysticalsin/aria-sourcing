"""Seed one synthetic company for the Playwright journey.

Demo data stays off. The password and API keys are written to files under
/opt/e2e-state and are not printed. state.json has logins and ids only.
"""
import datetime
import json
import os
from pathlib import Path

PASSWORD = os.environ["ARIA_E2E_PASSWORD"]
STATE = Path("/tmp/e2e-state")
KEYS = STATE / "keys"
KEYS.mkdir(parents=True, exist_ok=True)
STAGE_KEYS = (
    "to_rate",
    "to_assess",
    "to_interview",
    "shoot",
    "qm",
    "to_hire",
    "hired",
    "rejected",
    "withdrawn",
)


def groups(*xmlids):
    return [(4, env.ref(xmlid).id) for xmlid in xmlids]


def mint(user, name):
    expiration = datetime.datetime.now() + datetime.timedelta(days=1)
    key = env["res.users.apikeys"].with_user(user)._generate("rpc", name, expiration)
    path = KEYS / name
    path.write_text(key, encoding="utf-8")
    path.chmod(0o600)
    return path.name


env["ir.config_parameter"].sudo().set_param("aria_recruitment.dna_adapter", "fake")
env["ir.config_parameter"].sudo().set_param("base.enable_programmatic_api_keys", "1")

admin = env.ref("base.user_admin")
admin.password = PASSWORD

Users = env["res.users"].with_context(no_reset_password=True, mail_create_nolog=True, mail_notrack=True)
manager = Users.create({
    "name": "HR Manager Example",
    "login": "hr.manager@example.test",
    "password": PASSWORD,
    "group_ids": groups(
        "base.group_user",
        "hr.group_hr_user",
        "hr_recruitment.group_hr_recruitment_manager",
    ),
})
recruiter = Users.create({
    "name": "Recruiter Example",
    "login": "recruiter@example.test",
    "password": PASSWORD,
    "group_ids": groups(
        "base.group_user",
        "hr_recruitment.group_hr_recruitment_user",
    ),
})
dna_user = Users.create({
    "name": "DNA Integration Example",
    "login": "dna.integration@example.test",
    "password": PASSWORD,
    "group_ids": groups(
        "base.group_user",
        "hr_recruitment.group_hr_recruitment_user",
        "aria_recruitment.group_dna_integration",
    ),
})
plain = Users.create({
    "name": "Plain Example",
    "login": "plain.example@example.test",
    "password": PASSWORD,
    "group_ids": groups("base.group_user"),
})
other_company = env["res.company"].create({"name": "Synthetic Other Co"})
other_user = Users.create({
    "name": "Other Company Example",
    "login": "other.company@example.test",
    "password": PASSWORD,
    "company_id": other_company.id,
    "company_ids": [(6, 0, [other_company.id])],
    "group_ids": groups(
        "base.group_user",
        "hr_recruitment.group_hr_recruitment_manager",
    ),
})
interviewer = Users.create({
    "name": "Interviewer Example",
    "login": "interviewer@example.test",
    "password": PASSWORD,
    "group_ids": groups("hr_recruitment.group_hr_recruitment_interviewer"),
})

job = env["hr.job"].with_context(mail_create_nolog=True).create({
    "name": "Synthetic Need NEED-SYN-1001",
})
other_job = env["hr.job"].with_context(mail_create_nolog=True).create({
    "name": "Synthetic Other Team",
    "interviewer_ids": [(4, interviewer.id)],
})
stages = {
    key: env["hr.recruitment.stage"].search([("aria_stage_key", "=", key)], limit=1)
    for key in STAGE_KEYS
}
if any(not stage for stage in stages.values()):
    raise SystemExit("pipeline stages were not installed")

Applicant = env["hr.applicant"].with_context(
    mail_create_nosubscribe=True,
    mail_create_nolog=True,
    tracking_disable=True,
)
applicant = Applicant.create({
    "partner_name": "Ada Example",
    "email_from": "ada.example@example.test",
    "partner_phone": "+1 555 0101",
    "job_id": job.id,
    "stage_id": stages["to_rate"].id,
    "aria_smart_need_id": "NEED-SYN-1001",
    "aria_smart_candidate_id": "CAND-SYN-2002",
    "aria_utm_link": "https://example.test/aria?utm_source=synthetic",
})
if applicant.stage_id.aria_stage_key != "to_rate":
    raise SystemExit("applicant did not land on to_rate")
team_applicant = Applicant.create({
    "partner_name": "Team Example",
    "email_from": "team.example@example.test",
    "job_id": other_job.id,
    "stage_id": stages["to_rate"].id,
    "interviewer_ids": [(4, interviewer.id)],
})

for user, name in (
    (admin, "admin"),
    (manager, "manager"),
    (recruiter, "recruiter"),
    (dna_user, "dna"),
    (plain, "plain"),
    (other_user, "other"),
    (interviewer, "interviewer"),
):
    mint(user, name)

state = {
    "db": os.environ.get("ARIA_E2E_DB", "aria_e2e"),
    "job_id": job.id,
    "applicant_id": applicant.id,
    "applicant_name": "Ada Example",
    "team_applicant_id": team_applicant.id,
    "audit_action_id": env.ref("aria_recruitment.action_transition_audit").id,
    "applicant_action_path": "recruitment-applications",
    "stage_ids": {key: stage.id for key, stage in stages.items()},
    "users": {
        "admin": {"login": admin.login, "name": admin.name},
        "manager": {"login": manager.login, "name": manager.name},
        "recruiter": {"login": recruiter.login, "name": recruiter.name},
        "dna": {"login": dna_user.login, "name": dna_user.name},
        "plain": {"login": plain.login, "name": plain.name},
        "other": {"login": other_user.login, "name": other_user.name},
        "interviewer": {"login": interviewer.login, "name": interviewer.name},
    },
}
(STATE / "state.json").write_text(json.dumps(state), encoding="utf-8")
env.cr.commit()
print("E2E_READY", applicant.id)
