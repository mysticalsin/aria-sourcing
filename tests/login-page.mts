import { readFileSync } from "fs";

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const login = readFileSync(new URL("../src/app/login/page.tsx", import.meta.url), "utf8");
const config = readFileSync(new URL("../src/lib/supabase/config.ts", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("../src/components/app/sidebar.tsx", import.meta.url), "utf8");

ok("login has no dead hash navigation", !login.includes('href="#"'));
ok("login removes the unbacked public navigation list", !login.includes("NAV_LINKS"));
ok("login loads no third-party background video", !login.includes("<video") && !/https?:\/\//.test(login));
ok("login keeps redirects same-origin", /const safeRedirect/.test(login) && login.includes('!r.startsWith("/\\\\")'));
ok("login form has the controlled id", login.includes('id="login-email-form"'));
ok("login fields carry visible labels", login.includes('label="Username or email"') && login.includes('label="Password"'));
ok("login errors are announced", (login.match(/role="alert"/g) ?? []).length >= 2);
ok(
  "Microsoft login is exposed only when the public Azure capability flag is enabled",
  /azureLoginEnabled/.test(login) &&
    /supabaseEnabled\s*&&\s*azureLoginEnabled/.test(login) &&
    /export const azureLoginEnabled/.test(config),
);
ok(
  "the email form is shown whenever an auth backend or the public demo exists",
  /const showForm = supabaseEnabled \|\| demoLoginEnabled/.test(login),
);
ok(
  "well-known demo credentials are prefilled only on an explicitly enabled public demo",
  /useState\(demoLoginEnabled\s*\?\s*"admin"\s*:\s*""\)/.test(login) &&
    !/useState\("admin"\)/.test(login) &&
    /placeholder=\{demoLoginEnabled\s*\?\s*"admin"\s*:\s*"name@company\.com"\}/.test(login),
);
ok(
  "the server-side demo-login shortcut is selected only by explicit demo authority",
  /email\.trim\(\)\s*===\s*"admin"\s*&&\s*password\s*===\s*"admin"\s*&&\s*demoLoginEnabled/.test(login) &&
    !/if\s*\(\s*supabaseEnabled\s*\|\|\s*demoLoginEnabled/.test(login),
);
ok(
  "product credit names Mantu Group, not an individual",
  login.includes("Mantu Group") && sidebar.includes("Mantu Group") &&
    !/Walteur|linkedin\.com\/in\//.test(login + sidebar),
);

console.log(`RESULT login-page: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
