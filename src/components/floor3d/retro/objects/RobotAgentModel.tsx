"use client";
// Retro-scene agent wrapper that renders the OFFICIAL built characters:
//   • employees → RobotCharacter (glossy toy robot, colour-coded)
//   • CEO seat  → RiggedCharacter (biz_man.glb human)
// It keeps the retro positioning/nameplate/status system (toWorld + ref-driven
// motion) and delegates the body + limb animation to those character components,
// which read the SAME live agent record from the shared refs each frame.

import { Billboard, Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { memo, useRef, type MutableRefObject, type RefObject } from "react";
import * as THREE from "three";
import { RobotCharacter } from "@/components/floor3d/RobotCharacter";
import { RiggedCharacter, RIGGED_MAN_URL } from "@/components/floor3d/RiggedCharacter";
import type { RenderAgent3D } from "@/lib/floor3d";
import { CHAIR_SEAT_OFFSET } from "../core/constants";
import { toWorld } from "../core/geometry";
import type { RenderAgent } from "../core/types";

const NAMEPLATE_FONT = "/office3d/fonts/Manrope-SemiBold.ttf";
const MAX_NAMEPLATE_TEXT_LENGTH = 10;

// RobotCharacter renders ~1.0 world units tall (origin at the feet); 1.0 matches
// the person-height the desks/chairs in RetroEnvironment were tuned for.
const ROBOT_SCALE = 1.0;
// RiggedCharacter auto-scales to DEFAULT_AGENT_HEIGHT (0.65) × this multiplier;
// ~1.9 makes the CEO read a touch taller than the robots, like the reference.
const HUMAN_SCALE_MULT = 1.9;

const formatNameplate = (value: string): string => {
  const n = value.replace(/\s+/g, " ").trim();
  if (!n) return "";
  if (n.length <= MAX_NAMEPLATE_TEXT_LENGTH) return n;
  return n.split(" ")[0] ?? n;
};

export type RobotAgentModelProps = {
  agentId: string;
  name: string;
  subtitle?: string | null;
  status: "working" | "idle" | "error";
  color: string;
  /** CEO seat → rigged human; everyone else → colour-coded robot. */
  isHuman?: boolean;
  agentsRef: RefObject<RenderAgent[]>;
  agentLookupRef?: RefObject<Map<string, RenderAgent>>;
  onSelect?: (id: string) => void;
  selected?: boolean;
};

export const RobotAgentModel = memo(function RobotAgentModel({
  agentId,
  name,
  subtitle,
  status,
  color,
  isHuman = false,
  agentsRef,
  agentLookupRef,
  onSelect,
  selected = false,
}: RobotAgentModelProps) {
  const groupRef = useRef<THREE.Group>(null);
  const statusDotMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const pulseRingRef = useRef<THREE.Mesh>(null);
  const pulseRingMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const pos = useRef(new THREE.Vector3(0, 0, 0));

  useFrame(() => {
    const agent =
      agentLookupRef?.current?.get(agentId) ??
      agentsRef.current?.find((a) => a.id === agentId);
    if (!agent || !groupRef.current) return;

    // World position (feet on the floor — the character bobs internally).
    // Seated agents sit at the chair, offset in front of the desk center.
    const [wx, , wz] = toWorld(agent.x, agent.y);
    const seatZ = agent.state === "sitting" ? wz + CHAIR_SEAT_OFFSET : wz;
    pos.current.set(wx, 0, seatZ);
    groupRef.current.position.lerp(pos.current, 0.15);

    // Facing (shortest-arc smoothing).
    let rotDelta = agent.facing - groupRef.current.rotation.y;
    while (rotDelta > Math.PI) rotDelta -= Math.PI * 2;
    while (rotDelta < -Math.PI) rotDelta += Math.PI * 2;
    groupRef.current.rotation.y += rotDelta * 0.12;

    // Status dot + floor pulse ring.
    const working = agent.state === "sitting" || agent.status === "working";
    const isError = agent.status === "error";
    if (statusDotMatRef.current) {
      statusDotMatRef.current.color.set(
        isError ? "#ef4444" : working ? "#22c55e" : "#f59e0b",
      );
    }
    if (pulseRingRef.current && pulseRingMatRef.current) {
      if (working || isError || selected) {
        const pulse = (Math.sin(agent.frame * 0.05) + 1) / 2;
        const scale = isError ? 1.25 + pulse * 0.55 : 1.2 + pulse * 0.8;
        pulseRingRef.current.scale.setScalar(scale);
        pulseRingMatRef.current.color.set(
          isError ? "#ef4444" : selected ? "#8ab4ff" : "#22c55e",
        );
        pulseRingMatRef.current.opacity = isError
          ? 0.7 - pulse * 0.3
          : 0.55 - pulse * 0.45;
        pulseRingRef.current.visible = true;
      } else {
        pulseRingRef.current.visible = false;
      }
    }
  });

  // RobotCharacter/RiggedCharacter type their refs as RenderAgent3D pools. The
  // retro RenderAgent is structurally compatible for the fields they read
  // (id, status, state, phaseOffset, frame), so the cast is safe.
  const a3dAgentsRef = agentsRef as unknown as MutableRefObject<RenderAgent3D[]>;
  const a3dLookupRef = agentLookupRef as unknown as
    | MutableRefObject<Map<string, RenderAgent3D>>
    | undefined;

  const nameplateText = formatNameplate(name);
  const subtitleText = typeof subtitle === "string" ? subtitle.trim() : "";
  const nameplateY = isHuman ? 1.55 : 1.3;

  return (
    <group
      ref={groupRef}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.(agentId);
      }}
    >
      {/* Status / selection pulse ring on the floor */}
      <mesh
        ref={pulseRingRef}
        position={[0, 0.02, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        visible={false}
      >
        <ringGeometry args={[0.22, 0.32, 28]} />
        <meshBasicMaterial
          ref={pulseRingMatRef}
          color="#22c55e"
          transparent
          opacity={0.5}
          depthWrite={false}
        />
      </mesh>

      {/* Official built character body */}
      {isHuman ? (
        <RiggedCharacter
          url={RIGGED_MAN_URL}
          agentId={agentId}
          agentsRef={a3dAgentsRef}
          agentLookupRef={a3dLookupRef}
          scaleMultiplier={HUMAN_SCALE_MULT}
        />
      ) : (
        <group scale={[ROBOT_SCALE, ROBOT_SCALE, ROBOT_SCALE]}>
          <RobotCharacter
            color={color}
            status={status}
            agentId={agentId}
            agentsRef={a3dAgentsRef}
            agentLookupRef={
              a3dLookupRef as MutableRefObject<Map<string, RenderAgent3D>>
            }
          />
        </group>
      )}

      {/* Nameplate */}
      {nameplateText ? (
        <Billboard position={[0, nameplateY, 0]}>
          <mesh position={[0, 0, -0.001]}>
            <planeGeometry args={[0.82, subtitleText ? 0.34 : 0.24]} />
            <meshBasicMaterial color="#080c14" transparent opacity={0.9} />
          </mesh>
          <mesh position={[-0.392, 0, 0]}>
            <planeGeometry args={[0.028, subtitleText ? 0.34 : 0.24]} />
            <meshBasicMaterial color={color} />
          </mesh>
          <mesh position={[0.355, subtitleText ? 0.05 : 0, 0]}>
            <circleGeometry args={[0.052, 14]} />
            <meshBasicMaterial ref={statusDotMatRef} color="#ef4444" />
          </mesh>
          <Text
            font={NAMEPLATE_FONT}
            position={[-0.02, subtitleText ? 0.05 : 0, 0.001]}
            fontSize={nameplateText.length > 7 ? 0.118 : 0.13}
            color="#e8dfc0"
            anchorX="center"
            anchorY="middle"
            maxWidth={0.68}
          >
            {nameplateText}
          </Text>
          {subtitleText ? (
            <Text
              font={NAMEPLATE_FONT}
              position={[-0.02, -0.085, 0.001]}
              fontSize={0.082}
              color="#8ab4ff"
              anchorX="center"
              anchorY="middle"
              maxWidth={0.68}
            >
              {subtitleText}
            </Text>
          ) : null}
        </Billboard>
      ) : null}
    </group>
  );
});

RobotAgentModel.displayName = "RobotAgentModel";
