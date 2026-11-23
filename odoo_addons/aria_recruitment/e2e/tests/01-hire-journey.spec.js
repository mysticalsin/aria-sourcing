const { test, expect } = require('@playwright/test');
const { state, json2 } = require('../lib/odoo');
const { shot, startSession, openApplicant, clickStage, currentStage, expectDialog, moveTo, chooseSelection, openAriaTab } = require('../lib/ui');

test.describe.configure({ mode: 'serial' });

let context;
let page;
let browserRef;
let applicantId = state.applicant_id;

async function useUser(userKey) {
  if (context) await context.close();
  ({ context, page } = await startSession(browserRef, userKey));
  await openApplicant(page, applicantId);
}

test.beforeAll(async ({ browser }, testInfo) => {
  browserRef = browser;
  const created = await json2('manager', 'hr.applicant', 'create', {
    vals_list: [{
      partner_name: `Ada ${testInfo.project.name}`,
      email_from: `ada.${testInfo.project.name}@example.test`,
      job_id: state.job_id,
      stage_id: state.stage_ids.to_rate,
      aria_smart_need_id: 'NEED-SYN-1001',
      aria_smart_candidate_id: `CAND-SYN-${testInfo.project.name}`,
    }],
  });
  if (!created.ok) throw new Error('could not create the journey applicant');
  applicantId = Array.isArray(created.result) ? created.result[0] : created.result;
  await useUser('recruiter');
});

test.afterAll(async () => {
  await context?.close();
});

test('moves the applicant from To Rate through To Hire', async () => {
  const stages = ['To Rate', 'To Assess', 'To Interview', 'Shoot', 'QM', 'To Hire'];
  await shot(page, '01-to-rate');
  for (const label of stages.slice(1)) {
    await moveTo(page, label);
    await shot(page, `stage-${label.toLowerCase().replace(/\s+/g, '-')}`);
  }
  expect(await currentStage(page)).toContain('To Hire');
});

test('refuses Hired when no contract is attached', async () => {
  await clickStage(page, 'Hired');
  await expectDialog(page, 'contract');
  await shot(page, 'hired-refused-no-contract');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('radio', { name: 'To Hire', checked: true }).waitFor({ timeout: 30000 });
});

test('HR manager attaches a synthetic contract PDF', async () => {
  await useUser('manager');
  await openAriaTab(page);
  await page.locator('div[name="aria_contract_pdf"] input[type="file"]').setInputFiles(process.env.CONTRACT_PDF);
  await page.getByRole('button', { name: 'Save manually' }).click();
  await expect(page.getByRole('button', { name: 'Save manually' })).toBeHidden({ timeout: 30000 });
  await shot(page, 'contract-attached');
});

test('refuses Hired when the fake adapter is still pending', async () => {
  await clickStage(page, 'Hired');
  await expectDialog(page, 'DNA');
  await shot(page, 'hired-refused-dna-pending');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('radio', { name: 'To Hire', checked: true }).waitFor({ timeout: 30000 });
});

test('DNA integration uses the fake adapter and refuses a failed status', async () => {
  await useUser('dna');
  await openAriaTab(page);
  const adapter = page.locator('div[name="aria_dna_adapter_name"]');
  await expect(adapter).toContainText('fake');
  await chooseSelection(page, 'aria_dna_integration_status', 'Failed');
  await clickStage(page, 'Hired');
  await expectDialog(page, 'DNA');
  await shot(page, 'hired-refused-dna-failed');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('radio', { name: 'To Hire', checked: true }).waitFor({ timeout: 30000 });
  await openAriaTab(page);
  await chooseSelection(page, 'aria_dna_integration_status', 'Integrated');
  await shot(page, 'dna-fake-integrated');
});

test('Hired succeeds after the contract and the fake DNA status', async () => {
  await useUser('manager');
  await clickStage(page, 'Hired');
  await expect(page.locator('div[name="stage_id"]')).toContainText('Hired', { timeout: 30000 });
  await shot(page, 'hired-success');
});

test('audit and chatter record the transitions', async () => {
  await openApplicant(page, applicantId);
  await page.locator('.o-mail-Chatter, .o_Chatter, .oe_chatter').first().waitFor({ timeout: 30000 });
  await expect(page.locator('body')).toContainText('ARIA_TRANSITION');
  await shot(page, 'chatter');
  await page.goto(`/odoo/action-${state.audit_action_id}`);
  await page.waitForSelector('.o_list_view', { timeout: 30000 });
  await expect(page.locator('.o_list_view')).toContainText('hired');
  await expect(page.locator('.o_list_view')).toContainText('refused');
  await shot(page, 'audit');
});

test('a recruiter cannot set the contract kind from the form', async () => {
  await useUser('recruiter');
  await openAriaTab(page);
  await expect(page.locator('div[name="aria_dna_integration_status"]')).toHaveCount(0);
  await page.locator('div[name="aria_contract_pdf"] input[type="file"]').setInputFiles(process.env.CONTRACT_PDF);
  await page.getByRole('button', { name: 'Save manually' }).click();
  await expectDialog(page, 'recruitment manager');
  await shot(page, 'recruiter-contract-refused');
});
