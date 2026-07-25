"use client";

import { Billboard, ContactShadows, OrbitControls, SoftShadows, Text, useGLTF } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { Canvas, useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { configureTextBuilder } from "troika-three-text";
import { InstancedAgents } from "./InstancedAgents";
import { OfficeRoom } from "./OfficeRoom";
import { OfficeFurniture } from "./OfficeFurniture";
import { SpriteCharacter, botKeyForColor } from "./SpriteCharacter";
import type { OfficeAgent, RenderAgent3D } from "./types";

/* ============================================================================
   The real R3F floor scene: one desk per agent in a grid, a robot (or the
   rigged CEO) sitting at each, billboarded nameplates, and a shared ref pool
   so each character reads its own render state in useFrame without React
   re-renders.

   Walking sim: each agent spawns near the front entrance, walks to their desk,
   and sits. Idle agents periodically leave for the bar/lounge area and wander
   before returning. Positions are mutated in-place on agentsRef each frame —
   no React re-renders in the hot path (mirrors the hermes AgentsLayer pattern).
   ========================================================================== */

// drei's <Text> (troika) defaults to spawning a blob Web Worker and fetching
// its font from a CDN. Disable the worker and point it at our locally-served
// Manrope so labels render offline. Runs once at module import.
configureTextBuilder({
  useWorker: false,
  defaultFontURL: "/office3d/fonts/Manrope-Medium.ttf",
});

const DESK_URL = "/office3d/assets/desk.glb";
const CHAIR_URL = "/office3d/assets/chairDesk.glb";
const SCREEN_URL = "/office3d/assets/computerScreen.glb";

useGLTF.preload(DESK_URL);
useGLTF.preload(CHAIR_URL);
useGLTF.preload(SCREEN_URL);

const NAMEPLATE_FONT = "/office3d/fonts/Manrope-Medium.ttf";

// ── Grid + placement constants ─────────────────────────────────────────────
const COLS = 6;
const COL_SPACING = 2.4;
const ROW_SPACING = 2.8;
const DESK_SCALE = 1;
/** Y offset: lift the robot feet above the chair seat. */
const CHAR_Y = 0.35;
/** Z offset from desk centre to the chair/character seat. */
const SEAT_Z_OFFSET = 0.45;
/** Agents rendered as full animated robots; the rest become instanced proxies. */
const FULL_CAP = 48;

// ── Walking sim constants ──────────────────────────────────────────────────
/** Walk speed in world units / second. */
const WALK_SPEED = 2.2;
/** How close the agent needs to be to count as "arrived". */
const ARRIVE_THRESHOLD = 0.1;
/** Z spawn position (front of room, close to camera at z=11). */
const ENTRANCE_Z = 7.5;

/** Lounge / rest spots agents wander to when idle (bar area + left lounge).
 *  Bar is at world [9.5, 0, -2]; room spans x: -13..+13, z: -6..+14. */
const LOUNGE_SPOTS: [number, number][] = [
  [8.5, -1.8],  // bar stool 1
  [10.5, -1.8], // bar stool 2
  [9.5, -3.0],  // behind bar
  [6.0, -2.5],  // open area between desks and bar
  [-7.5, -2.0], // left lounge (near plant)
  [-5.0, -3.0], // left lounge offset
];

// ── Sim controller state (per agent, held in a ref — no React state) ───────
type ControllerMode = "toDesk" | "atDesk" | "toLounge" | "atLounge" | "wander";
interface AgentController {
  mode: ControllerMode;
  goalX: number;
  goalZ: number;
  /** Countdown timer (seconds) used in atDesk and atLounge modes. */
  timer: number;
  prevStatus: OfficeAgent["status"];
  /** Which lounge spot this agent uses (round-robin seeded by id). */
  loungeIdx: number;
}

/**
 * Move `agent` one step toward (tx, tz) at WALK_SPEED.
 * Mutates agent.x, agent.y (=3D Z), agent.facing, agent.state in place.
 * Returns true when the agent has arrived.
 */
function moveTo(
  agent: RenderAgent3D,
  tx: number,
  tz: number,
  step: number,
): boolean {
  const dx = tx - agent.x;
  const dz = tz - agent.y; // agent.y stores 3D Z (hermes convention)
  const dist = Math.hypot(dx, dz);
  if (dist <= ARRIVE_THRESHOLD) {
    agent.x = tx;
    agent.y = tz;
    agent.state = "standing";
    return true;
  }
  const move = Math.min(dist, WALK_SPEED * step);
  agent.x += (dx / dist) * move;
  agent.y += (dz / dist) * move;
  // rotation.y = atan2(-dx,-dz) makes the character face its movement direction
  // (in THREE.js default-forward is -Z; atan2(-dx,-dz) maps XZ movement → Y rot).
  const targetFacing = Math.atan2(-dx, -dz);
  let df = targetFacing - agent.facing;
  if (df > Math.PI) df -= Math.PI * 2;
  if (df < -Math.PI) df += Math.PI * 2;
  agent.facing += df * Math.min(1, step * 10); // smooth turn
  agent.state = "walking";
  return false;
}

// ── Status dot colour ──────────────────────────────────────────────────────
const STATUS_COLOR: Record<OfficeAgent["status"], string> = {
  working: "#22C55E",
  idle: "#6B7280",
  error: "#EF4444",
};
function statusColorFor(status: OfficeAgent["status"]): string {
  return STATUS_COLOR[status];
}

interface Floor3DSceneProps {
  agents: OfficeAgent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function Floor3DScene({
  agents,
  selectedId,
  onSelect,
}: Floor3DSceneProps) {
  const fullAgents = agents.slice(0, FULL_CAP);
  const overflowAgents = agents.slice(FULL_CAP);
  return (
    <Canvas
      shadows
      dpr={[1, 1.5]}
      camera={{ position: [2.5, 7.5, 14.5], fov: 42 }}
      gl={{ toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.08 }}
      style={{ width: "100%", height: "100%" }}
    >
      <SceneContents
        agents={fullAgents}
        overflowAgents={overflowAgents}
        selectedId={selectedId}
        onSelect={onSelect}
      />
    </Canvas>
  );
}

/** djb2-style hash → [0, 1). Deterministic per id (no Math.random). */
function seedFromId(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) {
    h = (Math.imul(h, 33) ^ id.charCodeAt(i)) >>> 0;
  }
  return (h % 10000) / 10000;
}

function SceneContents({
  agents,
  overflowAgents,
  selectedId,
  onSelect,
}: Floor3DSceneProps & { overflowAgents: OfficeAgent[] }) {
  const agentsRef = useRef<RenderAgent3D[]>([]);
  const agentLookupRef = useRef<Map<string, RenderAgent3D>>(new Map());
  const controllerRef = useRef<Map<string, AgentController>>(new Map());
  /** Computed desk seat world positions keyed by agent id. */
  const deskSeatRef = useRef<Map<string, { x: number; z: number; facing: number }>>(new Map());
  const lightRef = useRef<THREE.DirectionalLight>(null);

  // Reconcile the render-agent pool whenever the set of agents changes, keeping
  // existing agents' positions so they don't teleport on a profile refresh.
  // Also recomputes desk seat positions (they depend on the full sorted list).
  useLayoutEffect(() => {
    // 1. Compute desk seat positions (same grid logic as DeskUnit below).
    const seats = new Map<string, { x: number; z: number; facing: number }>();
    agents.forEach((agent, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const rowCount = Math.min(COLS, agents.length - row * COLS);
      const x = (col - (rowCount - 1) / 2) * COL_SPACING;
      const z = row * ROW_SPACING;
      seats.set(agent.id, { x, z: z + SEAT_Z_OFFSET, facing: Math.PI });
    });
    deskSeatRef.current = seats;

    // 2. Reconcile render-agent pool: preserve existing positions,
    //    spawn new agents near the front entrance.
    const prev = agentLookupRef.current;
    const next: RenderAgent3D[] = agents.map((agent) => {
      const existing = prev.get(agent.id);
      if (existing) return { ...existing, ...agent };
      // New agent: spawn at entrance with a seeded X spread so they don't stack.
      const entranceX = (seedFromId(agent.id) * 2 - 1) * 4;
      return {
        ...agent,
        x: entranceX,
        y: ENTRANCE_Z,       // agent.y = 3D Z
        facing: 0,           // face toward back of room (-Z direction)
        state: "walking" as const,
        frame: seedFromId(agent.id) * 240,
        phaseOffset: seedFromId(`${agent.id}_phase`) * Math.PI * 2,
      };
    });
    agentsRef.current = next;
    const lookup = new Map<string, RenderAgent3D>();
    for (const a of next) lookup.set(a.id, a);
    agentLookupRef.current = lookup;

    // 3. Drop controller state for removed agents; nudge goal for moved ones.
    const ctrl = controllerRef.current;
    for (const id of [...ctrl.keys()]) {
      if (!lookup.has(id)) ctrl.delete(id);
    }
    for (const [id, c] of ctrl) {
      const seat = seats.get(id);
      if (!seat) continue;
      if (c.mode === "toDesk" || c.mode === "atDesk") {
        c.goalX = seat.x;
        c.goalZ = seat.z;
      }
    }
  }, [agents]);

  // Configure the directional light's shadow camera once.
  useLayoutEffect(() => {
    const light = lightRef.current;
    if (!light) return;
    light.shadow.mapSize.set(2048, 2048);
    light.shadow.camera.near = 0.5;
    light.shadow.camera.far = 80;
    light.shadow.camera.top = 20;
    light.shadow.camera.bottom = -5;
    light.shadow.camera.left = -20;
    light.shadow.camera.right = 20;
    light.shadow.camera.updateProjectionMatrix();
  }, []);

  // ── Walking-sim controller ─────────────────────────────────────────────
  // Mutates RenderAgent3D records in place — zero React re-renders.
  useFrame((_, delta) => {
    const step = Math.min(delta, 0.05);
    for (const ra of agentsRef.current) {
      const seat = deskSeatRef.current.get(ra.id);
      if (!seat) continue;

      // Initialise controller on first sight of this agent.
      let ctrl = controllerRef.current.get(ra.id);
      if (!ctrl) {
        ctrl = {
          mode: "toDesk",
          goalX: seat.x,
          goalZ: seat.z,
          timer: 0,
          prevStatus: ra.status,
          loungeIdx: Math.floor(seedFromId(ra.id) * LOUNGE_SPOTS.length),
        };
        controllerRef.current.set(ra.id, ctrl);
      }

      // Detect status transitions and redirect as needed.
      if (ctrl.prevStatus !== ra.status) {
        ctrl.prevStatus = ra.status;
        if (ra.status === "working" || ra.status === "error") {
          ctrl.mode = "toDesk";
          ctrl.goalX = seat.x;
          ctrl.goalZ = seat.z;
        } else if (ra.status === "idle" && ctrl.mode === "atDesk") {
          // Fresh idle timer so the agent sits for a moment before wandering.
          ctrl.timer = 3 + Math.random() * 5;
        }
      }

      switch (ctrl.mode) {
        case "toDesk": {
          const arrived = moveTo(ra, ctrl.goalX, ctrl.goalZ, step);
          if (arrived) {
            ra.facing = seat.facing;
            ra.state = "sitting";
            ctrl.mode = "atDesk";
            ctrl.timer = ra.status === "idle" ? 3 + Math.random() * 5 : 0;
          }
          break;
        }

        case "atDesk": {
          // Pin position exactly to the seat while seated.
          // eslint-disable-next-line -- intentional in-place mutation
          ra.x = seat.x;
          // eslint-disable-next-line -- intentional in-place mutation
          ra.y = seat.z;
          // eslint-disable-next-line -- intentional in-place mutation
          ra.facing = seat.facing;
          // eslint-disable-next-line -- intentional in-place mutation
          ra.state = "sitting";

          if (ra.status === "idle") {
            ctrl.timer -= step;
            if (ctrl.timer <= 0) {
              const [lx, lz] = LOUNGE_SPOTS[ctrl.loungeIdx];
              ctrl.mode = "toLounge";
              ctrl.goalX = lx;
              ctrl.goalZ = lz;
            }
          }
          break;
        }

        case "toLounge": {
          if (ra.status !== "idle") {
            ctrl.mode = "toDesk";
            ctrl.goalX = seat.x;
            ctrl.goalZ = seat.z;
            break;
          }
          const arrived = moveTo(ra, ctrl.goalX, ctrl.goalZ, step);
          if (arrived) {
            ctrl.mode = "atLounge";
            ctrl.timer = 5 + Math.random() * 8;
            // eslint-disable-next-line -- intentional in-place mutation
            ra.state = "standing";
          }
          break;
        }

        case "atLounge": {
          // eslint-disable-next-line -- intentional in-place mutation
          ra.state = "standing";
          if (ra.status !== "idle") {
            ctrl.mode = "toDesk";
            ctrl.goalX = seat.x;
            ctrl.goalZ = seat.z;
            break;
          }
          ctrl.timer -= step;
          if (ctrl.timer <= 0) {
            // Wander a short distance from the current lounge spot.
            const angle = Math.random() * Math.PI * 2;
            const dist = 1 + Math.random() * 2.5;
            ctrl.mode = "wander";
            ctrl.goalX = Math.max(-11, Math.min(11, ra.x + Math.cos(angle) * dist));
            ctrl.goalZ = Math.max(-5.5, Math.min(12, ra.y + Math.sin(angle) * dist));
          }
          break;
        }

        case "wander": {
          if (ra.status !== "idle") {
            ctrl.mode = "toDesk";
            ctrl.goalX = seat.x;
            ctrl.goalZ = seat.z;
            break;
          }
          const arrived = moveTo(ra, ctrl.goalX, ctrl.goalZ, step);
          if (arrived) {
            // Return to desk after wandering.
            ctrl.mode = "toDesk";
            ctrl.goalX = seat.x;
            ctrl.goalZ = seat.z;
          }
          break;
        }
      }
    }
  });

  return (
    <>
      {/* Clean, on-brand backdrop so the office reads as a bright set.
         (The sprawling dark CityWorld was removed — its 260×260 ground + road
         planes were what sliced across the view as a "wall in the middle".) */}
      <color attach="background" args={["#ECE8F2"]} />

      {/* PCSS soft-shadow patch — feathers directional shadow edges */}
      <SoftShadows size={22} focus={0.5} samples={16} />

      {/* Warm fill + sky/ground bounce */}
      <ambientLight color="#FFF6E8" intensity={0.38} />
      <hemisphereLight
        color="#FFF4E0"
        groundColor="#D4A96A"
        intensity={0.32}
      />
      {/* Warm key from upper-right — dominant so shadows + form read */}
      <directionalLight
        ref={lightRef}
        castShadow
        position={[6, 9, 5]}
        intensity={0.95}
        color="#FFF8F0"
      />
      {/* Cool rim from upper-left-back — adds depth + glass-edge sparkle */}
      <directionalLight
        position={[-5, 6, -7]}
        intensity={0.18}
        color="#C8E4FF"
      />

      {/* Baked contact shadows on the floor */}
      <ContactShadows
        position={[0, 0.01, 2]}
        width={24}
        height={20}
        far={5}
        blur={1.6}
        opacity={0.45}
        color="#1A0A2E"
      />

      {/* The office set — loads in its own Suspense */}
      <Suspense fallback={null}>
        <OfficeRoom />
      </Suspense>

      {/* Claw3D-style furniture: lounge, kitchen, meeting area, bookcases, plants */}
      <Suspense fallback={null}>
        <OfficeFurniture />
      </Suspense>

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        target={[0, 1.3, -2.5]}
        minPolarAngle={0.22}
        maxPolarAngle={Math.PI * 0.44}
        minDistance={6}
        maxDistance={34}
      />

      <Suspense fallback={null}>
        {/* Desks are static — fixed at their grid slots, no character inside. */}
        {agents.map((agent, i) => {
          const col = i % COLS;
          const row = Math.floor(i / COLS);
          const rowCount = Math.min(COLS, agents.length - row * COLS);
          const x = (col - (rowCount - 1) / 2) * COL_SPACING;
          const z = row * ROW_SPACING;
          return (
            <DeskUnit
              key={agent.id}
              position={[x, 0, z]}
            />
          );
        })}

        {/* Characters are free-moving — positioned by the sim each frame. */}
        {agents.map((agent) => (
          <CharacterWrapper
            key={agent.id}
            agent={agent}
            selected={selectedId === agent.id}
            agentsRef={agentsRef}
            agentLookupRef={agentLookupRef}
            onSelect={onSelect}
          />
        ))}
      </Suspense>

      {/* LOD tail: agents beyond the full-detail cap as cheap instanced proxies. */}
      <InstancedAgents agents={overflowAgents} startIndex={FULL_CAP} />

      {/* Post-processing: subtle bloom on emissive robot eyes + pendant bulbs. */}
      <EffectComposer enableNormalPass={false} multisampling={4}>
        <Bloom
          luminanceThreshold={0.72}
          luminanceSmoothing={0.2}
          intensity={0.5}
          mipmapBlur
          radius={0.78}
        />
      </EffectComposer>
    </>
  );
}

// ── Static desk furniture — no agent inside; the sim positions them separately.
function DeskUnit({ position }: { position: [number, number, number] }) {
  const { scene: deskScene } = useGLTF(DESK_URL);
  const { scene: chairScene } = useGLTF(CHAIR_URL);
  const { scene: screenScene } = useGLTF(SCREEN_URL);

  const desk = useMemo(() => deskScene.clone(true), [deskScene]);
  const chair = useMemo(() => chairScene.clone(true), [chairScene]);
  const screen = useMemo(() => screenScene.clone(true), [screenScene]);

  useMemo(() => {
    for (const root of [desk, chair, screen]) {
      root.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
    }
  }, [desk, chair, screen]);

  // Dispose cloned geometry + materials on unmount to prevent GPU leaks.
  // The source GLB scenes (from useGLTF) are shared and must NOT be disposed;
  // only the scene.clone(true) copies we own are cleaned up here.
  useEffect(() => {
    return () => {
      for (const clone of [desk, chair, screen]) {
        clone.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            const mats = Array.isArray(child.material)
              ? child.material
              : [child.material];
            for (const mat of mats) mat.dispose();
          }
        });
      }
    };
  }, [desk, chair, screen]);

  return (
    <group position={position}>
      <primitive object={desk} scale={DESK_SCALE} />
      <primitive object={chair} scale={DESK_SCALE} position={[0, 0, SEAT_Z_OFFSET]} />
      <primitive object={screen} scale={DESK_SCALE} position={[0, 0.75, -0.2]} />
    </group>
  );
}

// ── Moving character: positioned by the sim every frame via wrapperRef. ─────
// The DESK stays fixed; only the CHARACTER moves. Nameplate + status dot follow.
function CharacterWrapper({
  agent,
  selected,
  agentsRef,
  agentLookupRef,
  onSelect,
}: {
  agent: OfficeAgent;
  selected: boolean;
  agentsRef: React.MutableRefObject<RenderAgent3D[]>;
  agentLookupRef: React.MutableRefObject<Map<string, RenderAgent3D>>;
  onSelect: (id: string) => void;
}) {
  const wrapperRef = useRef<THREE.Group>(null);
  const charGroupRef = useRef<THREE.Group>(null);

  // Sync world position + heading from the live sim record each frame.
  // Adjusts character Y: CHAR_Y above floor when seated, 0 when walking/standing.
  useFrame(() => {
    const wrapper = wrapperRef.current;
    const charGroup = charGroupRef.current;
    if (!wrapper || !charGroup) return;
    const ra = agentLookupRef.current.get(agent.id);
    if (!ra) return;
    wrapper.position.x = ra.x;
    wrapper.position.z = ra.y;          // agent.y stores 3D Z
    wrapper.rotation.y = ra.facing;
    charGroup.position.y = ra.state === "sitting" ? CHAR_Y : 0;
  });

  return (
    <group
      ref={wrapperRef}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(agent.id);
      }}
    >
      {/* Nameplate + status dot — always face the camera at a fixed height. */}
      <Billboard position={[0, 1.5, 0]}>
        <Text
          font={NAMEPLATE_FONT}
          fontSize={0.12}
          color={selected ? "#3DE1FF" : "white"}
          anchorX="center"
          anchorY="middle"
          maxWidth={1.8}
          outlineWidth={0.004}
          outlineColor="#000000"
        >
          {agent.name}
        </Text>
        <mesh position={[0, -0.14, 0]}>
          <sphereGeometry args={[0.045, 12, 12]} />
          <meshStandardMaterial
            color={statusColorFor(agent.status)}
            emissive={statusColorFor(agent.status)}
            emissiveIntensity={0.6}
          />
        </mesh>
      </Billboard>

      {/* Official Aria character sprite; charGroupRef.position.y handles height. */}
      <group ref={charGroupRef}>
        <SpriteCharacter charKey={agent.position === "ceo" ? "human" : botKeyForColor(agent.color)} />
      </group>
    </group>
  );
}
