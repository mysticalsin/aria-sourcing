"use client";
// The Living Floor's FX layer: a pooled sprite/ring system that reacts to the
// real agent-events bus (src/lib/agent-events.ts). Purely additive — reads
// live agent positions off the shared renderAgentsRef and never touches
// nav/collision fields (x/y/targetX/targetY/path/state stay owned by
// agentTick.ts). Mounted only on the "high" device tier (see
// RetroOfficeScene.tsx); "low" already folds in prefers-reduced-motion
// (src/lib/device.ts), so the 2D activity ticker (src/app/floor/page.tsx) is
// the guaranteed fallback everywhere this isn't mounted.

import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { subscribe, type AgentEvent } from "@/lib/agent-events";
import type { RenderAgent } from "../core/types";
import { toWorld } from "../core/geometry";
import { CANVAS_H, CANVAS_W } from "../core/constants";
import { EVENT_COLOR, PACKET_FLIGHT_MS, PULSE_MS, pickResponderIndex } from "@/lib/floor3d";

export interface PacketFXProps {
  /** Live, ref-driven agent records (agentTick.ts). Read-only here. */
  agentsRef: RefObject<RenderAgent[]>;
  /** id of the CEO seat's render agent — doubles as the "central hub" that
   *  every packet flies to, and as the fallback start point. */
  ceoId: string | null;
}

const PACKET_POOL_SIZE = 16;
const RING_POOL_SIZE = 24;
const PACKET_BASE_HEIGHT = 1.05;
const PACKET_ARC_HEIGHT = 0.9;
const RING_BASE_Y = 0.035;
const HUB_HOVER_HEIGHT = 0.4;

interface PacketSlot {
  active: boolean;
  from: THREE.Vector3;
  to: THREE.Vector3;
  color: THREE.Color;
  start: number;
  duration: number;
}

/** Small radial-gradient dot texture, reused by every pooled sprite/ring —
 *  matches the procedural-canvas-texture convention already used in
 *  RetroEnvironment.tsx (makeCarpetTexture/makeBrickTexture). */
function makeGlowTexture(): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.65)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

export function PacketFX({ agentsRef, ceoId }: PacketFXProps) {
  const glowTex = useMemo(() => makeGlowTexture(), []);

  // Fixed pool — pre-allocated once, mutated in place every frame. No
  // per-frame allocation: positions/colors are `.set()`/`.lerpVectors()`
  // onto the same Vector3/Color instances, never replaced.
  const slotsRef = useRef<PacketSlot[]>(
    Array.from({ length: PACKET_POOL_SIZE }, () => ({
      active: false,
      from: new THREE.Vector3(),
      to: new THREE.Vector3(),
      color: new THREE.Color(EVENT_COLOR.source),
      start: 0,
      duration: PACKET_FLIGHT_MS,
    })),
  );
  const spriteRefs = useRef<(THREE.Sprite | null)[]>([]);
  const ringRefs = useRef<(THREE.Mesh | null)[]>([]);
  const ringMatRefs = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const hubRef = useRef<THREE.Mesh>(null);

  const resolveHub = (): { x: number; y: number } => {
    const ceo = ceoId ? agentsRef.current?.find((a) => a.id === ceoId) : undefined;
    return ceo ? { x: ceo.x, y: ceo.y } : { x: CANVAS_W / 2, y: CANVAS_H / 2 };
  };

  useEffect(() => {
    const unsubscribe = subscribe((e: AgentEvent) => {
      const agents = agentsRef.current ?? [];
      const employees = ceoId ? agents.filter((a) => a.id !== ceoId) : agents;
      const source =
        (e.seatId ? agents.find((a) => a.id === e.seatId) : undefined) ??
        (employees.length > 0 ? employees[pickResponderIndex(e, employees.length)] : undefined);

      const hub = resolveHub();
      const fromXY = source ? { x: source.x, y: source.y } : hub;

      const [fx, , fz] = toWorld(fromXY.x, fromXY.y);
      const [hx, , hz] = toWorld(hub.x, hub.y);

      // Grab a free pooled slot, or steal the oldest in-flight one.
      const slots = slotsRef.current;
      let idx = slots.findIndex((s) => !s.active);
      if (idx === -1) {
        idx = 0;
        let oldestStart = slots[0].start;
        slots.forEach((s, i) => {
          if (s.start < oldestStart) {
            oldestStart = s.start;
            idx = i;
          }
        });
      }
      const slot = slots[idx];
      slot.from.set(fx, PACKET_BASE_HEIGHT, fz);
      slot.to.set(hx, PACKET_BASE_HEIGHT, hz);
      slot.color.set(EVENT_COLOR[e.kind]);
      slot.start = performance.now();
      slot.duration = PACKET_FLIGHT_MS;
      slot.active = true;

      const sprite = spriteRefs.current[idx];
      if (sprite) {
        const mat = sprite.material as THREE.SpriteMaterial;
        mat.color.copy(slot.color);
        mat.opacity = 1;
        sprite.position.copy(slot.from);
        sprite.visible = true;
      }

      // Status pulse: additive marker only (never touches nav/position
      // fields); agentTick's per-frame object-spread carries it forward for
      // free until it naturally expires.
      if (source) {
        source.pulseUntil = Date.now() + PULSE_MS;
        source.emit = { kind: e.kind, color: EVENT_COLOR[e.kind], at: Date.now() };
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ceoId]);

  useFrame(() => {
    const now = performance.now();
    const wallNow = Date.now();

    // Packets in flight.
    const slots = slotsRef.current;
    for (let i = 0; i < slots.length; i += 1) {
      const slot = slots[i];
      const sprite = spriteRefs.current[i];
      if (!slot.active || !sprite) continue;
      const t = (now - slot.start) / slot.duration;
      if (t >= 1) {
        slot.active = false;
        sprite.visible = false;
        continue;
      }
      sprite.position.lerpVectors(slot.from, slot.to, t);
      sprite.position.y += Math.sin(t * Math.PI) * PACKET_ARC_HEIGHT;
      const mat = sprite.material as THREE.SpriteMaterial;
      mat.opacity = t > 0.82 ? Math.max(0, (1 - t) / 0.18) : 1;
      sprite.scale.setScalar(0.3 + Math.sin(t * Math.PI) * 0.12);
    }

    // Status-pulse halos — one ring per currently-pulsing shown agent (up to
    // RING_POOL_SIZE). Reads live agent records only; never mutates them
    // beyond the pulseUntil/emit fields set above.
    const agents = agentsRef.current ?? [];
    let ringIdx = 0;
    for (let i = 0; i < agents.length && ringIdx < RING_POOL_SIZE; i += 1) {
      const agent = agents[i];
      if (!agent.pulseUntil || agent.pulseUntil <= wallNow) continue;
      const ring = ringRefs.current[ringIdx];
      const mat = ringMatRefs.current[ringIdx];
      if (!ring || !mat) {
        ringIdx += 1;
        continue;
      }
      const [wx, , wz] = toWorld(agent.x, agent.y);
      ring.position.set(wx, RING_BASE_Y, wz);
      ring.visible = true;
      const remain = Math.max(0, (agent.pulseUntil - wallNow) / PULSE_MS);
      mat.color.set(agent.emit?.color ?? EVENT_COLOR.source);
      mat.opacity = remain * 0.6;
      ring.scale.setScalar(1 + (1 - remain) * 1.6);
      ringIdx += 1;
    }
    for (; ringIdx < RING_POOL_SIZE; ringIdx += 1) {
      const ring = ringRefs.current[ringIdx];
      if (ring) ring.visible = false;
    }

    // Hub beacon — a gentle idle pulse so the destination reads as a fixed
    // "mission control" point even between packets.
    if (hubRef.current) {
      const hub = resolveHub();
      const [hx, , hz] = toWorld(hub.x, hub.y);
      hubRef.current.position.set(hx, PACKET_BASE_HEIGHT + HUB_HOVER_HEIGHT, hz);
      hubRef.current.scale.setScalar(1 + Math.sin(wallNow * 0.003) * 0.15);
    }
  });

  return (
    <>
      {Array.from({ length: PACKET_POOL_SIZE }).map((_, i) => (
        <sprite
          key={`packet-${i}`}
          ref={(el) => {
            spriteRefs.current[i] = el;
          }}
          visible={false}
          scale={[0.3, 0.3, 0.3]}
        >
          <spriteMaterial
            map={glowTex ?? undefined}
            color={EVENT_COLOR.source}
            transparent
            depthWrite={false}
            opacity={1}
          />
        </sprite>
      ))}

      {Array.from({ length: RING_POOL_SIZE }).map((_, i) => (
        <mesh
          key={`pulse-ring-${i}`}
          ref={(el) => {
            ringRefs.current[i] = el;
          }}
          rotation={[-Math.PI / 2, 0, 0]}
          visible={false}
        >
          <ringGeometry args={[0.28, 0.42, 24]} />
          <meshBasicMaterial
            ref={(el) => {
              ringMatRefs.current[i] = el;
            }}
            color={EVENT_COLOR.source}
            transparent
            opacity={0.5}
            depthWrite={false}
          />
        </mesh>
      ))}

      <mesh ref={hubRef}>
        <icosahedronGeometry args={[0.16, 0]} />
        <meshBasicMaterial
          map={glowTex ?? undefined}
          color="#8ab4ff"
          transparent
          opacity={0.85}
          depthWrite={false}
        />
      </mesh>
    </>
  );
}
