"use client";
// Ported from iamlukethedev/Claw3D (MIT License)
// Walk-cycle, blink system, facial expressions, speech bubbles, nameplate.
// Stripped to React 18 + three 0.169 + drei 9 compatibility.
// Removed: janitor tools, ping-pong paddle, workout/dance/away states.

import { Billboard, Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { memo, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { createDefaultAgentAvatarProfile } from "../core/avatarProfile";
import { AGENT_SCALE, WALK_ANIM_SPEED } from "../core/constants";
import { toWorld } from "../core/geometry";
import type { RenderAgent } from "../core/types";

const MAX_NAMEPLATE_TEXT_LENGTH = 10;
const MAX_SPEECH_BUBBLE_TEXT_LENGTH = 180;
const MAX_SPEECH_BUBBLE_LINES = 4;

// Bundled font for every <Text>. Without an explicit font, troika reaches out to
// a jsdelivr CDN for unicode fallback data, which the app CSP (connect-src 'self')
// blocks. Pointing at a local Manrope keeps all glyph loading same-origin.
const NAMEPLATE_FONT = "/office3d/fonts/Manrope-SemiBold.ttf";

const formatNameplate = (value: string): string => {
  const n = value.replace(/\s+/g, " ").trim();
  if (!n) return "";
  if (n.length <= MAX_NAMEPLATE_TEXT_LENGTH) return n;
  return n.split(" ")[0] ?? n;
};

const flattenMarkdown = (v: string) =>
  v
    .replace(/```[\s\S]*?```/g, " [code] ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^>\s*/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const clampBubble = (v: string) => {
  if (v.length <= MAX_SPEECH_BUBBLE_TEXT_LENGTH) return { text: v, truncated: false };
  return { text: `${v.slice(0, MAX_SPEECH_BUBBLE_TEXT_LENGTH - 1).trimEnd()}…`, truncated: true };
};

export type AgentModelProps = {
  agentId: string;
  name: string;
  subtitle?: string | null;
  status: "working" | "idle" | "error";
  color: string;
  agentsRef: RefObject<RenderAgent[]>;
  agentLookupRef?: RefObject<Map<string, RenderAgent>>;
  onHover?: (id: string) => void;
  onUnhover?: () => void;
  onClick?: (id: string) => void;
  showSpeech?: boolean;
  speechText?: string | null;
  suppressSpeechBubble?: boolean;
};

export const AgentModel = memo(function AgentModel({
  agentId,
  name,
  subtitle,
  status,
  color,
  agentsRef,
  agentLookupRef,
  onHover,
  onUnhover,
  onClick,
  showSpeech = false,
  speechText = null,
  suppressSpeechBubble = false,
}: AgentModelProps) {
  const groupRef = useRef<THREE.Group>(null);
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const leftLegRef = useRef<THREE.Group>(null);
  const rightLegRef = useRef<THREE.Group>(null);
  const statusDotMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const pulseRingRef = useRef<THREE.Mesh>(null);
  const pulseRingMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const leftEyeRef = useRef<THREE.Mesh>(null);
  const rightEyeRef = useRef<THREE.Mesh>(null);
  const leftEyeHighlightRef = useRef<THREE.Mesh>(null);
  const rightEyeHighlightRef = useRef<THREE.Mesh>(null);
  const mouthRef = useRef<THREE.Mesh>(null);
  const leftMouthCornerRef = useRef<THREE.Mesh>(null);
  const rightMouthCornerRef = useRef<THREE.Mesh>(null);
  const leftBrowRef = useRef<THREE.Mesh>(null);
  const rightBrowRef = useRef<THREE.Mesh>(null);
  const speechBubbleRef = useRef<THREE.Group>(null);
  const speechBubbleMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const pos = useRef(new THREE.Vector3(0, 0, 0));

  const resolvedAppearance = useMemo(
    () => createDefaultAgentAvatarProfile(agentId),
    [agentId],
  );

  useFrame(() => {
    const agent =
      agentLookupRef?.current?.get(agentId) ??
      agentsRef.current?.find((a) => a.id === agentId);
    if (!agent || !groupRef.current) return;

    const [wx, , wz] = toWorld(agent.x, agent.y);
    pos.current.set(wx, 0, wz);
    groupRef.current.position.lerp(pos.current, 0.15);

    // Facing rotation (y-axis)
    const targetY = agent.facing;
    let rotDelta = targetY - groupRef.current.rotation.y;
    while (rotDelta > Math.PI) rotDelta -= Math.PI * 2;
    while (rotDelta < -Math.PI) rotDelta += Math.PI * 2;
    groupRef.current.rotation.y += rotDelta * 0.12;

    const frameValue = agent.frame + (agent.phaseOffset ?? 0) / WALK_ANIM_SPEED;
    const walkPhase = Math.sin(frameValue * WALK_ANIM_SPEED);

    // Body lean and bounce
    groupRef.current.rotation.z = 0;
    groupRef.current.rotation.x = agent.state === "sitting" ? -0.15 : 0;
    const bounce = agent.state === "walking"
      ? Math.sin(frameValue * WALK_ANIM_SPEED) * 0.04
      : 0;
    const breathe = agent.state === "standing"
      ? Math.sin(frameValue * 0.03) * 0.01
      : 0;
    groupRef.current.position.y = bounce + breathe;

    // Arms
    if (leftArmRef.current) {
      leftArmRef.current.rotation.x = 0;
      leftArmRef.current.rotation.y = 0;
      leftArmRef.current.rotation.z = 0;
      if (agent.state === "walking") {
        leftArmRef.current.rotation.x = walkPhase * 0.4;
      } else if (agent.state === "sitting") {
        leftArmRef.current.rotation.x = 0.3;
      }
    }
    if (rightArmRef.current) {
      rightArmRef.current.rotation.x = 0;
      rightArmRef.current.rotation.y = 0;
      rightArmRef.current.rotation.z = 0;
      if (agent.state === "walking") {
        rightArmRef.current.rotation.x = -walkPhase * 0.4;
      } else if (agent.state === "sitting") {
        rightArmRef.current.rotation.x = 0.3;
      }
    }

    // Legs
    if (leftLegRef.current) {
      leftLegRef.current.rotation.x =
        agent.state === "walking" ? walkPhase * 0.35 : 0;
    }
    if (rightLegRef.current) {
      rightLegRef.current.rotation.x =
        agent.state === "walking" ? -walkPhase * 0.35 : 0;
    }

    // Status
    const working = agent.state === "sitting" || agent.status === "working";
    const isError = agent.status === "error";

    if (statusDotMatRef.current) {
      statusDotMatRef.current.color.set(
        isError ? "#ef4444" : working ? "#22c55e" : "#f59e0b",
      );
    }
    if (pulseRingRef.current && pulseRingMatRef.current) {
      if (working || isError) {
        const pulse = (Math.sin(agent.frame * 0.05) + 1) / 2;
        const scale = isError ? 1.25 + pulse * 0.55 : 1.2 + pulse * 0.8;
        pulseRingRef.current.scale.setScalar(scale);
        pulseRingMatRef.current.color.set(isError ? "#ef4444" : "#22c55e");
        pulseRingMatRef.current.opacity = isError
          ? 0.7 - pulse * 0.3
          : 0.55 - pulse * 0.45;
        pulseRingRef.current.visible = true;
      } else {
        pulseRingRef.current.visible = false;
      }
    }

    // Blink
    const blinkSeed = agentId
      .split("")
      .reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
    const blinkCycle = isError ? 120 : working ? 170 : 240;
    const blinkWindow = isError ? 18 : 12;
    const blinkPhase = (agent.frame + blinkSeed * 17) % blinkCycle;
    let eyeOpen = isError ? 0.92 : working ? 0.84 : 1.12;
    if (blinkPhase < blinkWindow) {
      const mid = blinkWindow / 2;
      eyeOpen *= Math.min(1, Math.abs(blinkPhase - mid) / mid);
    }
    if (working) eyeOpen = Math.max(0.48, eyeOpen);
    if (isError) eyeOpen = Math.max(0.28, eyeOpen);

    const eyeScaleX = isError ? 1.2 : working ? 1.06 : 1.12;
    const eyeScaleY = Math.max(0.05, eyeOpen);
    const eyeOffsetY =
      (working ? -0.006 : 0) +
      (isError ? -0.004 : 0) +
      (agent.state === "walking" ? 0.004 : 0);

    for (const eyeRef of [leftEyeRef, rightEyeRef]) {
      if (!eyeRef.current) continue;
      eyeRef.current.scale.x = eyeScaleX;
      eyeRef.current.scale.y = eyeScaleY;
      eyeRef.current.position.y = 0.475 + eyeOffsetY;
    }
    for (const hilightRef of [leftEyeHighlightRef, rightEyeHighlightRef]) {
      if (!hilightRef.current) continue;
      hilightRef.current.visible = eyeOpen > 0.45;
      hilightRef.current.position.y = 0.482 + eyeOffsetY;
    }

    // Mouth
    if (mouthRef.current) {
      mouthRef.current.rotation.z = 0;
      mouthRef.current.position.set(0, 0.436, 0.074);
      if (isError) {
        mouthRef.current.scale.set(1.28, 0.16, 1);
        mouthRef.current.position.y = 0.43;
      } else if (working) {
        mouthRef.current.scale.set(0.92, 0.14, 1);
        mouthRef.current.position.y = 0.437;
      } else if (agent.state === "walking") {
        const talkPulse = 0.38 + (Math.sin(agent.frame * 0.14 + blinkSeed) + 1) * 0.22;
        mouthRef.current.scale.set(0.95, talkPulse, 1);
      } else {
        mouthRef.current.scale.set(1.35, 0.34, 1);
        mouthRef.current.position.y = 0.428;
      }
    }

    const showSmileCorners = !isError && !working && agent.state !== "walking";
    const showFrownCorners = isError;
    if (leftMouthCornerRef.current && rightMouthCornerRef.current) {
      leftMouthCornerRef.current.visible = showSmileCorners || showFrownCorners;
      rightMouthCornerRef.current.visible = showSmileCorners || showFrownCorners;
      leftMouthCornerRef.current.position.set(-0.031, 0.434, 0.074);
      rightMouthCornerRef.current.position.set(0.031, 0.434, 0.074);
      if (showFrownCorners) {
        leftMouthCornerRef.current.rotation.z = -0.6;
        rightMouthCornerRef.current.rotation.z = 0.6;
        leftMouthCornerRef.current.position.y = 0.425;
        rightMouthCornerRef.current.position.y = 0.425;
      } else if (showSmileCorners) {
        leftMouthCornerRef.current.rotation.z = 0.62;
        rightMouthCornerRef.current.rotation.z = -0.62;
        leftMouthCornerRef.current.position.y = 0.438;
        rightMouthCornerRef.current.position.y = 0.438;
      }
    }

    // Brows
    if (leftBrowRef.current && rightBrowRef.current) {
      leftBrowRef.current.position.y = 0.52;
      rightBrowRef.current.position.y = 0.52;
      if (isError) {
        leftBrowRef.current.rotation.z = 0.42;
        rightBrowRef.current.rotation.z = -0.42;
        leftBrowRef.current.position.y = 0.516;
        rightBrowRef.current.position.y = 0.516;
      } else if (working) {
        leftBrowRef.current.rotation.z = 0.3;
        rightBrowRef.current.rotation.z = -0.3;
      } else {
        leftBrowRef.current.rotation.z = -0.18;
        rightBrowRef.current.rotation.z = 0.18;
        leftBrowRef.current.position.y = 0.526;
        rightBrowRef.current.position.y = 0.526;
      }
    }

    // Speech bubble
    const ambientBubbleVisible =
      !suppressSpeechBubble &&
      !isError &&
      !working &&
      agent.state === "standing" &&
      (agent.frame + blinkSeed * 11) % 320 < 42;
    const bumpTalking = (agent.bumpTalkUntil ?? 0) > Date.now();

    if (speechBubbleRef.current) {
      const visible =
        !suppressSpeechBubble &&
        (showSpeech || bumpTalking || ambientBubbleVisible);
      speechBubbleRef.current.visible = visible;
      if (visible) {
        if (showSpeech && speechText?.trim()) {
          speechBubbleRef.current.scale.setScalar(1);
        } else {
          const pulseBase = isError ? 1.06 : showSpeech || bumpTalking ? 1.03 : 0.98;
          const pulse = pulseBase + Math.sin(agent.frame * (isError ? 0.18 : 0.12)) * 0.06;
          speechBubbleRef.current.scale.setScalar(pulse);
        }
      }
    }
    if (speechBubbleMatRef.current) {
      speechBubbleMatRef.current.color.set(
        isError ? "#3a1016" : working ? "#1d2a17" : "#1a2030",
      );
      speechBubbleMatRef.current.opacity = isError ? 0.97 : 0.92;
    }
  });

  // -------------------------------------------------------------------------
  // Appearance
  // -------------------------------------------------------------------------
  const skin = resolvedAppearance.body.skinTone;
  const topColor = resolvedAppearance.clothing.topColor;
  const trouserColor = resolvedAppearance.clothing.bottomColor;
  const shoeColor = resolvedAppearance.clothing.shoesColor;
  const hairColor = resolvedAppearance.hair.color;
  const hairStyle = resolvedAppearance.hair.style;
  const topStyle = resolvedAppearance.clothing.topStyle;
  const bottomStyle = resolvedAppearance.clothing.bottomStyle;
  const hatStyle = resolvedAppearance.accessories.hatStyle;
  const showGlasses = resolvedAppearance.accessories.glasses;
  const showHeadset = resolvedAppearance.accessories.headset;
  const showBackpack = resolvedAppearance.accessories.backpack;
  const accessoryColor = topColor;
  const sleeveColor = topStyle === "jacket" ? "#dbe4ff" : topColor;
  const cuffColor = topStyle === "hoodie" ? "#d1d5db" : sleeveColor;
  const topAccentColor = topStyle === "jacket" ? "#1f2937" : cuffColor;

  const faceTexture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (!ctx) return new THREE.CanvasTexture(canvas);
    ctx.fillStyle = skin;
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.fillRect(0, 0, 64, 10);
    ctx.fillStyle = "rgba(196,122,84,0.18)";
    ctx.beginPath();
    ctx.arc(18, 38, 7, 0, Math.PI * 2);
    ctx.arc(46, 38, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#d8a06e";
    ctx.fillRect(30, 28, 4, 10);
    ctx.fillRect(29, 37, 6, 2);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }, [skin]);

  // -------------------------------------------------------------------------
  // Speech bubble computed values
  // -------------------------------------------------------------------------
  const resolvedSpeechText =
    showSpeech && speechText?.trim()
      ? speechText.trim()
      : status === "error"
        ? "error"
        : "...";
  const activeSpeechBubble = showSpeech && Boolean(speechText?.trim());
  const normalizedBubbleText = activeSpeechBubble
    ? flattenMarkdown(resolvedSpeechText)
    : resolvedSpeechText;
  const { text: speechBubbleDisplayText, truncated: speechBubbleWasTruncated } =
    activeSpeechBubble
      ? clampBubble(normalizedBubbleText)
      : { text: normalizedBubbleText, truncated: false };
  const bubbleLen = speechBubbleDisplayText.length;
  const speechBubbleWidth = activeSpeechBubble
    ? Math.min(4.6, Math.max(1.8, 1.55 + bubbleLen * 0.018))
    : 0.36;
  const speechBubblePaddingX = activeSpeechBubble ? 0.34 : 0.06;
  const speechBubblePaddingY = activeSpeechBubble ? 0.3 : 0.06;
  const speechBubbleMaxWidth = Math.max(0.24, speechBubbleWidth - speechBubblePaddingX);
  const charsPerLine = activeSpeechBubble ? Math.max(10, Math.floor(speechBubbleMaxWidth * 7)) : 8;
  const estimatedLines = activeSpeechBubble
    ? Math.max(1, Math.min(MAX_SPEECH_BUBBLE_LINES, Math.ceil(bubbleLen / charsPerLine)))
    : 1;
  const speechBubbleHeight = activeSpeechBubble
    ? Math.max(0.72, estimatedLines * 0.26 + speechBubblePaddingY)
    : 0.2;
  const speechBubbleFontSize = activeSpeechBubble
    ? bubbleLen > 110 ? 0.188 : bubbleLen > 70 ? 0.2 : 0.216
    : 0.13;
  const speechBubbleTextColor = activeSpeechBubble
    ? "#f8fafc"
    : status === "error"
      ? "#ff9aa5"
      : status === "working"
        ? "#b9f99d"
        : "#a0c8ff";
  const speechBubbleBorderColor = activeSpeechBubble
    ? status === "error" ? "#ff7f93" : status === "working" ? "#93f57d" : "#8dc4ff"
    : "transparent";
  const speechBubbleBorderInset = activeSpeechBubble ? 0.03 : 0;
  const nameplateText = formatNameplate(name);
  const subtitleText = typeof subtitle === "string" ? subtitle.trim() : "";
  const nameplateFontSize =
    nameplateText.length > 9 ? 0.118 : nameplateText.length > 7 ? 0.13 : 0.144;

  return (
    <group
      ref={groupRef}
      scale={[AGENT_SCALE, AGENT_SCALE, AGENT_SCALE]}
      onPointerOver={(e) => { e.stopPropagation(); onHover?.(agentId); }}
      onPointerOut={() => onUnhover?.()}
      onClick={(e) => { e.stopPropagation(); onClick?.(agentId); }}
    >
      {/* Shadow blob */}
      <mesh position={[0, 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.12, 12]} />
        <meshBasicMaterial color="#000" transparent opacity={0.2} />
      </mesh>

      {/* Right leg */}
      <group ref={rightLegRef} position={[-0.045, 0.1, 0]}>
        {bottomStyle === "shorts" ? (
          <>
            <mesh position={[0, 0.03, 0]}>
              <boxGeometry args={[0.07, 0.08, 0.08]} />
              <meshLambertMaterial color={trouserColor} />
            </mesh>
            <mesh position={[0, -0.045, 0]}>
              <boxGeometry args={[0.05, 0.06, 0.05]} />
              <meshLambertMaterial color={skin} />
            </mesh>
          </>
        ) : (
          <>
            <mesh>
              <boxGeometry args={[0.07, 0.14, 0.08]} />
              <meshLambertMaterial color={trouserColor} />
            </mesh>
            {bottomStyle === "cuffed" ? (
              <mesh position={[0, -0.05, 0]}>
                <boxGeometry args={[0.074, 0.022, 0.084]} />
                <meshLambertMaterial color="#d1d5db" />
              </mesh>
            ) : null}
          </>
        )}
        <mesh position={[0, -0.09, 0]}>
          <boxGeometry args={[0.07, 0.05, 0.12]} />
          <meshLambertMaterial color={shoeColor} />
        </mesh>
      </group>

      {/* Left leg */}
      <group ref={leftLegRef} position={[0.045, 0.1, 0]}>
        {bottomStyle === "shorts" ? (
          <>
            <mesh position={[0, 0.03, 0]}>
              <boxGeometry args={[0.07, 0.08, 0.08]} />
              <meshLambertMaterial color={trouserColor} />
            </mesh>
            <mesh position={[0, -0.045, 0]}>
              <boxGeometry args={[0.05, 0.06, 0.05]} />
              <meshLambertMaterial color={skin} />
            </mesh>
          </>
        ) : (
          <>
            <mesh>
              <boxGeometry args={[0.07, 0.14, 0.08]} />
              <meshLambertMaterial color={trouserColor} />
            </mesh>
            {bottomStyle === "cuffed" ? (
              <mesh position={[0, -0.05, 0]}>
                <boxGeometry args={[0.074, 0.022, 0.084]} />
                <meshLambertMaterial color="#d1d5db" />
              </mesh>
            ) : null}
          </>
        )}
        <mesh position={[0, -0.09, 0]}>
          <boxGeometry args={[0.07, 0.05, 0.12]} />
          <meshLambertMaterial color={shoeColor} />
        </mesh>
      </group>

      {/* Backpack */}
      {showBackpack ? (
        <group position={[0, 0.28, -0.08]}>
          <mesh>
            <boxGeometry args={[0.15, 0.18, 0.06]} />
            <meshLambertMaterial color={accessoryColor} />
          </mesh>
          <mesh position={[-0.06, 0.02, 0.02]}>
            <boxGeometry args={[0.018, 0.16, 0.018]} />
            <meshLambertMaterial color="#cbd5e1" />
          </mesh>
          <mesh position={[0.06, 0.02, 0.02]}>
            <boxGeometry args={[0.018, 0.16, 0.018]} />
            <meshLambertMaterial color="#cbd5e1" />
          </mesh>
        </group>
      ) : null}

      {/* Torso */}
      <mesh position={[0, 0.28, 0]}>
        <boxGeometry args={[0.18, 0.2, 0.1]} />
        <meshLambertMaterial color={topColor} />
      </mesh>
      {topStyle === "hoodie" ? (
        <>
          <mesh position={[0, 0.35, -0.045]}>
            <boxGeometry args={[0.17, 0.1, 0.03]} />
            <meshLambertMaterial color={topColor} />
          </mesh>
          <mesh position={[0, 0.22, 0.056]}>
            <boxGeometry args={[0.11, 0.03, 0.012]} />
            <meshLambertMaterial color={cuffColor} />
          </mesh>
        </>
      ) : null}
      {topStyle === "jacket" ? (
        <>
          <mesh position={[0, 0.28, 0.056]}>
            <boxGeometry args={[0.182, 0.21, 0.012]} />
            <meshLambertMaterial color={topAccentColor} />
          </mesh>
          <mesh position={[0, 0.28, 0.063]}>
            <boxGeometry args={[0.034, 0.2, 0.01]} />
            <meshLambertMaterial color="#f8fafc" />
          </mesh>
        </>
      ) : null}

      {/* Right arm */}
      <group ref={rightArmRef} position={[-0.12, 0.28, 0]}>
        <mesh position={[0, -0.08, 0]}>
          <boxGeometry args={[0.06, 0.16, 0.06]} />
          <meshLambertMaterial color={sleeveColor} />
        </mesh>
        {topStyle === "hoodie" ? (
          <mesh position={[0, -0.145, 0]}>
            <boxGeometry args={[0.064, 0.03, 0.064]} />
            <meshLambertMaterial color={cuffColor} />
          </mesh>
        ) : null}
        <mesh position={[0, -0.17, 0]}>
          <boxGeometry args={[0.05, 0.05, 0.05]} />
          <meshLambertMaterial color={skin} />
        </mesh>
      </group>

      {/* Left arm */}
      <group ref={leftArmRef} position={[0.12, 0.28, 0]}>
        <mesh position={[0, -0.08, 0]}>
          <boxGeometry args={[0.06, 0.16, 0.06]} />
          <meshLambertMaterial color={sleeveColor} />
        </mesh>
        {topStyle === "hoodie" ? (
          <mesh position={[0, -0.145, 0]}>
            <boxGeometry args={[0.064, 0.03, 0.064]} />
            <meshLambertMaterial color={cuffColor} />
          </mesh>
        ) : null}
        <mesh position={[0, -0.17, 0]}>
          <boxGeometry args={[0.05, 0.05, 0.05]} />
          <meshLambertMaterial color={skin} />
        </mesh>
      </group>

      {/* Neck */}
      <mesh position={[0, 0.39, 0]}>
        <boxGeometry args={[0.07, 0.05, 0.07]} />
        <meshLambertMaterial color={skin} />
      </mesh>

      {/* Head */}
      <mesh position={[0, 0.47, 0]}>
        <boxGeometry args={[0.16, 0.16, 0.14]} />
        <meshLambertMaterial attach="material-0" color={skin} />
        <meshLambertMaterial attach="material-1" color={skin} />
        <meshLambertMaterial attach="material-2" color={skin} />
        <meshLambertMaterial attach="material-3" color={skin} />
        <meshLambertMaterial attach="material-4" map={faceTexture} />
        <meshLambertMaterial attach="material-5" color={skin} />
      </mesh>

      {/* Hair */}
      {hairStyle === "short" ? (
        <mesh position={[0, 0.555, 0]}>
          <boxGeometry args={[0.17, 0.05, 0.15]} />
          <meshLambertMaterial color={hairColor} />
        </mesh>
      ) : null}
      {hairStyle === "parted" ? (
        <>
          <mesh position={[0, 0.555, 0]}>
            <boxGeometry args={[0.17, 0.045, 0.15]} />
            <meshLambertMaterial color={hairColor} />
          </mesh>
          <mesh position={[-0.035, 0.59, 0.01]} rotation={[0.1, 0, -0.2]}>
            <boxGeometry args={[0.12, 0.03, 0.08]} />
            <meshLambertMaterial color={hairColor} />
          </mesh>
        </>
      ) : null}
      {hairStyle === "spiky" ? (
        <>
          <mesh position={[0, 0.55, 0]}>
            <boxGeometry args={[0.16, 0.035, 0.14]} />
            <meshLambertMaterial color={hairColor} />
          </mesh>
          <mesh position={[-0.05, 0.59, 0]} rotation={[0, 0, -0.2]}>
            <boxGeometry args={[0.04, 0.06, 0.04]} />
            <meshLambertMaterial color={hairColor} />
          </mesh>
          <mesh position={[0, 0.605, 0]}>
            <boxGeometry args={[0.04, 0.08, 0.04]} />
            <meshLambertMaterial color={hairColor} />
          </mesh>
          <mesh position={[0.05, 0.59, 0]} rotation={[0, 0, 0.2]}>
            <boxGeometry args={[0.04, 0.06, 0.04]} />
            <meshLambertMaterial color={hairColor} />
          </mesh>
        </>
      ) : null}
      {hairStyle === "bun" ? (
        <>
          <mesh position={[0, 0.548, 0]}>
            <boxGeometry args={[0.17, 0.04, 0.15]} />
            <meshLambertMaterial color={hairColor} />
          </mesh>
          <mesh position={[0, 0.6, -0.035]}>
            <sphereGeometry args={[0.042, 14, 14]} />
            <meshLambertMaterial color={hairColor} />
          </mesh>
        </>
      ) : null}

      {/* Hat */}
      {hatStyle === "cap" ? (
        <>
          <mesh position={[0, 0.59, 0]}>
            <boxGeometry args={[0.172, 0.03, 0.152]} />
            <meshLambertMaterial color={accessoryColor} />
          </mesh>
          <mesh position={[0, 0.575, 0.07]}>
            <boxGeometry args={[0.09, 0.012, 0.05]} />
            <meshLambertMaterial color={accessoryColor} />
          </mesh>
        </>
      ) : null}
      {hatStyle === "beanie" ? (
        <mesh position={[0, 0.59, 0]}>
          <boxGeometry args={[0.18, 0.06, 0.16]} />
          <meshLambertMaterial color={accessoryColor} />
        </mesh>
      ) : null}

      {/* Headset */}
      {showHeadset ? (
        <>
          <mesh position={[0, 0.57, 0]} rotation={[0, 0, Math.PI / 2]}>
            <torusGeometry args={[0.09, 0.008, 8, 24, Math.PI]} />
            <meshLambertMaterial color="#94a3b8" />
          </mesh>
          <mesh position={[-0.1, 0.48, 0]}>
            <boxGeometry args={[0.018, 0.05, 0.028]} />
            <meshLambertMaterial color="#475569" />
          </mesh>
          <mesh position={[0.1, 0.48, 0]}>
            <boxGeometry args={[0.018, 0.05, 0.028]} />
            <meshLambertMaterial color="#475569" />
          </mesh>
          <mesh position={[0.085, 0.43, 0.06]} rotation={[0.25, 0.25, -0.4]}>
            <boxGeometry args={[0.012, 0.06, 0.012]} />
            <meshLambertMaterial color="#94a3b8" />
          </mesh>
        </>
      ) : null}

      {/* Glasses */}
      {showGlasses ? (
        <>
          <mesh position={[-0.04, 0.475, 0.078]}>
            <boxGeometry args={[0.05, 0.05, 0.01]} />
            <meshBasicMaterial color="#111827" wireframe />
          </mesh>
          <mesh position={[0.04, 0.475, 0.078]}>
            <boxGeometry args={[0.05, 0.05, 0.01]} />
            <meshBasicMaterial color="#111827" wireframe />
          </mesh>
          <mesh position={[0, 0.475, 0.078]}>
            <boxGeometry args={[0.02, 0.008, 0.01]} />
            <meshBasicMaterial color="#111827" />
          </mesh>
        </>
      ) : null}

      {/* Brows */}
      <mesh ref={leftBrowRef} position={[-0.04, 0.52, 0.074]}>
        <boxGeometry args={[0.04, 0.01, 0.01]} />
        <meshBasicMaterial color="#342016" />
      </mesh>
      <mesh ref={rightBrowRef} position={[0.04, 0.52, 0.074]}>
        <boxGeometry args={[0.04, 0.01, 0.01]} />
        <meshBasicMaterial color="#342016" />
      </mesh>

      {/* Eyes */}
      <mesh ref={leftEyeRef} position={[-0.04, 0.475, 0.072]}>
        <boxGeometry args={[0.03, 0.03, 0.01]} />
        <meshBasicMaterial color="#1a1a2e" />
      </mesh>
      <mesh ref={rightEyeRef} position={[0.04, 0.475, 0.072]}>
        <boxGeometry args={[0.03, 0.03, 0.01]} />
        <meshBasicMaterial color="#1a1a2e" />
      </mesh>
      <mesh ref={leftEyeHighlightRef} position={[-0.03, 0.482, 0.074]}>
        <boxGeometry args={[0.008, 0.008, 0.01]} />
        <meshBasicMaterial color="#fff" />
      </mesh>
      <mesh ref={rightEyeHighlightRef} position={[0.05, 0.482, 0.074]}>
        <boxGeometry args={[0.008, 0.008, 0.01]} />
        <meshBasicMaterial color="#fff" />
      </mesh>

      {/* Mouth */}
      <mesh ref={mouthRef} position={[0, 0.436, 0.074]}>
        <boxGeometry args={[0.05, 0.014, 0.01]} />
        <meshBasicMaterial color="#9c4a4a" />
      </mesh>
      <mesh ref={leftMouthCornerRef} position={[-0.031, 0.438, 0.074]} visible={false}>
        <boxGeometry args={[0.014, 0.014, 0.01]} />
        <meshBasicMaterial color="#9c4a4a" />
      </mesh>
      <mesh ref={rightMouthCornerRef} position={[0.031, 0.438, 0.074]} visible={false}>
        <boxGeometry args={[0.014, 0.014, 0.01]} />
        <meshBasicMaterial color="#9c4a4a" />
      </mesh>

      {/* Status pulse ring */}
      <mesh
        ref={pulseRingRef}
        position={[0, 0.005, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        visible={false}
      >
        <ringGeometry args={[0.13, 0.19, 24]} />
        <meshBasicMaterial
          ref={pulseRingMatRef}
          color="#22c55e"
          transparent
          opacity={0.5}
          depthWrite={false}
        />
      </mesh>

      {/* Nameplate */}
      {!activeSpeechBubble && nameplateText ? (
        <Billboard position={[0, 1.05, 0]}>
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

      {/* Speech bubble */}
      <group ref={speechBubbleRef} visible={false}>
        <Billboard position={[0, 1.45, 0]}>
          {activeSpeechBubble ? (
            <mesh
              position={[
                -speechBubbleWidth * 0.18,
                -speechBubbleHeight * 0.53,
                -0.0005,
              ]}
              rotation={[0, 0, Math.PI / 4]}
              renderOrder={99997}
            >
              <planeGeometry args={[0.22, 0.22]} />
              <meshBasicMaterial
                color="#1a2030"
                transparent
                opacity={0.82}
                depthTest={false}
                depthWrite={false}
              />
            </mesh>
          ) : null}
          {activeSpeechBubble ? (
            <mesh position={[0, 0, -0.0015]} renderOrder={99998}>
              <planeGeometry
                args={[
                  speechBubbleWidth + speechBubbleBorderInset,
                  speechBubbleHeight + speechBubbleBorderInset,
                ]}
              />
              <meshBasicMaterial
                color={speechBubbleBorderColor}
                transparent
                opacity={0.88}
                depthTest={false}
                depthWrite={false}
              />
            </mesh>
          ) : null}
          <mesh position={[0, 0, -0.001]} renderOrder={99999}>
            <planeGeometry args={[speechBubbleWidth, speechBubbleHeight]} />
            <meshBasicMaterial
              ref={speechBubbleMatRef}
              color="#1a2030"
              transparent
              opacity={activeSpeechBubble ? 0.76 : 0.92}
              depthTest={false}
              depthWrite={false}
            />
          </mesh>
          <Text
            font={NAMEPLATE_FONT}
            position={
              activeSpeechBubble
                ? [-speechBubbleWidth / 2 + speechBubblePaddingX / 2, 0, 0.001]
                : [0, 0, 0.001]
            }
            fontSize={speechBubbleFontSize}
            color={speechBubbleTextColor}
            anchorX={activeSpeechBubble ? "left" : "center"}
            anchorY="middle"
            maxWidth={speechBubbleMaxWidth}
            textAlign={activeSpeechBubble ? "left" : "center"}
            lineHeight={1.1}
            renderOrder={100000}
            depthOffset={-10}
            // eslint-disable-next-line react/no-unknown-property
            material-depthTest={false}
            // eslint-disable-next-line react/no-unknown-property
            material-depthWrite={false}
          >
            {speechBubbleDisplayText}
          </Text>
          {activeSpeechBubble && speechBubbleWasTruncated ? (
            <Text
              font={NAMEPLATE_FONT}
              position={[0, -speechBubbleHeight * 0.34, 0.001]}
              fontSize={0.09}
              color="#8ab4ff"
              anchorX="center"
              anchorY="middle"
              maxWidth={speechBubbleMaxWidth}
              textAlign="center"
              renderOrder={100001}
              depthOffset={-10}
              // eslint-disable-next-line react/no-unknown-property
              material-depthTest={false}
              // eslint-disable-next-line react/no-unknown-property
              material-depthWrite={false}
            >
              click for full chat
            </Text>
          ) : null}
        </Billboard>
      </group>
    </group>
  );
});

AgentModel.displayName = "AgentModel";
