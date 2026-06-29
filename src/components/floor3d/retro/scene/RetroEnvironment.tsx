"use client";
// Ported from iamlukethedev/Claw3D (MIT License)
// Mantu open-plan office, styled after the real Mantu workspace photos:
//   • two-tone floor — warm honey-oak walkways + a grey carpet-tile desk zone
//   • a white-brick feature wall with the purple "Mantu" wordmark
//   • big rounded acoustic baffle panels (white / yellow / orange / red / purple)
//     layered overhead, like the hung ceiling rafts
//   • black dome pendant lamps with warm bulbs
//   • a cafeteria bar with maroon-on-yellow stools + lots of green plants
// No enclosing room shell, so the camera orbits freely (no wall slicing the view).

import { RoundedBox, useGLTF, useTexture } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import { toWorld } from "../core/geometry";
import { DESK_POSITIONS } from "../core/navigation";

// Mantu brand palette.
const MANTU_MAGENTA = "#C2128F";
const MANTU_PURPLE = "#A0289C";
const FLOOR_OAK = "#CCA063";
const WALL_WHITE = "#F4F1EC";

// Acoustic-baffle colours (white-led, with warm + brand accents) — from photos.
const BAFFLE_COLORS = [
  "#F4F1EC", // white
  "#F4B400", // yellow
  "#F97316", // orange
  "#E5392B", // red
  MANTU_MAGENTA,
  MANTU_PURPLE,
] as const;

// ---------------------------------------------------------------------------
// GLB preloads
// ---------------------------------------------------------------------------
useGLTF.preload("/office3d/assets/desk.glb");
useGLTF.preload("/office3d/assets/chairDesk.glb");
useGLTF.preload("/office3d/assets/loungeSofa.glb");
useGLTF.preload("/office3d/assets/tableCoffee.glb");
useGLTF.preload("/office3d/assets/loungeDesignChair.glb");
useGLTF.preload("/office3d/assets/bookcaseClosed.glb");
useGLTF.preload("/office3d/assets/pottedPlant.glb");
useGLTF.preload("/office3d/assets/plantSmall1.glb");
useGLTF.preload("/office3d/assets/white_pot.glb");
useGLTF.preload("/office3d/assets/kitchenCoffeeMachine.glb");
useGLTF.preload("/office3d/assets/kitchenFridgeSmall.glb");
useGLTF.preload("/office3d/assets/kitchenCabinet.glb");
useGLTF.preload("/office3d/assets/lampRoundFloor.glb");
useGLTF.preload("/office3d/assets/computerScreen.glb");
useTexture.preload("/brand/mantu-wordmark.png?v=official");
useTexture.preload("/brand/mantu-logo-source.jpg");

// ---------------------------------------------------------------------------
// Procedural canvas textures (white brick + grey carpet tiles + living wall)
// ---------------------------------------------------------------------------
function makeBrickTexture(): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#E7E0D6"; // mortar
  ctx.fillRect(0, 0, 512, 512);
  const bw = 70;
  const bh = 30;
  const gap = 5;
  const tones = ["#FDFBF7", "#F7F2EA", "#FAF5EE", "#F2ECE2"];
  let row = 0;
  for (let y = 0; y < 512; y += bh + gap, row++) {
    const off = row % 2 ? -(bw / 2) : 0;
    for (let x = -bw; x < 512 + bw; x += bw + gap) {
      ctx.fillStyle = tones[(row * 3 + Math.round(x / bw)) % tones.length];
      ctx.fillRect(x + off, y, bw, bh);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 2.5);
  return t;
}

function makeCarpetTexture(): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const greys = ["#6c6e73", "#5b5d62", "#777a7f", "#4f5156", "#65676c"];
  const n = 4;
  const s = 256 / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      ctx.fillStyle = greys[(i * 3 + j * 7) % greys.length];
      ctx.fillRect(i * s, j * s, s, s);
    }
  }
  ctx.strokeStyle = "rgba(0,0,0,0.16)";
  ctx.lineWidth = 1.5;
  for (let k = 0; k <= n; k++) {
    ctx.beginPath();
    ctx.moveTo(k * s, 0);
    ctx.lineTo(k * s, 256);
    ctx.moveTo(0, k * s);
    ctx.lineTo(256, k * s);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function makeFoliageTexture(): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#2f5128";
  ctx.fillRect(0, 0, 128, 128);
  const greens = ["#3f6b30", "#4f8a3f", "#5aa04a", "#356026", "#6bb255"];
  for (let i = 0; i < 420; i++) {
    const x = (Math.sin(i * 12.9898) * 43758.5) % 1;
    const y = (Math.sin(i * 78.233) * 12543.7) % 1;
    const r = (Math.sin(i * 3.17) * 9999) % 1;
    ctx.fillStyle = greens[Math.floor(Math.abs(r) * greens.length) % greens.length];
    ctx.beginPath();
    ctx.ellipse(Math.abs(x) * 128, Math.abs(y) * 128, 4 + Math.abs(r) * 5, 7 + Math.abs(r) * 6, r * 6, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 4);
  return t;
}

// ---------------------------------------------------------------------------
// Cloneable GLB instance
// ---------------------------------------------------------------------------
function GlbInstance({
  src,
  position,
  rotation,
  scale,
}: {
  src: string;
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: number | [number, number, number];
}) {
  const { scene } = useGLTF(src);
  const clone = useMemo(() => scene.clone(), [scene]);
  const scaleArr: [number, number, number] =
    typeof scale === "number" ? [scale, scale, scale] : scale ?? [1, 1, 1];
  return (
    <primitive
      object={clone}
      position={position}
      rotation={rotation ?? [0, 0, 0]}
      scale={scaleArr}
    />
  );
}

// ---------------------------------------------------------------------------
// Desk + chair unit at a canvas position
// ---------------------------------------------------------------------------
function DeskUnit({ cx, cy }: { cx: number; cy: number }) {
  const [wx, , wz] = toWorld(cx, cy);
  return (
    <group>
      <GlbInstance
        src="/office3d/assets/desk.glb"
        position={[wx, 0, wz]}
        rotation={[0, 0, 0]}
        scale={0.85}
      />
      <GlbInstance
        src="/office3d/assets/computerScreen.glb"
        position={[wx, 0, wz - 0.1]}
        scale={0.85}
      />
      <GlbInstance
        src="/office3d/assets/chairDesk.glb"
        position={[wx, 0, wz + 0.9]}
        rotation={[0, Math.PI, 0]}
        scale={0.85}
      />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Two-tone floor — warm honey-oak base with a grey carpet-tile desk zone.
// ---------------------------------------------------------------------------
function OpenFloor() {
  const [minX, , minZ] = toWorld(50, 50);
  const [maxX, , maxZ] = toWorld(1750, 1750);
  const w = maxX - minX;
  const d = maxZ - minZ;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  // Carpet zone under the desk grid (canvas x 200–1000, y 250–1650).
  const [dminX, , dminZ] = toWorld(120, 150);
  const [dmaxX, , dmaxZ] = toWorld(1100, 1720);
  const carpetW = dmaxX - dminX;
  const carpetD = dmaxZ - dminZ;
  const carpetCx = (dminX + dmaxX) / 2;
  const carpetCz = (dminZ + dmaxZ) / 2;

  const carpetTex = useMemo(makeCarpetTexture, []);
  useMemo(() => {
    if (carpetTex) carpetTex.repeat.set(carpetW / 1.2, carpetD / 1.2);
  }, [carpetTex, carpetW, carpetD]);

  return (
    <group>
      {/* Warm honey-oak floor (walkways + lounge) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0, cz]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color={FLOOR_OAK} roughness={0.7} metalness={0.04} />
      </mesh>

      {/* Wood plank seams */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0.002, cz]}>
        <planeGeometry args={[w, d, 1, 40]} />
        <meshBasicMaterial color="#8a6230" wireframe transparent opacity={0.06} />
      </mesh>

      {/* Grey carpet-tile desk zone */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[carpetCx, 0.006, carpetCz]} receiveShadow>
        <planeGeometry args={[carpetW, carpetD]} />
        {carpetTex ? (
          <meshStandardMaterial map={carpetTex} roughness={0.95} metalness={0} />
        ) : (
          <meshStandardMaterial color="#5b5d62" roughness={0.95} />
        )}
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Mantu feature wall — white brick + the purple "Mantu" wordmark, like the
// real cafeteria wall. Single back wall; never slices the view.
// ---------------------------------------------------------------------------
function FeatureWall() {
  const brickTex = useMemo(makeBrickTexture, []);
  const wordmark = useTexture("/brand/mantu-wordmark.png?v=official");
  const monogram = useTexture("/brand/mantu-logo-source.jpg");
  wordmark.colorSpace = THREE.SRGBColorSpace;
  monogram.colorSpace = THREE.SRGBColorSpace;

  const [minX, , minZ] = toWorld(50, 50);
  const [maxX] = toWorld(1750, 50);
  const wallW = maxX - minX;
  const cx = (minX + maxX) / 2;
  const zWall = minZ - 0.1;
  const wallH = 3.7;

  // Official Mantu wordmark + tagline (transparent PNG) — primary, centred.
  const wmW = 9.0;
  const wmH = wmW * (361 / 1498); // native aspect of the official logo
  // M-monogram tile — secondary accent, framed, mounted to the left.
  const moW = 2.4;
  const moH = moW * (324 / 617); // native aspect ≈ 1.26

  return (
    <group position={[cx, 0, zWall]}>
      {/* Brick wall slab */}
      <mesh position={[0, wallH / 2, 0]} receiveShadow castShadow>
        <boxGeometry args={[wallW, wallH, 0.2]} />
        {brickTex ? (
          <meshStandardMaterial map={brickTex} roughness={0.95} metalness={0} />
        ) : (
          <meshStandardMaterial color={WALL_WHITE} roughness={0.95} />
        )}
      </mesh>

      {/* Mantu wordmark + tagline — transparent, letters sit on the brick */}
      <mesh position={[0, 1.95, 0.12]}>
        <planeGeometry args={[wmW, wmH]} />
        <meshBasicMaterial map={wordmark} transparent toneMapped={false} />
      </mesh>

      {/* M-monogram tile — framed sign, mounted to the left */}
      <group position={[-6.2, 2.45, 0.12]}>
        <mesh position={[0, 0, -0.01]}>
          <planeGeometry args={[moW + 0.16, moH + 0.16]} />
          <meshStandardMaterial color="#1A0A26" roughness={0.5} metalness={0.1} />
        </mesh>
        <mesh>
          <planeGeometry args={[moW, moH]} />
          <meshBasicMaterial map={monogram} toneMapped={false} />
        </mesh>
      </group>

      {/* Soft purple wash uplighting the wall */}
      <pointLight position={[0, 2.2, 2.4]} color={MANTU_PURPLE} intensity={0.5} distance={10} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Big rounded acoustic baffle panels — hung overhead in layered clusters, the
// signature Mantu ceiling look. No ceiling; they float as brand-colour rafts.
// ---------------------------------------------------------------------------
function CeilingBaffles() {
  // Individual panels spread across the ceiling (canvas coords) — a light,
  // airy accent, hung high so they read as overhead rafts, not furniture.
  // Kept to the back/middle of the room (low cy) + over the lounge, so from the
  // high establishing camera they sit clearly overhead rather than looming near.
  const spots: { cx: number; cy: number }[] = [
    { cx: 250, cy: 280 }, { cx: 560, cy: 240 }, { cx: 840, cy: 320 },
    { cx: 320, cy: 560 }, { cx: 660, cy: 600 },
    { cx: 430, cy: 880 }, { cx: 780, cy: 920 },
    { cx: 1380, cy: 460 }, { cx: 1380, cy: 900 },
  ];
  return (
    <group>
      {spots.map((s, i) => {
        const [wx, , wz] = toWorld(s.cx, s.cy);
        const oy = 4.7 + (i % 3) * 0.24; // 4.7–5.18, well above heads + wordmark
        const w = 1.7 + (i % 3) * 0.25; // 1.7–2.2
        const rot = (((i * 17) % 7) - 3) * 0.1;
        return (
          <RoundedBox
            key={i}
            args={[w, 0.16, w * 0.72]}
            radius={0.24}
            smoothness={4}
            position={[wx, oy, wz]}
            rotation={[0, rot, 0]}
            castShadow
          >
            <meshStandardMaterial
              color={BAFFLE_COLORS[i % BAFFLE_COLORS.length]}
              roughness={0.8}
              metalness={0.03}
            />
          </RoundedBox>
        );
      })}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Black dome pendant lamps with warm bulbs — the cafeteria lighting.
// ---------------------------------------------------------------------------
function PendantLamps() {
  const positions: [number, number][] = [
    [300, 250], [620, 250], [300, 700], [620, 700],
    [300, 1150], [620, 1150], [460, 1500],
    [1380, 450], [1380, 950], [1380, 1380],
  ];
  const hangFrom = 3.85;
  const domeY = 3.15;
  return (
    <group>
      {positions.map(([cx, cy], i) => {
        const [wx, , wz] = toWorld(cx, cy);
        return (
          <group key={i} position={[wx, 0, wz]}>
            {/* Cord */}
            <mesh position={[0, (hangFrom + domeY) / 2, 0]}>
              <cylinderGeometry args={[0.012, 0.012, hangFrom - domeY, 8]} />
              <meshStandardMaterial color="#1a1a1a" roughness={0.6} />
            </mesh>
            {/* Black dome shade (open face down) */}
            <mesh position={[0, domeY, 0]} rotation={[Math.PI, 0, 0]} castShadow>
              <sphereGeometry args={[0.3, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
              <meshStandardMaterial color="#161616" roughness={0.4} metalness={0.5} side={THREE.DoubleSide} />
            </mesh>
            {/* Warm bulb */}
            <mesh position={[0, domeY - 0.12, 0]}>
              <sphereGeometry args={[0.09, 12, 12]} />
              <meshStandardMaterial color="#FFE8B0" emissive="#FFD37A" emissiveIntensity={3.0} />
            </mesh>
            {/* Warm pool of light */}
            <pointLight position={[0, domeY - 0.2, 0]} color="#FFE3A8" intensity={0.7} distance={6.5} decay={2} />
          </group>
        );
      })}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Cafeteria bar — white high table + maroon-on-yellow stools (Mantu canteen).
// ---------------------------------------------------------------------------
function BarArea() {
  const [bx, , bz] = toWorld(1480, 360);
  const base: [number, number, number] = [bx, 0, bz];
  const stools: [number, number][] = [
    [-0.95, 0.2],
    [0.95, 0.2],
    [0, -1.0],
  ];
  return (
    <group position={base}>
      {/* White bar table */}
      <mesh position={[0, 0.51, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.07, 1.02, 12]} />
        <meshStandardMaterial color="#F8F8F8" roughness={0.5} metalness={0.1} />
      </mesh>
      <mesh position={[0, 1.06, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.55, 0.55, 0.06, 32]} />
        <meshStandardMaterial color="#F8F8F8" roughness={0.45} metalness={0.1} />
      </mesh>
      {stools.map(([sx, sz], i) => (
        <group key={i} position={[sx, 0, sz]}>
          {/* Maroon seat */}
          <mesh position={[0, 0.8, 0]} castShadow>
            <cylinderGeometry args={[0.2, 0.2, 0.07, 24]} />
            <meshStandardMaterial color="#6B1A2A" roughness={0.5} />
          </mesh>
          {/* Yellow stem */}
          <mesh position={[0, 0.4, 0]} castShadow>
            <cylinderGeometry args={[0.028, 0.028, 0.74, 12]} />
            <meshStandardMaterial color="#EAB308" roughness={0.5} />
          </mesh>
          {/* Yellow cross base */}
          <mesh position={[0, 0.04, 0]} castShadow>
            <boxGeometry args={[0.44, 0.04, 0.06]} />
            <meshStandardMaterial color="#EAB308" roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.04, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
            <boxGeometry args={[0.44, 0.04, 0.06]} />
            <meshStandardMaterial color="#EAB308" roughness={0.5} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Living plant wall (left side) + extra greenery in front of it.
// ---------------------------------------------------------------------------
function PlantWall() {
  const foliage = useMemo(makeFoliageTexture, []);
  const [wx, , wz] = toWorld(100, 520);
  return (
    <group>
      {/* Green living-wall panel, standing vertical, facing into the room */}
      <mesh position={[wx, 1.35, wz]} rotation={[0, Math.PI / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[5.5, 2.7, 0.25]} />
        {foliage ? (
          <meshStandardMaterial map={foliage} roughness={1} metalness={0} />
        ) : (
          <meshStandardMaterial color="#3f6b30" roughness={1} />
        )}
      </mesh>
      {/* Potted plants in front of the wall */}
      <GlbInstance src="/office3d/assets/pottedPlant.glb" position={[wx + 0.6, 0, wz - 1.6]} scale={0.95} />
      <GlbInstance src="/office3d/assets/pottedPlant.glb" position={[wx + 0.6, 0, wz + 1.6]} scale={0.85} />
      <GlbInstance src="/office3d/assets/plantSmall1.glb" position={[wx + 0.7, 0, wz]} scale={1.0} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Lounge zone (right-side canvas area)
// ---------------------------------------------------------------------------
function LoungeZone() {
  const [lx, , lz] = toWorld(1380, 760);
  return (
    <group>
      <GlbInstance src="/office3d/assets/loungeSofa.glb" position={[lx + 0.4, 0, lz - 3]} rotation={[0, Math.PI / 2, 0]} scale={0.9} />
      <GlbInstance src="/office3d/assets/tableCoffee.glb" position={[lx + 0.4, 0, lz - 1.2]} scale={0.9} />
      <GlbInstance src="/office3d/assets/loungeDesignChair.glb" position={[lx - 0.8, 0, lz - 1.2]} rotation={[0, Math.PI / 2, 0]} scale={0.85} />
      <GlbInstance src="/office3d/assets/loungeDesignChair.glb" position={[lx + 1.6, 0, lz - 1.2]} rotation={[0, -Math.PI / 2, 0]} scale={0.85} />
      <GlbInstance src="/office3d/assets/pottedPlant.glb" position={[lx + 1.8, 0, lz - 4.2]} scale={0.85} />
      <GlbInstance src="/office3d/assets/plantSmall1.glb" position={[lx - 1.0, 0, lz - 4.0]} scale={0.9} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Kitchen zone
// ---------------------------------------------------------------------------
function KitchenZone() {
  const [kx, , kz] = toWorld(1380, 1500);
  return (
    <group>
      <GlbInstance src="/office3d/assets/kitchenCabinet.glb" position={[kx, 0, kz]} scale={0.9} />
      <GlbInstance src="/office3d/assets/kitchenCoffeeMachine.glb" position={[kx + 1.2, 0, kz]} scale={0.9} />
      <GlbInstance src="/office3d/assets/kitchenFridgeSmall.glb" position={[kx + 2.4, 0, kz]} scale={0.9} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Bookcase row (left side of the floor)
// ---------------------------------------------------------------------------
function BookcaseRow() {
  const [, , wallZ] = toWorld(90, 1150);
  const [wx] = toWorld(150, 1150);
  return (
    <group>
      {[0, 2.2, 4.4].map((offset) => (
        <GlbInstance
          key={offset}
          src="/office3d/assets/bookcaseClosed.glb"
          position={[wx, 0, wallZ - 3 + offset]}
          rotation={[0, Math.PI / 2, 0]}
          scale={0.88}
        />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Scattered accent plants in the desk area
// ---------------------------------------------------------------------------
function AccentPlants() {
  const plants: [number, number][] = [
    [150, 250], [150, 1450],
    [1080, 250], [1080, 1450],
  ];
  return (
    <>
      {plants.map(([cx, cy], i) => {
        const [wx, , wz] = toWorld(cx, cy);
        return (
          <GlbInstance
            key={i}
            src={i % 2 === 0 ? "/office3d/assets/pottedPlant.glb" : "/office3d/assets/plantSmall1.glb"}
            position={[wx, 0, wz]}
            scale={0.8}
          />
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Desk rows
// ---------------------------------------------------------------------------
function DeskArea() {
  return (
    <>
      {DESK_POSITIONS.map(({ x, y }, i) => (
        <DeskUnit key={i} cx={x} cy={y} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export function RetroEnvironment() {
  return (
    <group>
      <OpenFloor />
      <FeatureWall />
      <CeilingBaffles />
      <PendantLamps />
      <DeskArea />
      <PlantWall />
      <LoungeZone />
      <KitchenZone />
      <BarArea />
      <BookcaseRow />
      <AccentPlants />
    </group>
  );
}
