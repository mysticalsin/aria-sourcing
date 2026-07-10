"use client";

import { Billboard, useTexture } from "@react-three/drei";
import { useEffect, useRef } from "react";
import * as THREE from "three";

/* ============================================================================
   SpriteCharacter — a camera-facing billboard of one of the official Aria
   character renders (the glossy toy robots + the human lead). Transparent PNGs
   (alpha-tested) so only the character shows. The walking sim moves the parent
   group; the billboard keeps the character facing the viewer as it walks.
   ========================================================================== */

const CHAR_URL = {
  human: "/office3d/characters/human-agent.png",
  blue: "/office3d/characters/blue-bot.png",
  orange: "/office3d/characters/orange-bot.png",
  green: "/office3d/characters/green-bot.png",
  purple: "/office3d/characters/purple-bot.png",
  yellow: "/office3d/characters/yellow-bot.png",
} as const;

export type CharKey = keyof typeof CHAR_URL;

useTexture.preload(Object.values(CHAR_URL));

// Reference bot accent colours → pick the nearest sprite for an agent's palette colour.
const BOT_RGB: [CharKey, [number, number, number]][] = [
  ["blue", [37, 99, 235]],
  ["orange", [234, 140, 43]],
  ["green", [63, 168, 69]],
  ["purple", [124, 58, 237]],
  ["yellow", [234, 179, 8]],
];

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16) || 0,
    parseInt(h.slice(2, 4), 16) || 0,
    parseInt(h.slice(4, 6), 16) || 0,
  ];
}

/** Map an agent's palette colour to the nearest of the 5 bot sprites. */
export function botKeyForColor(color: string): CharKey {
  const [r, g, b] = hexToRgb(color);
  let best: CharKey = "blue";
  let bestD = Infinity;
  for (const [key, [br, bg, bb]] of BOT_RGB) {
    const d = (r - br) ** 2 + (g - bg) ** 2 + (b - bb) ** 2;
    if (d < bestD) {
      bestD = d;
      best = key;
    }
  }
  return best;
}

const ASPECT = 1024 / 1536;

export function SpriteCharacter({
  charKey,
  height = 1.4,
}: {
  charKey: CharKey;
  height?: number;
}) {
  const tex = useTexture(CHAR_URL[charKey]);
  const width = height * ASPECT;
  const matRef = useRef<THREE.MeshBasicMaterial>(null);

  // Dispose the material on unmount. Capture matRef.current into a local
  // variable because React clears refs before cleanup runs. The texture
  // comes from the useTexture cache (shared) and must NOT be disposed here.
  useEffect(() => {
    const mat = matRef.current;
    return () => {
      mat?.dispose();
    };
  }, []);

  return (
    <Billboard position={[0, height / 2, 0]} follow lockX={false} lockZ={false}>
      <mesh>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial
          ref={matRef}
          map={tex as THREE.Texture}
          transparent
          alphaTest={0.5}
          depthWrite={false}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </Billboard>
  );
}
