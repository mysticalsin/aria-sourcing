const fs = require('fs');
const path = require('path');
const { authenticate, state } = require('./odoo');
const { sessionCookie } = require('./session-cookie');

const shots = path.join(process.env.ARTIFACT_DIR, 'screenshots');
fs.mkdirSync(shots, { recursive: true });

async function shot(page, name) {
  await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
}

async function login(context, page, userKey) {
  const session = await authenticate(state.users[userKey].login);
  await context.clearCookies();
  await context.addCookies([sessionCookie(session, process.env.BASE_URL)]);
  await page.goto('/odoo', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.o_main_navbar, .o_home_menu, .o_web_client', { timeout: 120000 });
}

async function openApplicant(page, id = state.applicant_id) {
  await page.goto(`/odoo/${state.applicant_action_path}/${id}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('radio', { name: 'To Rate' }).or(page.getByRole('radio', { name: 'To Hire' })).or(page.getByRole('radio', { name: 'Hired' })).first().waitFor({ timeout: 60000 });
}

async function clickStage(page, label) {
  const radio = page.getByRole('radio', { name: label }).first();
  if (await radio.count() && await radio.isVisible()) {
    await radio.click();
    return;
  }
  await page.getByRole('button', { name: 'More...' }).click();
  await page.getByRole('menuitem', { name: label }).click();
}

async function currentStage(page) {
  const checked = page.getByRole('radio', { checked: true });
  return (await checked.first().innerText()).replace(/\s+/g, ' ').trim();
}

async function openAriaTab(page) {
  const tab = page.getByRole('tab', { name: 'Aria', exact: true });
  const marker = page.locator('div[name="aria_smart_need_id"]');
  await tab.click();
  try {
    await marker.waitFor({ state: 'visible', timeout: 5000 });
  } catch (error) {
    await tab.click();
    await marker.waitFor({ state: 'visible', timeout: 10000 });
  }
}

async function expectDialog(page, snippet) {
  const dialog = page.getByRole('dialog').filter({ hasText: snippet });
  await dialog.waitFor({ state: 'visible', timeout: 30000 });
  await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
  await dialog.waitFor({ state: 'hidden', timeout: 10000 });
}

async function chooseSelection(page, field, label) {
  const widget = page.locator(`div[name="${field}"]`);
  await widget.scrollIntoViewIfNeeded();
  const toggler = widget.locator('.o_select_menu_toggler, button, .o_input').first();
  await toggler.click({ timeout: 10000 });
  const exact = new RegExp(`^${label}$`);
  const option = page.locator('.o-dropdown-item, .dropdown-item, [role="option"], [role="menuitem"]').filter({ hasText: exact }).first();
  await option.click({ timeout: 10000 });
}

async function moveTo(page, label) {
  await clickStage(page, label);
  await page.getByRole('radio', { name: label, checked: true }).waitFor({ timeout: 30000 });
}

module.exports = {
  shot, login, openApplicant, clickStage, currentStage, expectDialog, moveTo, chooseSelection, openAriaTab,
  sessionCookie,
};
