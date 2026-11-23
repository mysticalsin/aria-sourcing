import { existsSync, readFileSync } from "node:fs";

import { ARCHITECTURE_FLOOR_MAP, floorMapDrift } from "../src/lib/architecture-floor-map";

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const root = new URL("..", import.meta.url);
const exists = (path: string) => existsSync(new URL(path, root));
const drift = floorMapDrift(ARCHITECTURE_FLOOR_MAP, exists);
ok("floor map matches checked-in source", drift.length === 0);
if (drift.length > 0) console.log(drift.join("\n"));

const page = readFileSync(new URL("../src/app/floor-map/page.tsx", import.meta.url), "utf8");
const view = readFileSync(new URL("../src/components/architecture/floor-map-view.tsx", import.meta.url), "utf8");
const nav = readFileSync(new URL("../src/components/app/nav.ts", import.meta.url), "utf8");
const guide = readFileSync(new URL("../docs/ARCHITECTURE.md", import.meta.url), "utf8");

ok("page renders the shared map", view.includes("ARCHITECTURE_FLOOR_MAP") && page.includes("FloorMapView"));
ok("nav links the floor-map page", nav.includes('href: "/floor-map"'));
ok("architecture guide points at the page", guide.includes("/floor-map") && guide.includes("src/lib/architecture-floor-map.ts"));
ok("page states synthetic demo data", page.includes("Synthetic demo data"));
ok(
  "view does not hardcode a second room list",
  !view.includes("title: \"Browser\"") && view.includes("map.rooms") && view.includes("map.prohibited"),
);

const rendered = `${page}\n${view}\n${JSON.stringify(ARCHITECTURE_FLOOR_MAP)}`;
ok("no live credential material in the floor map", !/sk-|BEGIN PRIVATE|password\s*[:=]/i.test(rendered));
ok("no email address in the floor map", !/@[a-z0-9.-]+\.[a-z]{2,}/i.test(rendered));

console.log(`RESULT architecture-floor-map: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
