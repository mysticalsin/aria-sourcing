/**
 * WCAG 2.2 AA contrast for the color tokens that paint text.
 *
 * Pairs follow the C2A sweep: dry-run chip, success and danger badges,
 * violet badges, and violet text on the page background (skills version marks).
 */
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;

function check(label: string, cond: boolean, detail = "") {
  if (cond) {
    pass += 1;
    return;
  }
  fail += 1;
  console.error(`FAIL ${label}${detail ? ` — ${detail}` : ""}`);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sat = s / 100;
  const lit = l / 100;
  const a = sat * Math.min(lit, 1 - lit);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    return lit - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  return [0, 8, 4].map((n) => Math.round(channel(n) * 255)) as [number, number, number];
}

function linear(channel: number): number {
  const s = channel / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(rgb: [number, number, number]): number {
  return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
}

export function contrastRatio(foreground: [number, number, number], background: [number, number, number]): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

function composite(
  foreground: [number, number, number],
  background: [number, number, number],
  alpha: number,
): [number, number, number] {
  return foreground.map((channel, index) => Math.round(channel * alpha + background[index] * (1 - alpha))) as [
    number,
    number,
    number,
  ];
}

const css = readFileSync(new URL("../src/styles/globals.css", import.meta.url), "utf8");
const root = css.match(/:root\s*\{([\s\S]*?)\n\}/);
if (!root) {
  console.error("FAIL :root tokens are readable");
  process.exit(1);
}

function token(name: string): [number, number, number] {
  const match = root?.[1].match(new RegExp(`(^|\\n)\\s*${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`));
  if (!match) throw new Error(`missing token ${name}`);
  return hslToRgb(Number(match[2]), Number(match[3]), Number(match[4]));
}

const paper = token("--paper");
const success = token("--success");
const successSoft = token("--success-soft");
const danger = token("--danger");
const dangerSoft = token("--danger-soft");
const violet = token("--violet");
const violetSoft = token("--violet-soft");
const warning = token("--warning");
const warningSoft = token("--warning-soft");
const chip = composite(successSoft, paper, 0.8);
const AA = 4.5;

const pairs: { id: string; ratio: number }[] = [
  { id: "C2A-01 dry-run chip (--success on --success-soft/80 over --paper)", ratio: contrastRatio(success, chip) },
  { id: "C2A-01 success badge (--success on --success-soft)", ratio: contrastRatio(success, successSoft) },
  { id: "C2A-01 danger badge (--danger on --danger-soft)", ratio: contrastRatio(danger, dangerSoft) },
  { id: "C2A-01 violet badge (--violet on --violet-soft)", ratio: contrastRatio(violet, violetSoft) },
  { id: "C2A-01 violet text on page (--violet on --paper)", ratio: contrastRatio(violet, paper) },
  { id: "C2A-01 warning text (--warning on --warning-soft)", ratio: contrastRatio(warning, warningSoft) },
  { id: "C2A-01 warning text on page (--warning on --paper)", ratio: contrastRatio(warning, paper) },
];

for (const pair of pairs) {
  check(pair.id, pair.ratio >= AA, `${pair.ratio.toFixed(2)}:1 is below ${AA}:1`);
}

console.log(`RESULT contrast-ratio: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
