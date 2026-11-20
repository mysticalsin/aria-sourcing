import { palettes, type Palette, type ThemeName } from "../tokens";

function block(selector: string, palette: Palette): string {
  const chartVars = palette.charts.map((color, index) => `--ds-chart-${index + 1}: ${color};`).join("");
  return `${selector}{--ds-bg:${palette.bg};--ds-surface:${palette.surface};--ds-card:${palette.card};--ds-text:${palette.text};--ds-text-2:${palette.text2};--ds-text-3:${palette.text3};--ds-line:${palette.line};--ds-accent:${palette.accent};--ds-on-accent:${palette.onAccent};--ds-link:${palette.link};--ds-focus:${palette.focus};--ds-pass:${palette.pass};--ds-pass-bg:${palette.passBg};--ds-fail:${palette.fail};--ds-fail-bg:${palette.failBg};--ds-wait:${palette.wait};--ds-wait-bg:${palette.waitBg};--ds-hero:${palette.hero};--ds-hero-text:${palette.heroText};${chartVars}}`;
}

/** Variable sheet. Geometry lives in aria-ds.css and does not change with theme. */
export function themeVariableCss(): string {
  const themes = (Object.keys(palettes) as ThemeName[])
    .filter((name) => name !== "dark")
    .map((name) => block(`.aria-ds[data-theme="${name}"]`, palettes[name]))
    .join("");
  return `${block(".aria-ds", palettes.dark)}${themes}`;
}
