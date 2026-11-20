/**
 * Component inventory. The gallery renders this table; ATTRIBUTION.md
 * explains the licence position. Heads were read on 20 Nov 2026 and were
 * not modified.
 */

export type InventoryRow = {
  component: string;
  source: string;
  adapted: string;
};

export const READ_HEADS = {
  vision: "d9e049a92d9b3a1930cc4ff5744706fca5d1b2c3",
  athena: "8270672e2b3a5bbc0045e4a8340b430150eafbb2",
  bidstack: "0ddf0a52a576172111049351477228dd94189d04",
} as const;

export const INVENTORY: readonly InventoryRow[] = [
  {
    component: "Tokens",
    source: `mysticalsin/vision@${READ_HEADS.vision.slice(0, 8)} apps/web/src/styles/tokens.css; mysticalsin/athena@${READ_HEADS.athena.slice(0, 8)} src/ui/styles.css; mysticalsin/aria-sourcing src/styles/globals.css`,
    adapted:
      "Mantu purple, yellow, and navy from Vision. Dark canvas, spacing, and status colours from Athena. Carlito from Aria. Values rechecked for WCAG contrast. Yellow is a button fill, not small text.",
  },
  {
    component: "Theme",
    source: `mysticalsin/bidstack-360@${READ_HEADS.bidstack.slice(0, 8)} apps/web/src/stores/theme.ts and docs/adr/0002-design-tokens.md; Vision .dark block`,
    adapted:
      "Light and dark swap colour only. Radius, type, and borders stay put. Local React state on the gallery root. No zustand and no localStorage.",
  },
  {
    component: "Chart colours",
    source: `mysticalsin/bidstack-360@${READ_HEADS.bidstack.slice(0, 8)} apps/web/src/components/charts/chartTokens.ts`,
    adapted:
      "Kept the chart-1..8 variable idea. Retinted to Mantu-safe colours. Polo brand blue #2c4bff was not imported.",
  },
  {
    component: "Sparkline",
    source: `mysticalsin/bidstack-360@${READ_HEADS.bidstack.slice(0, 8)} apps/web/src/components/charts/Sparkline.tsx; aria-sourcing src/components/charts/trend-spark.tsx`,
    adapted:
      "Same min/max polyline and area. Decorative, hidden from assistive tech. No framer-motion. The KPI text carries the number.",
  },
  {
    component: "Funnel chart",
    source: "aria-sourcing src/components/charts/funnel-chart.tsx; Polo cockpit PipelineByStageCard.tsx",
    adapted:
      "SVG bars with a visually hidden data table, so the chart is readable without Recharts measuring the DOM.",
  },
  {
    component: "Column chart",
    source: `mysticalsin/bidstack-360@${READ_HEADS.bidstack.slice(0, 8)} apps/web/src/components/charts/CartesianCharts.tsx`,
    adapted: "A small labelled column chart for weekly synthetic drafts. Accessible table beside the drawing.",
  },
  {
    component: "Score ring",
    source: `mysticalsin/athena@${READ_HEADS.athena.slice(0, 8)} src/ui/styles.css (.cover-ring, .score)`,
    adapted:
      "SVG ring instead of a conic div. The number and the words Suggestion only are real text. No emotion or engagement score.",
  },
  {
    component: "KPI card",
    source: `mysticalsin/bidstack-360@${READ_HEADS.bidstack.slice(0, 8)} apps/web/src/components/charts/KpiCard.tsx and cockpit/KpiRow.tsx; aria-sourcing src/components/dashboard/metric-card.tsx`,
    adapted:
      "Eyebrow, figure, delta, sparkline. Up, down, or flat is a word, not only a colour. The final value is in the DOM. No count-up that would hide it from a static render.",
  },
  {
    component: "Filter bar",
    source: `mysticalsin/vision@${READ_HEADS.vision.slice(0, 8)} apps/web/src/components/library/FilterBar.tsx`,
    adapted:
      "Native selects for stage, language, and score. Live count and clear. No Radix. Filters run on the synthetic list only.",
  },
  {
    component: "Table",
    source: `Athena src/ui/styles.css (.list); Vision apps/web/src/components/share/ShareTable.tsx; Polo chartShared.tsx DataTable`,
    adapted: "Caption, column headers with scope, and a keyboard-focusable row. Empty state is a sentence.",
  },
  {
    component: "Candidate card",
    source: `mysticalsin/bidstack-360@${READ_HEADS.bidstack.slice(0, 8)} apps/web/src/pages/pipelineBoard/PipelineCard.tsx`,
    adapted:
      "Initials, suggestion score, stage, skills, source, example.test address. No photo, no money, no drag handle as the only control.",
  },
  {
    component: "Pipeline kanban",
    source: `mysticalsin/bidstack-360@${READ_HEADS.bidstack.slice(0, 8)} apps/web/src/pages/pipelineBoard/StageColumn.tsx and PipelineCard.tsx`,
    adapted:
      "Seven Smart stages. Arrow keys move one stage. Dropping or arrowing into Hired is refused and announced. Empty columns say Empty.",
  },
  {
    component: "Segmented control",
    source: `mysticalsin/athena@${READ_HEADS.athena.slice(0, 8)} src/ui/styles.css (.seg)`,
    adapted: "Real radio inputs. Used for theme and for Manual / Full automatic.",
  },
  {
    component: "Approval panel",
    source: "Build plan §13 (Tony, 20 Nov 2026). New in Aria. Athena answer panel informed the quote block.",
    adapted:
      "Shows one exact message and its SHA-256. Manual is selected by default. Full automatic does not change the text.",
  },
  {
    component: "Odoo sync chip",
    source: `mysticalsin/athena@${READ_HEADS.athena.slice(0, 8)} src/ui/styles.css (.chip)`,
    adapted: "Icon plus a word for synced, pending, failed, and only-in-Aria. Colour is never the only signal.",
  },
  {
    component: "Buttons and badges",
    source: "Athena .btn and .chip; Vision primary/quiet button colours; Aria card radius",
    adapted: "44px targets, visible focus, yellow pill on dark and purple pill on light.",
  },
  {
    component: "Manager dashboard",
    source: "Azure DevOps project VibeApps, repository manager-cards",
    adapted:
      "Not read. core_list_projects and search_code timed out (MCP -32001) while the Azure DevOps namespace reported ready. No component was copied from it.",
  },
];
