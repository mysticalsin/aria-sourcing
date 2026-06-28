"use client";

import { RoundedBox } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import type { RenderAgent3D } from "./types";

/* ============================================================================
   Procedural glossy toy robot — built entirely from three.js primitives and
   drei <RoundedBox> (no GLB, no skeleton, no AnimationMixer). Glossy plastic
   clearcoat look: a big rounded-cube helmet tinted the body colour, a dark
   near-black visor with two glowing cyan capsule eyes, a chunky rounded body,
   3-segment articulated arms (ball shoulder → upper-arm → forearm → hand) that
   hang at the sides, short thigh/shin/foot legs, and a little antenna on top.

   Animation states (all driven by the live sim record; no React re-renders):
   • "sitting"  — seated at desk: legs bent, subtle arm/head idle motion.
   • "walking"  — full stride cycle: alternating legs, counter-arm swing,
                  double-peak body bob, forward lean, lateral body sway.
   • "standing" — lounge/rest: gentle full-body bob, slow head look-around.

   Total standing height ≈ 1.0 units. Origin at the feet (y=0).

   GPU note: all interior meshes carry raycast={() => {}} so the three.js
   raycast traversal tests only the single transparent proxy sphere at y≈0.5.
   ========================================================================== */

const EYE_GLOW = "#3DE1FF";
const FACE_DARK = "#0B0F14";
const CHEST_STRIPE = "#A0289C";

export function RobotCharacter({
  color,
  status,
  agentId,
  agentsRef,
  agentLookupRef,
}: {
  color: string;
  status?: RenderAgent3D["status"];
  agentId: string;
  agentsRef: React.MutableRefObject<RenderAgent3D[]>;
  agentLookupRef: React.MutableRefObject<Map<string, RenderAgent3D>>;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const bodyGroupRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const leftLegRef = useRef<THREE.Group>(null);
  const rightLegRef = useRef<THREE.Group>(null);

  // A slightly darker shade of the body colour for feet + antenna nub.
  const footColor = new THREE.Color(color).multiplyScalar(0.65).getStyle();

  useFrame((state, delta) => {
    const group = groupRef.current;
    if (!group) return;
    const agent =
      agentLookupRef.current?.get(agentId) ??
      agentsRef.current?.find((a) => a.id === agentId);
    if (!agent) return;

    const t = state.clock.elapsedTime;
    const ph = agent.phaseOffset;
    const st = agent.status;
    const working = st === "working";
    const erroring = st === "error";

    if (agent.state === "sitting") {
      // ── SEATED at desk ──────────────────────────────────────────────────
      // Settle: lowered slightly so the robot looks nestled into the chair.
      group.position.y = erroring ? -0.09 : -0.05;
      group.rotation.x = 0;

      // Breathing: gentle body squash/stretch, livelier when working.
      if (bodyGroupRef.current) {
        const breathAmp = working ? 0.03 : 0.018;
        const breathFreq = working ? 2.4 : 1.8;
        bodyGroupRef.current.scale.y =
          1 + Math.sin(t * breathFreq + ph) * breathAmp;
        bodyGroupRef.current.rotation.x = erroring ? 0.1 : 0;
        bodyGroupRef.current.rotation.z = 0;
      }
      if (leftLegRef.current) leftLegRef.current.rotation.x = -0.55;
      if (rightLegRef.current) rightLegRef.current.rotation.x = -0.55;

      // Head: slow occasional turn + tiny nod/tilt. Faster when working,
      // drooped forward when erroring/paused.
      if (headRef.current) {
        const turnAmp = working ? 0.22 : erroring ? 0.05 : 0.11;
        const turnFreq = working ? 0.6 : 0.38;
        headRef.current.rotation.y =
          Math.sin(t * turnFreq + ph * 0.6) * turnAmp;
        headRef.current.rotation.x =
          (erroring ? 0.26 : 0.06) + Math.sin(t * 0.5 + ph) * 0.04;
        headRef.current.rotation.z = Math.sin(t * 0.7 + ph) * 0.04;
      }

      // Arms: subtle alternating idle sway, more motion when working.
      const armAmp = working ? 0.09 : erroring ? 0.02 : 0.05;
      const armFreq = working ? 1.6 : 1.1;
      if (leftArmRef.current)
        leftArmRef.current.rotation.x =
          0.15 + Math.sin(t * armFreq + ph) * armAmp;
      if (rightArmRef.current)
        rightArmRef.current.rotation.x =
          0.15 + Math.sin(t * armFreq + ph + Math.PI) * armAmp;

    } else if (agent.state === "walking") {
      // ── WALKING ─────────────────────────────────────────────────────────
      // Walk cycle at ~7 steps/sec. swing oscillates ±1; swingAbs gives a
      // double-peak per stride (peaks at toe-off and heel-strike).
      const walkFreq = 7;
      const swing = Math.sin(t * walkFreq + ph);
      const swingAbs = Math.abs(swing);

      // Vertical body bob: double-peak bounce, no net Y offset while walking.
      group.position.y = swingAbs * 0.022;
      // Forward lean — the whole body tilts toward movement direction.
      group.rotation.x = 0.12;

      // Body: no breathing; add lateral sway for natural gait.
      if (bodyGroupRef.current) {
        bodyGroupRef.current.scale.y = 1;
        bodyGroupRef.current.rotation.x = 0;
        bodyGroupRef.current.rotation.z = swing * 0.04;
      }

      // Alternating leg swing (left and right in opposition).
      if (leftLegRef.current) leftLegRef.current.rotation.x = swing * 0.42;
      if (rightLegRef.current) rightLegRef.current.rotation.x = -swing * 0.42;

      // Arms swing counter to legs (natural human gait).
      if (leftArmRef.current) leftArmRef.current.rotation.x = 0.10 - swing * 0.45;
      if (rightArmRef.current) rightArmRef.current.rotation.x = 0.10 + swing * 0.45;

      // Head stays level — slightly tilted upward for alertness.
      if (headRef.current) {
        headRef.current.rotation.x = -0.05;
        headRef.current.rotation.y = 0;
        headRef.current.rotation.z = 0;
      }

    } else {
      // ── STANDING / IDLE — gentle bob + slow head scan + tiny arm sway ───
      group.position.y = Math.sin(t * 1.6 + ph) * 0.012;
      group.rotation.x = 0;

      if (bodyGroupRef.current) {
        bodyGroupRef.current.scale.y =
          1 + Math.sin(t * 1.8 + ph) * 0.018;
        bodyGroupRef.current.rotation.x = erroring ? 0.1 : 0;
        bodyGroupRef.current.rotation.z = 0;
      }
      if (leftLegRef.current) leftLegRef.current.rotation.x = 0;
      if (rightLegRef.current) rightLegRef.current.rotation.x = 0;
      if (headRef.current) {
        headRef.current.rotation.y =
          Math.sin(t * 0.4 + ph * 0.6) * 0.1;
        headRef.current.rotation.x = erroring ? 0.2 : 0;
        headRef.current.rotation.z = Math.sin(t * 0.9 + ph) * 0.05;
      }
      if (leftArmRef.current)
        leftArmRef.current.rotation.x =
          0.15 + Math.sin(t * 1.1 + ph) * 0.04;
      if (rightArmRef.current)
        rightArmRef.current.rotation.x =
          0.15 + Math.sin(t * 1.1 + ph + Math.PI) * 0.04;
    }

    // Keep a live frame counter (future speech bubbles / blinks read it).
    agent.frame += delta * 60;
  });

  // `status` prop is accepted for parity with the call site / future static
  // styling; live status is read per-frame off the agent record above.
  void status;

  return (
    <group ref={groupRef}>
      {/* ── Invisible click proxy — sole raycast target ───────────────────
          All interior meshes carry raycast={() => {}} so the hit-test
          visits only this single sphere (~0.4r covers the full silhouette).
          The onClick on CharacterWrapper's outer group still fires normally. */}
      <mesh position={[0, 0.5, 0]}>
        <sphereGeometry args={[0.4, 8, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* ── Legs (thigh + shin + foot), pivot at the hip ───────────────── */}
      {([-1, 1] as const).map((side) => (
        <group
          key={side}
          ref={side === -1 ? leftLegRef : rightLegRef}
          position={[side * 0.06, 0.24, 0]}
        >
          <mesh castShadow receiveShadow position={[0, -0.05, 0]} raycast={() => {}}>
            <cylinderGeometry args={[0.035, 0.032, 0.12, 16]} />
            <BodyMaterial color={color} />
          </mesh>
          <mesh castShadow receiveShadow position={[0, -0.16, 0]} raycast={() => {}}>
            <cylinderGeometry args={[0.03, 0.028, 0.1, 16]} />
            <BodyMaterial color={color} />
          </mesh>
          <RoundedBox
            args={[0.09, 0.05, 0.12]}
            radius={0.02}
            smoothness={4}
            position={[0, -0.23, 0.025]}
            castShadow
            receiveShadow
            raycast={() => {}}
          >
            <HandMaterial color={footColor} />
          </RoundedBox>
        </group>
      ))}

      {/* ── Body (cleaner proportions: 0.28×0.36×0.22), breathing pivot ── */}
      <group ref={bodyGroupRef} position={[0, 0.44, 0]}>
        <RoundedBox
          args={[0.28, 0.36, 0.22]}
          radius={0.08}
          smoothness={5}
          castShadow
          receiveShadow
          raycast={() => {}}
        >
          <BodyMaterial color={color} />
        </RoundedBox>

        {/* Mantu brand accent chest stripe — emissiveIntensity=1.5 so bloom picks it up */}
        <mesh position={[0, 0.04, 0.115]} raycast={() => {}}>
          <boxGeometry args={[0.14, 0.05, 0.008]} />
          <meshStandardMaterial
            color={CHEST_STRIPE}
            emissive={CHEST_STRIPE}
            emissiveIntensity={1.5}
            roughness={0.2}
            metalness={0}
          />
        </mesh>
      </group>

      {/* ── Arms (ball shoulder → upper-arm → forearm → hand) ──────────── */}
      {([-1, 1] as const).map((side) => (
        <group
          key={side}
          ref={side === -1 ? leftArmRef : rightArmRef}
          position={[side * 0.155, 0.55, 0]}
          rotation={[0.15, 0, 0]}
        >
          {/* ball shoulder — matte joint material */}
          <mesh castShadow receiveShadow raycast={() => {}}>
            <sphereGeometry args={[0.04, 16, 16]} />
            <JointMaterial color={color} />
          </mesh>
          {/* upper arm */}
          <mesh castShadow receiveShadow position={[0, -0.1, 0]} raycast={() => {}}>
            <capsuleGeometry args={[0.027, 0.12, 4, 12]} />
            <BodyMaterial color={color} />
          </mesh>
          {/* forearm */}
          <mesh castShadow receiveShadow position={[0, -0.255, 0.015]} raycast={() => {}}>
            <capsuleGeometry args={[0.023, 0.1, 4, 12]} />
            <BodyMaterial color={color} />
          </mesh>
          {/* hand — soft-matte */}
          <RoundedBox
            args={[0.068, 0.08, 0.058]}
            radius={0.02}
            smoothness={4}
            position={[0, -0.39, 0.03]}
            castShadow
            receiveShadow
            raycast={() => {}}
          >
            <HandMaterial color={footColor} />
          </RoundedBox>
        </group>
      ))}

      {/* ── Head (0.24×0.26×0.24 — less chibi, cleaner proportions) ─────── */}
      <group ref={headRef} position={[0, 0.86, 0]}>
        {/* helmet */}
        <RoundedBox
          args={[0.24, 0.26, 0.24]}
          radius={0.07}
          smoothness={6}
          castShadow
          receiveShadow
          raycast={() => {}}
        >
          <BodyMaterial color={color} />
        </RoundedBox>

        {/* dark visor panel — scaled to new head footprint */}
        <RoundedBox
          args={[0.18, 0.17, 0.03]}
          radius={0.04}
          smoothness={4}
          position={[0, 0.01, 0.125]}
          castShadow
          receiveShadow
          raycast={() => {}}
        >
          <meshStandardMaterial color={FACE_DARK} roughness={0.25} metalness={0.5} />
        </RoundedBox>

        {/* two vertical glowing capsule eyes */}
        {([-1, 1] as const).map((side) => (
          <mesh
            key={side}
            position={[side * 0.05, 0.022, 0.135]}
            castShadow
            receiveShadow
            raycast={() => {}}
          >
            <capsuleGeometry args={[0.018, 0.05, 4, 12]} />
            {/* emissiveIntensity=3.2 puts eyes above bloom luminanceThreshold=0.72 */}
            <meshStandardMaterial
              color={EYE_GLOW}
              emissive={EYE_GLOW}
              emissiveIntensity={3.2}
              roughness={0.1}
              metalness={0}
            />
          </mesh>
        ))}

        {/* antenna: thin stem (matte joint material) + nub */}
        <mesh castShadow receiveShadow position={[0, 0.175, 0]} raycast={() => {}}>
          <cylinderGeometry args={[0.013, 0.013, 0.08, 12]} />
          <JointMaterial color={footColor} />
        </mesh>
        <mesh castShadow receiveShadow position={[0, 0.235, 0]} raycast={() => {}}>
          <sphereGeometry args={[0.03, 12, 12]} />
          <JointMaterial color={footColor} />
        </mesh>
      </group>
    </group>
  );
}

// ── Material variants — per-region surface quality ────────────────────────

/**
 * Polished body panels (torso, head, arm segments).
 * Low roughness + clearcoat gives the glossy plastic toy-robot look.
 */
function BodyMaterial({ color }: { color: string }) {
  return (
    <meshPhysicalMaterial
      color={color}
      metalness={0.12}
      roughness={0.15}
      clearcoat={1}
      clearcoatRoughness={0.12}
    />
  );
}

/**
 * Matte joints (ball shoulders, antenna).
 * Higher roughness breaks up the specular so joints read as mechanical pivots.
 */
function JointMaterial({ color }: { color: string }) {
  return (
    <meshStandardMaterial
      color={color}
      metalness={0.08}
      roughness={0.7}
    />
  );
}

/**
 * Soft-matte hands + feet.
 * Mid roughness gives a rubberised grip look distinct from the body panels.
 */
function HandMaterial({ color }: { color: string }) {
  return (
    <meshStandardMaterial
      color={color}
      metalness={0.06}
      roughness={0.5}
    />
  );
}
