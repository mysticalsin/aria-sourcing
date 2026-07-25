"use client";

import { Text, useGLTF } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import * as THREE from "three";

/* ============================================================================
   Procedural Mantu office room — the static "set" the desk grid sits inside.
   Warm honey-oak plank floor, white walls, a feature white-brick back wall with
   a bold purple MANTU wordmark, a dark exposed-industrial ceiling hung with
   colourful acoustic baffles + black dome pendant lamps (warm emissive bulbs),
   leafy plants from the GLB prop library, and a communal bar table with
   maroon-on-yellow stools off to one side.

   All layout numbers live in exported constants so a reviewer can nudge the
   framing without spelunking the JSX. Built from primitives + a few GLB props;
   no skeleton, no per-frame work — this whole component is static geometry.
   ========================================================================== */

// ── Room envelope ──────────────────────────────────────────────────────────
export const ROOM_W = 26; // width  (x: -13 … +13)
export const ROOM_D = 20; // depth  (z: -6  … +14)
export const ROOM_H = 5.0; // ceiling height (y)
const WALL_T = 0.2; // wall thickness
const Z_BACK = -6; // back (feature) wall — faces the camera
const Z_FRONT = 14; // front wall — behind the camera
const X_LEFT = -ROOM_W / 2; // -13, the window wall
const X_RIGHT = ROOM_W / 2; // +13

// Brand + material palette.
const FLOOR_OAK = "#C8843A";
const WALL_WHITE = "#F4F1EC";
const BRICK_WHITE = "#FAF7F2";
const MANTU_PURPLE = "#A0289C";
const CEILING_GREY = "#3A3A3E";
const DUCT_GREY = "#4A4A4E";
const WINDOW_BLUE = "#B8D8F8";
const PENDANT_BLACK = "#1A1A1A";
const BULB_WARM = "#FFF4C0";
const STOOL_MAROON = "#6B1A2A";
const STOOL_YELLOW = "#EAB308";
const BAR_WHITE = "#F8F8F8";

// ── Ceiling acoustic baffles (colourful hanging rectangles) ───────────────
export const BAFFLE_DEFS: {
  x: number;
  y: number;
  z: number;
  rot: number;
  color: string;
}[] = [
  { x: -5, y: 4.1, z: -1, rot: 0, color: "#F97316" },
  { x: 0, y: 4.2, z: -2, rot: Math.PI / 2, color: "#A0289C" },
  { x: 5, y: 4.0, z: -1, rot: 0, color: "#EF4444" },
  { x: -3.5, y: 3.9, z: 3, rot: 0, color: "#EAB308" },
  { x: 3.5, y: 4.15, z: 3, rot: 0, color: "#F97316" },
  { x: -7, y: 4.05, z: 1, rot: Math.PI / 2, color: "#A0289C" },
  { x: 7, y: 4.1, z: 1, rot: Math.PI / 2, color: "#EF4444" },
];

// ── Black dome pendant lamps (warm pools of light over the desks) ─────────
export const PENDANT_POSITIONS: [number, number, number][] = [
  [-4.5, ROOM_H, 1.0],
  [-1.5, ROOM_H, 1.0],
  [1.5, ROOM_H, 1.0],
  [4.5, ROOM_H, 1.0],
  [7.5, ROOM_H, 4.5], // moved off-centre so it doesn't line up over the MANTU wall
];

// ── Leafy plants (GLB props scattered along the walls + corners) ──────────
const TREE_URL = "/office3d/assets/tree.glb";
const POTTED_URL = "/office3d/assets/pottedPlant.glb";
const WHITE_POT_URL = "/office3d/assets/white_pot.glb";

export const PLANT_DEFS: {
  url: string;
  pos: [number, number, number];
  scale: number;
}[] = [
  // Trees swapped for potted plants: tree.glb's flat alpha-plane foliage renders
  // edge-on as a thin grey "invisible wall" slab mid-floor. Potted plants read clean.
  { url: POTTED_URL, pos: [-11.5, 0, -4], scale: 1.2 },
  { url: POTTED_URL, pos: [11, 0, -4], scale: 1.1 },
  { url: POTTED_URL, pos: [-11.5, 0, 8], scale: 1.2 },
  { url: POTTED_URL, pos: [11, 0, 8], scale: 1.0 },
  { url: WHITE_POT_URL, pos: [-8, 0, -4.5], scale: 1.0 },
  { url: WHITE_POT_URL, pos: [8, 0, -4.5], scale: 1.0 },
];

useGLTF.preload(TREE_URL);
useGLTF.preload(POTTED_URL);
useGLTF.preload(WHITE_POT_URL);

const MANTU_FONT = "/office3d/fonts/Manrope-Medium.ttf";

/* ── Frosted glass wall panel — see-through, faint Mantu-purple tint ──────
   Use meshPhysicalMaterial with transmission so the wall is physically glassy.
   depthWrite={false} means the wall never occludes interior agents when
   orbiting to any angle.
   Tunable constants: GLASS_OPACITY (overall alpha), GLASS_TRANSMISSION (glass
   refraction amount), GLASS_ROUGHNESS (0=mirror glass, 1=fully frosted).    */
const GLASS_OPACITY = 0.15;       // ~0.12–0.20
const GLASS_TRANSMISSION = 0.9;   // how much light passes through
const GLASS_ROUGHNESS = 0.15;     // slight frost / diffusion

function GlassWallMaterial({
  tint = MANTU_PURPLE,
  opacity = GLASS_OPACITY,
}: {
  tint?: string;
  opacity?: number;
}) {
  return (
    <meshPhysicalMaterial
      color={tint}
      transmission={GLASS_TRANSMISSION}
      transparent
      opacity={opacity}
      roughness={GLASS_ROUGHNESS}
      metalness={0}
      thickness={0.22}
      side={THREE.DoubleSide}
      depthWrite={false}
    />
  );
}

export function OfficeRoom() {
  return (
    <group>
      <WoodFloor />
      {/* Perimeter glass walls removed: from the aerial "dollhouse" camera the
         side/front panels only cluttered the view (the right wall sliced across
         the middle). The branded back wall stays as the backdrop. */}
      <FeatureBackWall />
      <IndustrialCeiling />
      <CeilingBaffles />
      <PendantLights />
      <BarArea />
      {PLANT_DEFS.map((def, i) => (
        <PlantInstance key={i} url={def.url} pos={def.pos} scale={def.scale} />
      ))}
    </group>
  );
}

/* ── Warm honey-oak plank floor ────────────────────────────────────────── */
function WoodFloor() {
  // Centre the floor under both the room envelope and the desk grid (z 0…2.8).
  const cz = (Z_BACK + Z_FRONT) / 2;
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0, cz]}
      receiveShadow
    >
      <planeGeometry args={[ROOM_W, ROOM_D]} />
      {/* Richer warm oak — envMapIntensity adds subtle sheen in IBL */}
      <meshStandardMaterial
        color="#9B6535"
        roughness={0.65}
        metalness={0.05}
        envMapIntensity={0.6}
      />
    </mesh>
  );
}

/* ── Glass perimeter walls — frosted purple glass, fully see-through ─────── */
function WhiteWalls() {
  const cz = (Z_BACK + Z_FRONT) / 2;
  const hy = ROOM_H / 2;
  return (
    <group>
      {/* Right wall — frosted Mantu-purple glass */}
      <mesh position={[X_RIGHT, hy, cz]}>
        <boxGeometry args={[WALL_T, ROOM_H, ROOM_D]} />
        <GlassWallMaterial />
      </mesh>
      {/* Front wall (behind the camera) — frosted Mantu-purple glass */}
      <mesh position={[0, hy, Z_FRONT]}>
        <boxGeometry args={[ROOM_W, ROOM_H, WALL_T]} />
        <GlassWallMaterial />
      </mesh>
      {/* Left wall — daylight-blue glass (suggests a window wall) */}
      <mesh position={[X_LEFT, hy, cz]}>
        <boxGeometry args={[WALL_T, ROOM_H, ROOM_D]} />
        <GlassWallMaterial tint={WINDOW_BLUE} opacity={0.18} />
      </mesh>
    </group>
  );
}

/* ── Feature back wall: white brick + bold purple MANTU wordmark ───────── */
function FeatureBackWall() {
  const hy = ROOM_H / 2;
  return (
    <group>
      {/* Solid back wall — stays fully opaque so the MANTU wordmark reads cleanly */}
      <mesh position={[0, hy, Z_BACK]} receiveShadow>
        <boxGeometry args={[ROOM_W, ROOM_H, WALL_T]} />
        <meshStandardMaterial color={WALL_WHITE} roughness={0.9} metalness={0} side={THREE.DoubleSide} />
      </mesh>
      {/* Painted brick feature panel, just in front of the wall */}
      <mesh position={[0, 2.5, Z_BACK + 0.12]} receiveShadow>
        <planeGeometry args={[ROOM_W - 1, ROOM_H - 0.6]} />
        <meshStandardMaterial color={BRICK_WHITE} roughness={0.95} metalness={0} />
      </mesh>
      {/* Backlit acrylic sign panel behind the wordmark — bloom makes it glow */}
      <mesh position={[0, 2.9, Z_BACK + 0.13]}>
        <planeGeometry args={[8.4, 2.0]} />
        <meshStandardMaterial color="#1A0A26" emissive="#7F00DA" emissiveIntensity={0.4} roughness={0.35} />
      </mesh>
      {/* MANTU wordmark */}
      <Text
        font={MANTU_FONT}
        fontSize={1.3}
        color="#FFFFFF"
        anchorX="center"
        anchorY="middle"
        letterSpacing={0.12}
        position={[0, 2.9, Z_BACK + 0.16]}
      >
        MANTU
      </Text>
    </group>
  );
}

/* ── Dark exposed-industrial ceiling + duct runs ──────────────────────── */
function IndustrialCeiling() {
  const cz = (Z_BACK + Z_FRONT) / 2;
  return (
    <group>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, ROOM_H, cz]}>
        <planeGeometry args={[ROOM_W, ROOM_D]} />
        <meshStandardMaterial
          color={CEILING_GREY}
          roughness={0.95}
          metalness={0.1}
          side={THREE.BackSide}
        />
      </mesh>
      {/* Duct/pipe runs removed: 18-unit-long beams that, viewed end-on from the
         default camera, read as a tall wall slicing across the middle of the floor. */}
    </group>
  );
}

/* ── Colourful acoustic baffles hanging below the ceiling ─────────────── */
function CeilingBaffles() {
  return (
    <group>
      {BAFFLE_DEFS.map((b, i) => (
        <mesh
          key={i}
          position={[b.x, b.y, b.z]}
          rotation={[0, b.rot, 0]}
          castShadow
        >
          <boxGeometry args={[2.4, 0.14, 0.55]} />
          <meshStandardMaterial color={b.color} roughness={0.7} metalness={0.05} />
        </mesh>
      ))}
    </group>
  );
}

/* ── Black dome pendant lamps with warm emissive bulbs ────────────────── */
function PendantLights() {
  return (
    <group>
      {PENDANT_POSITIONS.map(([x, y, z], i) => {
        const cordLen = 1.2;
        const domeY = y - cordLen;
        return (
          <group key={i} position={[x, 0, z]}>
            {/* Cord */}
            <mesh position={[0, y - cordLen / 2, 0]}>
              <cylinderGeometry args={[0.008, 0.008, cordLen, 8]} />
              <meshStandardMaterial color={PENDANT_BLACK} roughness={0.6} />
            </mesh>
            {/* Half-sphere dome shade (open face points down) */}
            <mesh position={[0, domeY, 0]} rotation={[Math.PI, 0, 0]} castShadow>
              <sphereGeometry
                args={[0.22, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]}
              />
              <meshStandardMaterial
                color={PENDANT_BLACK}
                roughness={0.35}
                metalness={0.4}
                side={THREE.DoubleSide}
              />
            </mesh>
            {/* Warm bulb tucked inside the dome */}
            <mesh position={[0, domeY - 0.05, 0]}>
              <sphereGeometry args={[0.065, 12, 12]} />
              {/* High emissiveIntensity so the bloom effect picks up the bulbs */}
              <meshStandardMaterial
                color={BULB_WARM}
                emissive={BULB_WARM}
                emissiveIntensity={4.0}
              />
            </mesh>
            {/* A modest real point light so the pool of warmth reads on the floor */}
            <pointLight
              position={[0, domeY - 0.1, 0]}
              color={BULB_WARM}
              intensity={6}
              distance={6}
              decay={2}
            />
          </group>
        );
      })}
    </group>
  );
}

/* ── A single GLB plant prop, cloned + shadow-enabled per instance ─────── */
function PlantInstance({
  url,
  pos,
  scale,
}: {
  url: string;
  pos: [number, number, number];
  scale: number;
}) {
  const { scene } = useGLTF(url);
  const clone = useMemo(() => {
    const c = scene.clone(true);
    c.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    return c;
  }, [scene]);
  // Dispose cloned geometry + materials on unmount to prevent GPU leaks.
  useEffect(() => {
    return () => {
      clone.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry?.dispose();
          const m = child.material;
          (Array.isArray(m) ? m : [m]).forEach((mat) => mat?.dispose());
        }
      });
    };
  }, [clone]);

  return <primitive object={clone} position={pos} scale={scale} />;
}

/* ── Communal bar table + maroon-on-yellow stools ─────────────────────── */
function BarArea() {
  const base: [number, number, number] = [9.5, 0, -2];
  // Three stools arranged around the table.
  const stoolOffsets: [number, number][] = [
    [-0.95, 0.2],
    [0.95, 0.2],
    [0, -1.0],
  ];
  return (
    <group position={base}>
      {/* Tall bar table — white stem + round top */}
      <mesh position={[0, 0.51, 0]} castShadow>
        <cylinderGeometry args={[0.04, 0.06, 1.02, 12]} />
        <meshStandardMaterial color={BAR_WHITE} roughness={0.5} metalness={0.1} />
      </mesh>
      <mesh position={[0, 0.05, 0]} castShadow>
        <cylinderGeometry args={[0.32, 0.32, 0.04, 24]} />
        <meshStandardMaterial color={BAR_WHITE} roughness={0.5} metalness={0.1} />
      </mesh>
      <mesh position={[0, 1.08, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.55, 0.55, 0.06, 32]} />
        <meshStandardMaterial color={BAR_WHITE} roughness={0.45} metalness={0.1} />
      </mesh>
      {/* Stools */}
      {stoolOffsets.map(([sx, sz], i) => (
        <group key={i} position={[sx, 0, sz]}>
          {/* Maroon seat */}
          <mesh position={[0, 0.8, 0]} castShadow>
            <cylinderGeometry args={[0.2, 0.2, 0.06, 24]} />
            <meshStandardMaterial
              color={STOOL_MAROON}
              roughness={0.5}
              metalness={0.05}
            />
          </mesh>
          {/* Yellow stem */}
          <mesh position={[0, 0.4, 0]} castShadow>
            <cylinderGeometry args={[0.025, 0.025, 0.74, 12]} />
            <meshStandardMaterial color={STOOL_YELLOW} roughness={0.5} />
          </mesh>
          {/* Yellow cross base */}
          <mesh position={[0, 0.04, 0]} castShadow>
            <boxGeometry args={[0.42, 0.04, 0.05]} />
            <meshStandardMaterial color={STOOL_YELLOW} roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.04, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
            <boxGeometry args={[0.42, 0.04, 0.05]} />
            <meshStandardMaterial color={STOOL_YELLOW} roughness={0.5} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
