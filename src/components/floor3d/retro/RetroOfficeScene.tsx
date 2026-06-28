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
import { Suspense } from "react";
import "./core/troikaConfig"; // main-thread text layout (CSP blocks blob: workers)
import type { OfficeAgent } from "@/components/floor3d/types";
import { RobotAgent } from "./objects/RobotAgent";
import { OfficeEnvironment } from "./scene/OfficeEnvironment";
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
}: RetroOfficeSceneProps) {
  const { renderAgentsRef, renderAgentLookupRef } = useAgentTick(agents);

  return (
    <>
      {/* Light backdrop so the open floor reads as a bright set, not a dark void. */}
      <color attach="background" args={["#ECE8F2"]} />

      {/* Fog to soften the far edges of the open floor without swallowing the sign. */}
      <fog attach="fog" args={["#ECE8F2", 28, 65]} />

      {/* Lighting */}
      <ambientLight intensity={0.55} />
      <directionalLight
        position={[8, 20, 12]}
        intensity={0.9}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-near={1}
        shadow-camera-far={60}
        shadow-camera-left={-18}
        shadow-camera-right={18}
        shadow-camera-top={18}
        shadow-camera-bottom={-18}
      />
      <directionalLight position={[-10, 12, -8]} intensity={0.3} color="#b8d4ff" />

      {/* Camera controls — target pulled toward the back wall so the Mantu
          sign stays in frame by default while still allowing full orbit. */}
      <OrbitControls
        target={[0, 1.5, -7]}
        maxPolarAngle={Math.PI / 2.1}
        minDistance={4}
        maxDistance={46}
        enablePan
        dampingFactor={0.08}
        enableDamping
      />

      {/* Static office environment */}
      <Suspense fallback={null}>
        <OfficeEnvironment />
      </Suspense>

      {/* Animated agents — official Aria robot/human characters */}
      {agents.map((agent) => (
        <RobotAgent
          key={agent.id}
          agentId={agent.id}
          name={agent.name}
          subtitle={agent.subtitle}
          status={agent.status}
          color={agent.color}
          position={agent.position}
          selected={selectedId === agent.id}
          agentsRef={renderAgentsRef}
          agentLookupRef={renderAgentLookupRef}
          onClick={onSelect}
        />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Root — wraps the Canvas
// ---------------------------------------------------------------------------
export default function RetroOfficeScene(props: RetroOfficeSceneProps) {
  return (
    <Canvas
      camera={{ position: [0, 9, 19], fov: 55 }}
      shadows
      gl={{ antialias: true, alpha: false }}
      style={{ background: "#ECE8F2" }}
      dpr={[1, Math.min(typeof window !== "undefined" ? window.devicePixelRatio : 1, 1.5)]}
    >
      <Suspense fallback={null}>
        <SceneContents {...props} />
      </Suspense>
    </Canvas>
  );
}
