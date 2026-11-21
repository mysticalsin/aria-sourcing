from odoo.tests import tagged

from .common import AriaRecruitmentCommon

FILTERS = {
    'need_consulting': "('aria_need_type', '=', 'consulting')",
    'need_staff': "('aria_need_type', '=', 'staff')",
    'need_business': "('aria_need_segment', '=', 'business')",
    'need_corporate': "('aria_need_segment', '=', 'corporate')",
    'need_active': "('aria_need_category', '=', 'active')",
    'need_strategic': "('aria_need_category', '=', 'strategic')",
    'need_anticipated': "('aria_need_status', '=', 'anticipated')",
    'need_waiting': "('aria_need_status', '=', 'waiting')",
    'need_running': "('aria_need_status', '=', 'running')",
    'need_closed': "('aria_need_status', '=', 'closed')",
    'need_p1': "('aria_need_priority', '=', 'p1')",
    'need_p2': "('aria_need_priority', '=', 'p2')",
    'need_p3': "('aria_need_priority', '=', 'p3')",
    'need_p4': "('aria_need_priority', '=', 'p4')",
}


@tagged('post_install', '-at_install', 'aria_recruitment')
class TestJobOffers(AriaRecruitmentCommon):
    def test_job_offer_fields_roundtrip(self):
        language = self.env['aria.recruitment.language'].create({'name': 'Portuguese'})
        job_field = self.env['aria.recruitment.job.field'].create({'name': 'Mechanical design'})
        client = self.env['res.partner'].create({
            'name': 'Synthetic Client SA',
            'is_company': True,
            'email': 'client@example.test',
        })
        job = self.env['hr.job'].create({
            'name': 'Synthetic Job Offer',
            'aria_smart_need_id': 'NEED-SYN-2002',
            'aria_language_ids': [(6, 0, [language.id])],
            'aria_job_field_ids': [(6, 0, [job_field.id])],
            'aria_experience_level': 'senior',
            'aria_location': 'Sao Paulo',
            'aria_client_id': client.id,
            'aria_contract_type': 'cnpj',
            'aria_need_type': 'consulting',
            'aria_need_segment': 'business',
            'aria_need_category': 'active',
            'aria_need_status': 'running',
            'aria_need_priority': 'p2',
        })
        self.assertEqual(job.aria_language_ids, language)
        self.assertEqual(job.aria_job_field_ids, job_field)
        self.assertEqual(job.aria_experience_level, 'senior')
        self.assertEqual(job.aria_location, 'Sao Paulo')
        self.assertEqual(job.aria_client_id, client)
        self.assertEqual(job.aria_contract_type, 'cnpj')
        self.assertEqual(job.aria_smart_need_id, 'NEED-SYN-2002')
        self.assertEqual(job.aria_need_type, 'consulting')
        self.assertEqual(job.aria_need_segment, 'business')
        self.assertEqual(job.aria_need_category, 'active')
        self.assertEqual(job.aria_need_status, 'running')
        self.assertEqual(job.aria_need_priority, 'p2')

    def test_need_search_filters(self):
        consulting = self.env['hr.job'].create({
            'name': 'Synthetic Consulting Need',
            'aria_need_type': 'consulting',
            'aria_need_segment': 'business',
            'aria_need_category': 'active',
            'aria_need_status': 'running',
            'aria_need_priority': 'p1',
        })
        staff = self.env['hr.job'].create({
            'name': 'Synthetic Staff Need',
            'aria_need_type': 'staff',
            'aria_need_segment': 'corporate',
            'aria_need_category': 'strategic',
            'aria_need_status': 'anticipated',
            'aria_need_priority': 'p4',
        })
        found = self.env['hr.job'].search([
            ('aria_need_type', '=', 'staff'),
            ('aria_need_segment', '=', 'corporate'),
            ('aria_need_category', '=', 'strategic'),
            ('aria_need_status', '=', 'anticipated'),
            ('aria_need_priority', '=', 'p4'),
        ])
        self.assertIn(staff, found)
        self.assertNotIn(consulting, found)

        arch = self.env.ref('aria_recruitment.view_hr_job_search_aria').arch
        compact = ''.join(arch.split())
        for name, domain in FILTERS.items():
            self.assertIn(f'name="{name}"', arch)
            self.assertIn(''.join(domain.split()), compact)

        for name, domain in FILTERS.items():
            # The domain snippet is a tuple literal stored in the view.
            records = self.env['hr.job'].search([eval(domain)])  # noqa: S307 - domain is our own literal
            if name.startswith('need_p4') or name in {
                'need_staff', 'need_corporate', 'need_strategic', 'need_anticipated',
            }:
                self.assertIn(staff, records)
                self.assertNotIn(consulting, records)
            if name in {'need_consulting', 'need_business', 'need_active', 'need_running', 'need_p1'}:
                self.assertIn(consulting, records)
                self.assertNotIn(staff, records)
