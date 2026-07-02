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

import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense, useMemo, useState } from "react";
import "./core/troikaConfig"; // main-thread text layout (CSP blocks blob: workers)
import type { OfficeAgent } from "@/components/floor3d/types";
import { getDeviceQuality, MAX_3D_AGENTS, type DeviceQuality } from "@/lib/device";
import { RobotAgentModel } from "./objects/RobotAgentModel";
import { RetroEnvironment } from "./scene/RetroEnvironment";
import { PacketFX } from "./scene/PacketFX";
import { useAgentTick } from "./systems/agentTick";

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
        target={[0, 1.2, -1]}
        maxPolarAngle={Math.PI / 2.2}
        minDistance={5}
        maxDistance={42}
        enablePan
        dampingFactor={0.08}
        enableDamping
      />

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
    </>
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
