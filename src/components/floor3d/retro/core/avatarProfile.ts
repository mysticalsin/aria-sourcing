// Ported from iamlukethedev/Claw3D (MIT License)
// Deterministic avatar profile generated from a string seed.

export type AgentAvatarHairStyle = "short" | "parted" | "spiky" | "bun";
export type AgentAvatarTopStyle = "tee" | "hoodie" | "jacket";
export type AgentAvatarBottomStyle = "pants" | "shorts" | "cuffed";
export type AgentAvatarHatStyle = "none" | "cap" | "beanie";

export type AgentAvatarProfile = {
  version: 1;
  seed: string;
  body: { skinTone: string };
  hair: { style: AgentAvatarHairStyle; color: string };
  clothing: {
    topStyle: AgentAvatarTopStyle;
    topColor: string;
    bottomStyle: AgentAvatarBottomStyle;
    bottomColor: string;
    shoesColor: string;
  };
  accessories: {
    glasses: boolean;
    headset: boolean;
    hatStyle: AgentAvatarHatStyle;
    backpack: boolean;
  };
};

type ColorOption = { id: string; label: string; color: string };
type EnumOption<T extends string> = { id: T; label: string };

const SKIN_TONES: ColorOption[] = [
  { id: "fair", label: "Fair", color: "#f7d7c2" },
  { id: "light", label: "Light", color: "#f4c58a" },
  { id: "warm", label: "Warm", color: "#d8a06e" },
  { id: "tan", label: "Tan", color: "#b7794e" },
  { id: "deep", label: "Deep", color: "#8a5a3b" },
  { id: "rich", label: "Rich", color: "#5d3a24" },
];

const HAIR_STYLES: EnumOption<AgentAvatarHairStyle>[] = [
  { id: "short", label: "Short" },
  { id: "parted", label: "Parted" },
  { id: "spiky", label: "Spiky" },
  { id: "bun", label: "Bun" },
];

const HAIR_COLORS: ColorOption[] = [
  { id: "ink", label: "Ink", color: "#151515" },
  { id: "espresso", label: "Espresso", color: "#3e2723" },
  { id: "walnut", label: "Walnut", color: "#6b4f3a" },
  { id: "auburn", label: "Auburn", color: "#7b341e" },
  { id: "blonde", label: "Blonde", color: "#d6b56c" },
  { id: "violet", label: "Violet", color: "#7c3aed" },
  { id: "cyan", label: "Cyan", color: "#0891b2" },
  { id: "pink", label: "Pink", color: "#db2777" },
];

const TOP_STYLES: EnumOption<AgentAvatarTopStyle>[] = [
  { id: "tee", label: "Tee" },
  { id: "hoodie", label: "Hoodie" },
  { id: "jacket", label: "Jacket" },
];

const BOTTOM_STYLES: EnumOption<AgentAvatarBottomStyle>[] = [
  { id: "pants", label: "Pants" },
  { id: "shorts", label: "Shorts" },
  { id: "cuffed", label: "Cuffed" },
];

const HAT_STYLES: EnumOption<AgentAvatarHatStyle>[] = [
  { id: "none", label: "None" },
  { id: "cap", label: "Cap" },
  { id: "beanie", label: "Beanie" },
];

const CLOTHING_COLORS: ColorOption[] = [
  { id: "graphite", label: "Graphite", color: "#2d3748" },
  { id: "sky", label: "Sky", color: "#7090ff" },
  { id: "mint", label: "Mint", color: "#34d399" },
  { id: "amber", label: "Amber", color: "#f59e0b" },
  { id: "rose", label: "Rose", color: "#f43f5e" },
  { id: "violet", label: "Violet", color: "#8b5cf6" },
  { id: "cream", label: "Cream", color: "#f5f5f4" },
  { id: "slate", label: "Slate", color: "#64748b" },
];

const SHOE_COLORS: ColorOption[] = [
  { id: "black", label: "Black", color: "#1a1a1a" },
  { id: "navy", label: "Navy", color: "#1e3a8a" },
  { id: "brown", label: "Brown", color: "#7c4a2d" },
  { id: "white", label: "White", color: "#e5e7eb" },
];

const hashSeed = (seed: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const pick = <T,>(values: readonly T[], index: number): T =>
  values[index % values.length];

export const createDefaultAgentAvatarProfile = (seed: string): AgentAvatarProfile => {
  const s = seed.trim() || "agent";
  const h = hashSeed(s);
  return {
    version: 1,
    seed: s,
    body: { skinTone: pick(SKIN_TONES, h).color },
    hair: {
      style: pick(HAIR_STYLES, h >>> 3).id,
      color: pick(HAIR_COLORS, h >>> 5).color,
    },
    clothing: {
      topStyle: pick(TOP_STYLES, h >>> 7).id,
      topColor: pick(CLOTHING_COLORS, h >>> 9).color,
      bottomStyle: pick(BOTTOM_STYLES, h >>> 11).id,
      bottomColor: pick(CLOTHING_COLORS, h >>> 13).color,
      shoesColor: pick(SHOE_COLORS, h >>> 15).color,
    },
    accessories: {
      glasses: Boolean((h >>> 19) % 2),
      headset: Boolean((h >>> 20) % 2),
      hatStyle: pick(HAT_STYLES, h >>> 17).id,
      backpack: Boolean((h >>> 21) % 2),
    },
  };
};
