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
const flyApp = readFileSync(new URL("../fly.app.toml", import.meta.url), "utf8");
const productionDockerfile = readFileSync(new URL("../Dockerfile.prod", import.meta.url), "utf8");
const deployWorkflow = readFileSync(new URL("../.github/workflows/deploy-aria-mantu.yml", import.meta.url), "utf8");

ok("login has no dead hash navigation", !login.includes('href="#"'));
ok("login removes the unbacked public navigation list", !login.includes("NAV_LINKS"));
ok("login tracks a user-controlled video pause", login.includes("videoPausedByUser"));
ok("login uses the shared reduced-motion preference", login.includes("usePrefersReducedMotion"));
ok("login offers a visible pause label", login.includes("Pause background motion"));
ok("login offers a visible resume label", login.includes("Play background motion"));
ok("login explains the system reduced-motion state", login.includes("Background motion paused by system"));
ok("login pause control reports its pressed state", login.includes("aria-pressed"));
ok("login email disclosure reports its expanded state", login.includes("aria-expanded={showEmail}"));
ok("login email disclosure identifies its controlled form", login.includes('aria-controls="login-email-form"'));
ok("login email form has the controlled id", login.includes('id="login-email-form"'));
ok(
  "Microsoft login is exposed only when the public Azure capability flag is enabled",
  /azureLoginEnabled/.test(login) &&
    /supabaseEnabled\s*&&\s*azureLoginEnabled/.test(login) &&
    /export const azureLoginEnabled/.test(config),
);
ok(
  "Fly production defaults to email login until Azure secrets are explicitly wired",
  /NEXT_PUBLIC_ENABLE_AZURE_LOGIN\s*=\s*"false"/.test(flyApp) &&
    /NEXT_PUBLIC_ENABLE_AZURE_LOGIN=false/.test(deployWorkflow),
);
ok(
  "the production image treats the Azure login flag as an explicit build input",
  /ARG NEXT_PUBLIC_ENABLE_AZURE_LOGIN/.test(productionDockerfile) &&
    /NEXT_PUBLIC_ENABLE_AZURE_LOGIN=\$NEXT_PUBLIC_ENABLE_AZURE_LOGIN/.test(productionDockerfile),
);
ok(
  "email is the primary live login action when Azure is disabled",
  /azureLoginEnabled\s*\?\s*"Sign in with Microsoft"\s*:\s*"Sign in with email"/.test(login),
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

console.log(`RESULT login-page: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
