/**
 * Colour tokens for the Aria design system.
 *
 * Hex values are the only source of truth. Theme CSS variables and the
 * contrast tests both read this module, so a palette edit cannot update
 * one and forget the other.
 *
 * Provenance is recorded in ATTRIBUTION.md. No BidStack blue is used:
 * Polo's own ADR 0002 keeps #2c4bff for that product.
 */

export type ThemeName = "dark" | "light";

export type Palette = {
  bg: string;
  surface: string;
  card: string;
  text: string;
  text2: string;
  text3: string;
  line: string;
  accent: string;
  onAccent: string;
  link: string;
  focus: string;
  pass: string;
  passBg: string;
  fail: string;
  failBg: string;
  wait: string;
  waitBg: string;
  hero: string;
  heroText: string;
  charts: readonly string[];
};

export const darkPalette: Palette = {
  bg: "#101011",
  surface: "#16161C",
  card: "#1C1C24",
  text: "#F7F4FB",
  text2: "#D5D0DE",
  text3: "#B7B1C2",
  line: "#9A93A6",
  accent: "#F8F060",
  onAccent: "#1A0033",
  link: "#A9D4F2",
  focus: "#F8F060",
  pass: "#7DDC8F",
  passBg: "#102117",
  fail: "#F6A3A6",
  failBg: "#2A1518",
  wait: "#F0CF8E",
  waitBg: "#2A2110",
  hero: "#2B0058",
  heroText: "#F7F4FB",
  charts: ["#C9A3F0", "#F8F060", "#A9D4F2", "#7DDC8F", "#F0CF8E", "#F6A3A6", "#D6D6D6", "#9B6DFF"],
};

export const lightPalette: Palette = {
  bg: "#F4F1F6",
  surface: "#FFFFFF",
  card: "#FFFFFF",
  text: "#17121A",
  text2: "#3D3548",
  text3: "#4A4456",
  line: "#7A7386",
  accent: "#6600AE",
  onAccent: "#FFFFFF",
  link: "#6600AE",
  focus: "#6600AE",
  pass: "#0B5D1E",
  passBg: "#E3F5E6",
  fail: "#8E1B14",
  failBg: "#FDECEA",
  wait: "#6B3A00",
  waitBg: "#FDF0E0",
  hero: "#2B0058",
  heroText: "#F7F4FB",
  charts: ["#6600AE", "#2B0058", "#4678AA", "#0B5D1E", "#8A4300", "#B42318", "#3D3C3E", "#7F00DA"],
};

export const palettes: Record<ThemeName, Palette> = {
  dark: darkPalette,
  light: lightPalette,
};

export type ContrastPair = {
  theme: ThemeName;
  name: string;
  foreground: string;
  background: string;
  /** WCAG 2.2 minimum. 4.5 for text, 3 for UI boundaries. */
  minimum: number;
};

function pairsFor(theme: ThemeName, palette: Palette): ContrastPair[] {
  const text = (name: string, foreground: string, background: string): ContrastPair => ({
    theme,
    name,
    foreground,
    background,
    minimum: 4.5,
  });
  const ui = (name: string, foreground: string, background: string): ContrastPair => ({
    theme,
    name,
    foreground,
    background,
    minimum: 3,
  });
  return [
    text("body on canvas", palette.text, palette.bg),
    text("body on card", palette.text, palette.card),
    text("secondary on card", palette.text2, palette.card),
    text("tertiary on card", palette.text3, palette.card),
    text("link on canvas", palette.link, palette.bg),
    text("button label", palette.onAccent, palette.accent),
    text("pass chip", palette.pass, palette.passBg),
    text("fail chip", palette.fail, palette.failBg),
    text("wait chip", palette.wait, palette.waitBg),
    text("up delta on card", palette.pass, palette.card),
    text("down delta on card", palette.fail, palette.card),
    text("hero title", palette.heroText, palette.hero),
    text("hero title on bright purple", palette.heroText, "#6600AE"),
    ui("focus ring", palette.focus, palette.bg),
    ui("control border", palette.line, palette.bg),
    ui("control border on card", palette.line, palette.card),
  ];
}

export const contrastPairs: readonly ContrastPair[] = [
  ...pairsFor("dark", darkPalette),
  ...pairsFor("light", lightPalette),
];

function channel(hex: string, index: number): number {
  return Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
}

function linearize(channelValue: number): number {
  const srgb = channelValue / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.2 relative luminance for a #RRGGBB colour. */
export function relativeLuminance(hex: string): number {
  return (
    0.2126 * linearize(channel(hex, 0)) +
    0.7152 * linearize(channel(hex, 1)) +
    0.0722 * linearize(channel(hex, 2))
  );
}

/** Contrast ratio in the range 1..21. */
export function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
