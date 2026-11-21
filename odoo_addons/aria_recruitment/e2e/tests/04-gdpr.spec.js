const { test, expect } = require('@playwright/test');
const { state, json2 } = require('../lib/odoo');
const { shot, login, openApplicant, expectDialog, openAriaTab } = require('../lib/ui');

test.describe.configure({ mode: 'serial' });

async function fresh(name, extra = {}) {
  const created = await json2('manager', 'hr.applicant', 'create', {
    vals_list: [{
      partner_name: name,
      email_from: `${name.split(' ')[0].toLowerCase()}.gdpr@example.test`,
      partner_phone: '+1 555 0199',
      job_id: state.job_id,
      stage_id: state.stage_ids.to_assess,
      ...extra,
    }],
  });
  expect(created.ok, created.message).toBeTruthy();
  return Array.isArray(created.result) ? created.result[0] : created.result;
}

test('opt-out blocks outreach and is audited', async ({ browser }) => {
  const id = await fresh('Opt Example');
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(context, page, 'manager');
  await openApplicant(page, id);
  await openAriaTab(page);
  await page.locator('div[name="aria_opt_out"] input').check();
  await page.locator('button[name="action_aria_outreach"]').click();
  await expectDialog(page, 'opt');
  await shot(page, 'gdpr-opt-out');
  const audits = await json2('manager', 'aria.recruitment.transition.audit', 'search_read', {
    domain: [['applicant_res_id', '=', id], ['event_kind', '=', 'gdpr']],
    fields: ['reason', 'result'],
  });
  expect(audits.ok, audits.message).toBeTruthy();
  const reasons = audits.result.map((row) => row.reason).join(' ');
  expect(reasons).toContain('opt-out');
  expect(reasons.toLowerCase()).not.toContain('opt.gdpr@example.test');
  await context.close();
});

test('erasure anonymises personal data and leaves an audit', async ({ browser }) => {
  const id = await fresh('Mina Example');
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(context, page, 'manager');
  await openApplicant(page, id);
  await openAriaTab(page);
  await page.locator('button[name="action_aria_erase"]').click();
  await page.locator('div[name="partner_name"], .o_form_view').first().waitFor();
  await expect(page.locator('body')).not.toContainText('Mina Example');
  await shot(page, 'gdpr-erasure');
  const read = await json2('manager', 'hr.applicant', 'read', {
    ids: [id],
    fields: ['partner_name', 'email_from', 'partner_phone', 'aria_erased'],
  });
  expect(read.result[0].aria_erased).toBeTruthy();
  expect(read.result[0].partner_name).not.toContain('Mina');
  expect(read.result[0].email_from).toBeFalsy();
  const audits = await json2('manager', 'aria.recruitment.transition.audit', 'search_read', {
    domain: [['applicant_res_id', '=', id], ['event_kind', '=', 'gdpr']],
    fields: ['reason'],
  });
  const blob = audits.result.map((row) => row.reason).join(' ');
  expect(blob).toContain('personal data erased');
  expect(blob).not.toContain('Mina');
  await context.close();
});

test('the retention action erases a due applicant and leaves the future one', async ({ browser }) => {
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const due = await fresh('Nia Example', { aria_retention_deadline: yesterday });
  const waiting = await fresh('Otto Example', { aria_retention_deadline: tomorrow });
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(context, page, 'manager');
  await openApplicant(page, due);
  await openAriaTab(page);
  await page.locator('button[name="action_aria_apply_retention"]').click();
  await expect(page.getByRole('checkbox', { name: 'Erased' })).toBeChecked();
  await shot(page, 'gdpr-retention');
  const dueRead = await json2('manager', 'hr.applicant', 'read', {
    ids: [due],
    fields: ['partner_name', 'aria_erased'],
  });
  const waitingRead = await json2('manager', 'hr.applicant', 'read', {
    ids: [waiting],
    fields: ['partner_name', 'aria_erased'],
  });
  expect(dueRead.result[0].aria_erased).toBeTruthy();
  expect(dueRead.result[0].partner_name).not.toContain('Nia');
  expect(waitingRead.result[0].aria_erased).toBeFalsy();
  expect(waitingRead.result[0].partner_name).toContain('Otto');
  const audits = await json2('manager', 'aria.recruitment.transition.audit', 'search_read', {
    domain: [['applicant_res_id', '=', due], ['event_kind', '=', 'gdpr']],
    fields: ['reason'],
  });
  expect(audits.result.map((row) => row.reason).join(' ')).toContain('retention');
  await context.close();
});
