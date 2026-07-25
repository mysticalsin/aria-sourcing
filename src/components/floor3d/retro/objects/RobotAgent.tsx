"use client";
// Robot character for the operations floor.
//
// Renders one of the official Aria characters (the glossy toy robots + the
// human lead from public/office3d/characters/) as a camera-facing billboard,
// driven by the retro walking sim. The sim mutates a shared RenderAgent record
// in place each frame; this component reads its own entry and lerps the group
// to the world position — no React re-renders in the hot path.
//
// Replaces the blocky procedural AgentModel so the floor matches the reference
// character lineup (blue / orange / green / purple / yellow bots + human).

import { Billboard, Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { memo, useRef, type RefObject } from "react";
import * as THREE from "three";
import {
  SpriteCharacter,
  botKeyForColor,
  type CharKey,
} from "@/components/floor3d/SpriteCharacter";
import type { AgentPosition } from "@/components/floor3d/types";
import { toWorld } from "../core/geometry";
import type { RenderAgent } from "../core/types";

const NAMEPLATE_FONT = "/office3d/fonts/Manrope-SemiBold.ttf";

const MAX_NAMEPLATE_TEXT_LENGTH = 10;
const formatNameplate = (value: string): string => {
  const n = value.replace(/\s+/g, " ").trim();
  if (!n) return "";
  if (n.length <= MAX_NAMEPLATE_TEXT_LENGTH) return n;
  return n.split(" ")[0] ?? n;
};

// Robot stands a touch shorter than the human lead, mirroring the reference.
const BOT_HEIGHT = 1.55;
const HUMAN_HEIGHT = 1.78;
// World-space offset that moves a seated character back onto its desk chair
// (the sim pins it to the desk centre; the chair sits +z behind the desk).
const SEAT_BACK_OFFSET = 0.82;

export type RobotAgentProps = {
  agentId: string;
  name: string;
  subtitle?: string | null;
  status: "working" | "idle" | "error";
  color: string;
  position?: AgentPosition;
  selected?: boolean;
  agentsRef: RefObject<RenderAgent[]>;
  agentLookupRef?: RefObject<Map<string, RenderAgent>>;
  onClick?: (id: string) => void;
};

export const RobotAgent = memo(function RobotAgent({
  agentId,
  name,
  subtitle,
  status,
  color,
  position,
  selected = false,
  agentsRef,
  agentLookupRef,
  onClick,
}: RobotAgentProps) {
  const groupRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const statusDotMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const pulseRingRef = useRef<THREE.Mesh>(null);
  const pulseRingMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const target = useRef(new THREE.Vector3());

  const charKey: CharKey =
    position === "ceo" ? "human" : botKeyForColor(color);
  const spriteHeight = charKey === "human" ? HUMAN_HEIGHT : BOT_HEIGHT;

  useFrame(() => {
    const agent =
      agentLookupRef?.current?.get(agentId) ??
      agentsRef.current?.find((a) => a.id === agentId);
    const group = groupRef.current;
    const body = bodyRef.current;
    if (!agent || !group || !body) return;

    const [wx, , wz] = toWorld(agent.x, agent.y);
    const seated = agent.state === "sitting";
    // When seated, shift back onto the chair so the character isn't standing
    // through the desk + monitor.
    target.current.set(wx, 0, wz + (seated ? SEAT_BACK_OFFSET : 0));
    group.position.lerp(target.current, 0.15);

    // Subtle walk bob / idle breathe so the sprite doesn't slide flat.
    const bounce =
      agent.state === "walking" ? Math.abs(Math.sin(agent.frame * 0.15)) * 0.06 : 0;
    body.position.y = bounce;
    body.scale.setScalar(seated ? 0.9 : 1);

    const isError = agent.status === "error";
    const working = agent.state === "sitting" || agent.status === "working";

    if (statusDotMatRef.current) {
      statusDotMatRef.current.color.set(
        isError ? "#ef4444" : working ? "#22c55e" : "#f59e0b",
      );
    }
    if (pulseRingRef.current && pulseRingMatRef.current) {
      if (working || isError) {
        const pulse = (Math.sin(agent.frame * 0.05) + 1) / 2;
        pulseRingRef.current.scale.setScalar(
          isError ? 1.25 + pulse * 0.55 : 1.2 + pulse * 0.8,
        );
        pulseRingMatRef.current.color.set(isError ? "#ef4444" : "#22c55e");
        pulseRingMatRef.current.opacity = isError
          ? 0.7 - pulse * 0.3
          : 0.5 - pulse * 0.4;
        pulseRingRef.current.visible = true;
      } else {
        pulseRingRef.current.visible = false;
      }
    }
  });

  const nameplateText = formatNameplate(name);
  const subtitleText = typeof subtitle === "string" ? subtitle.trim() : "";
  const nameplateFontSize =
    nameplateText.length > 9 ? 0.118 : nameplateText.length > 7 ? 0.13 : 0.144;

  return (
    <group
      ref={groupRef}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(agentId);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "";
      }}
    >
      {/* Soft contact shadow so the character is grounded, not floating. */}
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.34, 24]} />
        <meshBasicMaterial color="#000" transparent opacity={0.18} />
      </mesh>

      {/* Status pulse ring on the floor. */}
      <mesh
        ref={pulseRingRef}
        position={[0, 0.02, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        visible={false}
      >
        <ringGeometry args={[0.34, 0.46, 28]} />
        <meshBasicMaterial
          ref={pulseRingMatRef}
          color="#22c55e"
          transparent
          opacity={0.5}
          depthWrite={false}
        />
      </mesh>

      {/* The official Aria character sprite (robot or human lead). */}
      <group ref={bodyRef}>
        <SpriteCharacter charKey={charKey} height={spriteHeight} />
      </group>

      {/* Nameplate — dark plate, brand-colour stripe, status dot, name + role. */}
      {nameplateText ? (
        <Billboard position={[0, spriteHeight + 0.34, 0]}>
          <mesh position={[0, 0, -0.001]}>
            <planeGeometry args={[0.82, subtitleText ? 0.34 : 0.24]} />
            <meshBasicMaterial
              color={selected ? "#0b1a24" : "#080c14"}
              transparent
              opacity={0.9}
            />
          </mesh>
          <mesh position={[-0.392, 0, 0]}>
            <planeGeometry args={[0.028, subtitleText ? 0.34 : 0.24]} />
            <meshBasicMaterial color={selected ? "#3DE1FF" : color} />
          </mesh>
          <mesh position={[0.355, subtitleText ? 0.05 : 0, 0]}>
            <circleGeometry args={[0.052, 14]} />
            <meshBasicMaterial ref={statusDotMatRef} color="#22c55e" />
          </mesh>
          <Text
            font={NAMEPLATE_FONT}
            position={[-0.02, subtitleText ? 0.05 : 0, 0.001]}
            fontSize={nameplateFontSize}
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

RobotAgent.displayName = "RobotAgent";
