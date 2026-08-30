"use client";
/**
 * NOTICE: Ported from iamlukethedev/Claw3D (MIT License)
 * https://github.com/iamlukethedev/Claw3D
 *
 * Adapted for:
 *   React 18 / @react-three/fiber 8 / @react-three/drei 9 / three 0.169
 * from the original React 19 / fiber 9 / drei 10 / three 0.183 codebase.
 *
 * Mount via:
 *   const RetroOfficeScene = dynamic(
 *     () => import("@/components/floor3d/retro/RetroOfficeScene"),
 *     { ssr: false },
 *   );
 *   <RetroOfficeScene agents={agents} onSelect={onSelect} />
 */

import { Billboard, OrbitControls, Text } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import "./core/troikaConfig"; // main-thread text layout (CSP blocks blob: workers)
import type { OfficeAgent } from "@/lib/floor3d";
import { getDeviceQuality, MAX_3D_AGENTS, type DeviceQuality } from "@/lib/device";
import {
  getDirectorTarget,
  subscribeDirectorTarget,
  type DirectorTarget,
} from "@/lib/demo/aria-live";
import { RobotAgentModel } from "./objects/RobotAgentModel";
import { RetroEnvironment } from "./scene/RetroEnvironment";
import { PacketFX } from "./scene/PacketFX";
import { useAgentTick } from "./systems/agentTick";
import { toWorld } from "./core/geometry";
import type { RenderAgent } from "./core/types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface RetroOfficeSceneProps {
  agents: OfficeAgent[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Inner scene — rendered inside the Canvas context
// ---------------------------------------------------------------------------
function SceneContents({
  agents,
  selectedId,
  onSelect,
  quality,
}: RetroOfficeSceneProps & { quality: DeviceQuality }) {
  const low = quality === "low";
  // Cap the number of full-detail robot models so a large deployed fleet can't
  // white-screen a weak GPU. CEO + selected + the rest, then sliced. The floor's
  // 2D grid view shows the entire fleet without this cap.
  const shownAgents = useMemo(() => {
    const cap = MAX_3D_AGENTS[quality];
    if (agents.length <= cap) return agents;
    const ranked = [...agents].sort((a, b) => {
      const pri = (x: OfficeAgent) => (x.position === "ceo" ? 0 : x.id === selectedId ? 1 : 2);
      return pri(a) - pri(b);
    });
    return ranked.slice(0, cap);
  }, [agents, quality, selectedId]);

  const { renderAgentsRef, renderAgentLookupRef } = useAgentTick(shownAgents);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);

  // CEO agent id — doubles as the Living Floor's "central hub" that packets
  // fly to (PacketFX.tsx). The priority sort above always keeps the CEO in
  // shownAgents (pri 0), so this resolves whenever at least one seat exists.
  const ceoId = useMemo(
    () => shownAgents.find((a) => a.position === "ceo")?.id ?? null,
    [shownAgents],
  );

  return (
    <>
      {/* Lighting — the secondary fill light and shadow map scale with quality. */}
      <ambientLight intensity={low ? 0.7 : 0.55} />
      <directionalLight
        position={[8, 20, 12]}
        intensity={0.9}
        castShadow={!low}
        shadow-mapSize-width={low ? 512 : 1024}
        shadow-mapSize-height={low ? 512 : 1024}
        shadow-camera-near={1}
        shadow-camera-far={60}
        shadow-camera-left={-18}
        shadow-camera-right={18}
        shadow-camera-top={18}
        shadow-camera-bottom={-18}
      />
      {!low && <directionalLight position={[-10, 12, -8]} intensity={0.3} color="#b8d4ff" />}

      {/* Camera controls — target lifted to character height so the agents
          read prominently by default while still allowing a full orbit. */}
      <OrbitControls
        ref={controlsRef}
        target={[0, 1.2, -1]}
        maxPolarAngle={Math.PI / 2.2}
        minDistance={5}
        maxDistance={42}
        enablePan
        dampingFactor={0.08}
        enableDamping
      />

      {/* Aria Live (Demo Director) — additive, off by default. Only lerps the
          OrbitControls *target* (never touches camera.position directly, so
          user drag/zoom keeps working exactly as before) toward whichever
          robot is currently "acting" in a running Aria Live cinematic. When
          no run is active `getDirectorTarget()` is null and this is a no-op
          every frame — the camera behaves exactly as it did before this
          existed. See src/lib/demo/aria-live.ts for the run itself. */}
      <AriaLiveDirector controlsRef={controlsRef} agentsRef={renderAgentsRef} />

      {/* Static office environment */}
      <Suspense fallback={null}>
        <RetroEnvironment />
      </Suspense>

      {/* Animated agents — official built characters (robots + CEO human) */}
      {shownAgents.map((agent) => (
        <RobotAgentModel
          key={agent.id}
          agentId={agent.id}
          name={agent.name}
          subtitle={agent.subtitle}
          status={agent.status}
          color={agent.color}
          isHuman={agent.position === "ceo"}
          agentsRef={renderAgentsRef}
          agentLookupRef={renderAgentLookupRef}
          onSelect={onSelect}
          selected={selectedId === agent.id}
        />
      ))}

      {/* Living-floor FX: pooled packets + status-pulse halos reacting to
          the real agent-events bus. Hard-gated off the "low" device tier —
          which already folds in prefers-reduced-motion (src/lib/device.ts)
          — so those sessions render zero extra draw calls/sound; the 2D
          activity ticker (src/app/floor/page.tsx) is their guaranteed
          fallback. */}
      {!low && <PacketFX agentsRef={renderAgentsRef} ceoId={ceoId} />}

      {/* Mission Control floating labels — same tier gate as PacketFX (the
          "low" tier already folds in prefers-reduced-motion). Hard-capped to
          2 at once: the agent that most recently fired an agent-event, plus
          whichever agent is selected. */}
      {!low && <AgentActivityLabels agentsRef={renderAgentsRef} selectedId={selectedId ?? null} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Aria Live (Demo Director) camera — additive, off by default (workstream
// 3.1). Subscribes to the tiny module-level pub/sub in src/lib/demo/aria-live.ts
// instead of a prop, because the trigger (TopBar / ⌘K) and this scene have no
// shared React context available to thread one through (Floor3D.tsx and
// floor/page.tsx are owned by another workstream and out of scope here).
// Never touches agentTick's nav/collision fields, PacketFX, or the perf caps
// — it only reads renderAgentsRef positions and re-aims OrbitControls' target.
// ---------------------------------------------------------------------------
const ESTABLISHING_TARGET = new THREE.Vector3(0, 1.2, -1); // matches OrbitControls' static default above
const DIRECTOR_LERP = 0.06;

function AriaLiveDirector({
  controlsRef,
  agentsRef,
}: {
  controlsRef: RefObject<OrbitControlsImpl | null>;
  agentsRef: RefObject<RenderAgent[]>;
}) {
  const [target, setTarget] = useState<DirectorTarget>(() =>
    typeof window === "undefined" ? null : getDirectorTarget(),
  );
  useEffect(() => subscribeDirectorTarget(setTarget), []);

  const desired = useRef(new THREE.Vector3());

  useFrame(() => {
    const controls = controlsRef.current;
    // No active Aria Live run (the common case): touch nothing, every frame.
    // This is the entire "off by default" contract — the camera/OrbitControls
    // behave exactly as they did before this hook existed.
    if (!controls || !target) return;

    if ("establishing" in target) {
      desired.current.copy(ESTABLISHING_TARGET);
    } else {
      const agent = agentsRef.current?.find((a) => a.id === target.seatId);
      if (!agent) return;
      const [wx, , wz] = toWorld(agent.x, agent.y);
      desired.current.set(wx, 1.4, wz);
    }
    controls.target.lerp(desired.current, DIRECTOR_LERP);
    controls.update();
  });

  return null;
}

// ---------------------------------------------------------------------------
// Mission Control floating labels (workstream 1.5) — small troika-text
// callouts over, at most, two agents at once: whichever agent most recently
// fired an agent-event (PacketFX's live pulseUntil/emit marker, read-only
// here — PacketFX.tsx alone writes it), and whichever agent is selected.
// Positioned every frame from the same live renderAgentsRef the characters
// and PacketFX already read; never mutates nav/collision fields. Text comes
// from `subtitle`, which every agent already carries end-to-end from
// `agentActivity()` (src/lib/floor.ts) via `seatsToOfficeAgents`
// (src/lib/floor3d.ts) — no new plumbing, no fabricated copy.
// ---------------------------------------------------------------------------
const LABEL_FONT = "/office3d/fonts/Manrope-SemiBold.ttf";
const LABEL_Y = 1.95;
const LABEL_MAX_CHARS = 46;
const ACTIVE_ACCENT = "#22D3EE"; // matches EVENT_COLOR.source (src/lib/floor3d.ts)
const SELECTED_ACCENT = "#8ab4ff"; // matches the selection pulse ring (RobotAgentModel.tsx)

type FloorLabel = { id: string; text: string } | null;

function truncateLabel(text: string): string {
  const t = text.trim();
  return t.length > LABEL_MAX_CHARS ? `${t.slice(0, LABEL_MAX_CHARS - 1)}…` : t;
}

function AgentActivityLabels({
  agentsRef,
  selectedId,
}: {
  agentsRef: RefObject<RenderAgent[]>;
  selectedId: string | null;
}) {
  const activeGroupRef = useRef<THREE.Group>(null);
  const selectedGroupRef = useRef<THREE.Group>(null);
  const [activeLabel, setActiveLabel] = useState<FloorLabel>(null);
  const [selectedLabel, setSelectedLabel] = useState<FloorLabel>(null);
  const activeSeen = useRef<FloorLabel>(null);
  const selectedSeen = useRef<FloorLabel>(null);

  useFrame(() => {
    const agents = agentsRef.current ?? [];
    const now = Date.now();

    // The single most-recently-pulsing agent — never all pulsing agents —
    // so this slot alone can never exceed one label.
    let active: RenderAgent | null = null;
    let mostRecentAt = -Infinity;
    for (const a of agents) {
      if (a.pulseUntil && a.pulseUntil > now) {
        const at = a.emit?.at ?? 0;
        if (at > mostRecentAt) {
          mostRecentAt = at;
          active = a;
        }
      }
    }
    const selected = selectedId ? (agents.find((a) => a.id === selectedId) ?? null) : null;
    // Hard cap at 2 (active + selected): if the responder IS the selected
    // agent, only the "selected" slot renders it — never double a robot.
    const activeToShow = active && active.id !== selected?.id ? active : null;

    // Slot 1 — active responder.
    if (!activeToShow || !activeGroupRef.current) {
      if (activeGroupRef.current) activeGroupRef.current.visible = false;
      if (activeSeen.current !== null) {
        activeSeen.current = null;
        setActiveLabel(null);
      }
    } else {
      const [wx, , wz] = toWorld(activeToShow.x, activeToShow.y);
      activeGroupRef.current.position.set(wx, LABEL_Y, wz);
      activeGroupRef.current.visible = true;
      const text = truncateLabel((activeToShow.subtitle && activeToShow.subtitle.trim()) || activeToShow.name);
      if (!activeSeen.current || activeSeen.current.id !== activeToShow.id || activeSeen.current.text !== text) {
        const next = { id: activeToShow.id, text };
        activeSeen.current = next;
        setActiveLabel(next);
      }
    }

    // Slot 2 — selected agent.
    if (!selected || !selectedGroupRef.current) {
      if (selectedGroupRef.current) selectedGroupRef.current.visible = false;
      if (selectedSeen.current !== null) {
        selectedSeen.current = null;
        setSelectedLabel(null);
      }
    } else {
      const [wx, , wz] = toWorld(selected.x, selected.y);
      selectedGroupRef.current.position.set(wx, LABEL_Y, wz);
      selectedGroupRef.current.visible = true;
      const text = truncateLabel((selected.subtitle && selected.subtitle.trim()) || selected.name);
      if (!selectedSeen.current || selectedSeen.current.id !== selected.id || selectedSeen.current.text !== text) {
        const next = { id: selected.id, text };
        selectedSeen.current = next;
        setSelectedLabel(next);
      }
    }
  });

  return (
    <>
      <FloorLabelBillboard groupRef={activeGroupRef} label={activeLabel} accent={ACTIVE_ACCENT} tag="ACTIVE" />
      <FloorLabelBillboard groupRef={selectedGroupRef} label={selectedLabel} accent={SELECTED_ACCENT} tag="SELECTED" />
    </>
  );
}

function FloorLabelBillboard({
  groupRef,
  label,
  accent,
  tag,
}: {
  groupRef: RefObject<THREE.Group | null>;
  label: FloorLabel;
  accent: string;
  tag: string;
}) {
  const planeW = 1.35;
  const planeH = 0.4;
  return (
    <group ref={groupRef} visible={false}>
      {label ? (
        <Billboard>
          <mesh position={[0, 0, -0.001]}>
            <planeGeometry args={[planeW, planeH]} />
            <meshBasicMaterial color="#080c14" transparent opacity={0.86} />
          </mesh>
          <mesh position={[-planeW / 2 + 0.02, 0, 0]}>
            <planeGeometry args={[0.03, planeH]} />
            <meshBasicMaterial color={accent} />
          </mesh>
          <Text
            font={LABEL_FONT}
            position={[0, 0.1, 0.001]}
            fontSize={0.062}
            color={accent}
            anchorX="center"
            anchorY="middle"
            letterSpacing={0.08}
          >
            {tag}
          </Text>
          <Text
            font={LABEL_FONT}
            position={[0, -0.06, 0.001]}
            fontSize={0.088}
            color="#e8dfc0"
            anchorX="center"
            anchorY="middle"
            maxWidth={planeW - 0.16}
          >
            {label.text}
          </Text>
        </Billboard>
      ) : null}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Root — wraps the Canvas
// ---------------------------------------------------------------------------
export default function RetroOfficeScene(props: RetroOfficeSceneProps) {
  // Resolve the device tier BEFORE the Canvas's first commit — r3f locks the WebGL
  // context attributes (antialias/powerPreference) at creation, so a post-mount
  // effect would be too late. getDeviceQuality is SSR-safe ("high" with no window).
  const [quality] = useState<DeviceQuality>(() => getDeviceQuality());
  const low = quality === "low";

  return (
    <Canvas
      camera={{ position: [2, 9, 15], fov: 50 }}
      shadows={!low}
      gl={{ antialias: !low, alpha: false, powerPreference: "high-performance" }}
      style={{ background: "#1a1f2e" }}
      dpr={
        low
          ? 1
          : [1, Math.min(typeof window !== "undefined" ? window.devicePixelRatio : 1, 1.5)]
      }
    >
      <Suspense fallback={null}>
        <SceneContents {...props} quality={quality} />
      </Suspense>
    </Canvas>
  );
}
