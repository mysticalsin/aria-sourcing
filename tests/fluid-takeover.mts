import assert from "node:assert/strict";
import {
  fluidHotkeyAction,
  withFluidTakeQuery,
  FLUID_TAKEOVER,
} from "../src/lib/fluid-takeover.ts";

function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  console.log(`ok — ${name}`);
}

check("T takes while watching", fluidHotkeyAction("t", { humanControl: false }) === "take");
check("T ignored while controlling", fluidHotkeyAction("t", { humanControl: true }) === "ignore");
check("Esc releases while controlling", fluidHotkeyAction("Escape", { humanControl: true }) === "release");
check("R releases while controlling", fluidHotkeyAction("r", { humanControl: true }) === "release");
check("Esc ignored while watching", fluidHotkeyAction("Escape", { humanControl: false }) === "ignore");
check(
  "typing target blocks take",
  fluidHotkeyAction("t", { humanControl: false, typingTarget: true }) === "ignore",
);
check(
  "typing target blocks release",
  fluidHotkeyAction("Escape", { humanControl: true, typingTarget: true }) === "ignore",
);
check(
  "relative url gets fs=1",
  withFluidTakeQuery("/fleet/computers/c1/viewport") === "/fleet/computers/c1/viewport?fs=1",
);
check(
  "absolute url gets fs=1",
  withFluidTakeQuery("https://openbot.example/c/bot1").includes("fs=1"),
);
check("copy has get-out label", FLUID_TAKEOVER.releaseLabel.includes("Get out"));
check("copy has watching hint", FLUID_TAKEOVER.watchingHint.includes("Take control"));

console.log("fluid-takeover: all checks passed");
