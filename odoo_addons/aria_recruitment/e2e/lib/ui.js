const fs = require('fs');
const path = require('path');
const { authenticate, state } = require('./odoo');
const { sessionCookie } = require('./session-cookie');

const shots = path.join(process.env.ARTIFACT_DIR, 'screenshots');
fs.mkdirSync(shots, { recursive: true });

async function shot(page, name) {
  await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
}

function withSessionCookie(header, session) {
  const kept = String(header || '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith('session_id='));
  kept.push(`session_id=${session}`);
  return kept.join('; ');
}

async function openLoggedIn(context, page, userKey) {
  const base = process.env.BASE_URL;
  const session = await authenticate(state.users[userKey].login);
  const browserName = context.browser() && context.browser().browserType().name();
  // WebKit refuses a cookie whose domain is an IP address. Visit the origin
  // first, then store the authenticated session with SameSite=Lax.
  if (browserName === 'webkit') {
    await page.goto(`${base}/web/health`, { waitUntil: 'domcontentloaded' });
    await context.clearCookies();
  }
  await context.addCookies([sessionCookie(session, base)]);
  const stored = await context.cookies(base);
  const cookie = stored.find((item) => item.name === 'session_id' && item.value === session);
  if (!cookie || cookie.sameSite !== 'Lax') {
    throw new Error(`session cookie was not stored for ${browserName || 'browser'}`);
  }
  if (browserName === 'webkit') {
    // The Lax cookie is kept for the document and omitted on the JSON-RPC
    // calls that follow, which Odoo answers with "Session Expired".
    const sid = { value: session };
    await context.route('**/*', async (route) => {
      const headers = { ...route.request().headers() };
      headers.cookie = withSessionCookie(headers.cookie, sid.value);
      const response = await route.fetch({ headers });
      for (const header of response.headersArray()) {
        if (header.name.toLowerCase() !== 'set-cookie') continue;
        const match = header.value.match(/session_id=([^;]+)/);
        if (match) sid.value = match[1];
      }
      await route.fulfill({ response });
    });
  }
  await page.goto(`${base}/odoo`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.o_main_navbar, .o_home_menu, .o_web_client', { timeout: 120000 });
  if (page.url().includes('/web/login')) {
    throw new Error(`session cookie was not accepted for ${userKey}`);
  }
}

async function startSession(browser, userKey) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await openLoggedIn(context, page, userKey);
  return { context, page };
}

async function login(context, page, userKey) {
  await openLoggedIn(context, page, userKey);
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
  shot, login, startSession, openApplicant, clickStage, currentStage, expectDialog, moveTo, chooseSelection, openAriaTab,
  sessionCookie,
};
