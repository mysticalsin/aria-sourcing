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

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const providers = source("src/components/app/providers.tsx");
const globals = source("src/styles/globals.css");
const tailwind = source("tailwind.config.ts");
const button = source("src/components/ui/button.tsx");
const card = source("src/components/ui/card.tsx");
const tabs = source("src/components/ui/tabs.tsx");
const progress = source("src/components/ui/progress.tsx");

ok("MotionConfig respects the OS preference", /<MotionConfig\s+reducedMotion="user"/.test(providers));
ok("motion uses one named ease-out token", globals.includes("--ease-motion-out"));
ok("Tailwind exposes the shared motion easing", tailwind.includes('"motion-out": "var(--ease-motion-out)"'));
ok("reduced motion uses an opacity-only entry keyframe", globals.includes("@keyframes reduced-fade-in"));
ok("reduced motion avoids the blanket near-zero duration hack", !globals.includes("0.001ms"));
ok("reduced motion makes transform progress instantaneous", /\.motion-progress-fill[\s\S]*transition-duration:\s*0ms/.test(globals));

ok("Button avoids transition-all", !button.includes("transition-all"));
ok("Button transitions explicit compositor-safe properties", button.includes("transition-[transform,background-color,color,opacity]"));
ok("Button press feedback is restrained", button.includes("active:scale-[0.97]"));

ok("Card avoids transition-all", !card.includes("transition-all"));
ok("Card opts into the shared fine-pointer motion class", card.includes("motion-card"));
ok("Card hover lift is limited to fine pointers", /@media \(hover: hover\) and \(pointer: fine\)[\s\S]*\.motion-card:hover/.test(globals));

ok("Tabs avoid transition-all", !tabs.includes("transition-all"));
ok("Tab panels do not animate keyboard navigation", !tabs.includes("animate-fade-in"));
ok("Tabs transition explicit visual properties", tabs.includes("transition-[background-color,color,box-shadow]"));

ok("Progress no longer animates width", !progress.includes("transition-[width]"));
ok("Progress uses a transform scale", progress.includes("scaleX(${pct / 100})"));
ok("Progress has the reduced-motion class", progress.includes("motion-progress-fill"));

console.log(`RESULT motion-foundation: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
