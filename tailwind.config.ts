import type { Config } from "tailwindcss";

/**
 * Hermes Sourcing design system.
 * Colors are wired to CSS variables declared in src/styles/globals.css so the
 * palette can be retuned in one place. Raw hex fallbacks live in globals.css.
 */
const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: "hsl(var(--paper) / <alpha-value>)",
        canvas: "hsl(var(--canvas) / <alpha-value>)",
        surface: "hsl(var(--surface) / <alpha-value>)",
        ink: "hsl(var(--ink) / <alpha-value>)",
        "ink-soft": "hsl(var(--ink-soft) / <alpha-value>)",
        muted: "hsl(var(--muted) / <alpha-value>)",
        line: "hsl(var(--line) / <alpha-value>)",
        tangerine: {
          DEFAULT: "hsl(var(--tangerine) / <alpha-value>)",
          soft: "hsl(var(--tangerine-soft) / <alpha-value>)",
        },
        electric: {
          DEFAULT: "hsl(var(--electric) / <alpha-value>)",
          soft: "hsl(var(--electric-soft) / <alpha-value>)",
        },
        aqua: {
          DEFAULT: "hsl(var(--aqua) / <alpha-value>)",
          soft: "hsl(var(--aqua-soft) / <alpha-value>)",
        },
        violet: {
          DEFAULT: "hsl(var(--violet) / <alpha-value>)",
          soft: "hsl(var(--violet-soft) / <alpha-value>)",
        },
        success: {
          DEFAULT: "hsl(var(--success) / <alpha-value>)",
          soft: "hsl(var(--success-soft) / <alpha-value>)",
        },
        warning: {
          DEFAULT: "hsl(var(--warning) / <alpha-value>)",
          soft: "hsl(var(--warning-soft) / <alpha-value>)",
        },
        danger: {
          DEFAULT: "hsl(var(--danger) / <alpha-value>)",
          soft: "hsl(var(--danger-soft) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: {
        xl: "16px",
        "2xl": "20px",
        "3xl": "28px",
        "4xl": "32px",
      },
      boxShadow: {
        soft: "0 1px 2px hsl(var(--ink) / 0.04), 0 8px 24px hsl(var(--ink) / 0.06)",
        lift: "0 2px 6px hsl(var(--ink) / 0.06), 0 20px 48px hsl(var(--ink) / 0.10)",
        glow: "0 0 0 1px hsl(var(--tangerine) / 0.30), 0 12px 32px hsl(var(--tangerine) / 0.20)",
      },
      fontSize: {
        eyebrow: ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.14em" }],
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.97)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "slide-in-right": {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        "spin-slow": {
          to: { transform: "rotate(360deg)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.35s ease-out both",
        "scale-in": "scale-in 0.2s ease-out both",
        "slide-in-right": "slide-in-right 0.3s cubic-bezier(0.16, 1, 0.3, 1) both",
        "spin-slow": "spin-slow 14s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
