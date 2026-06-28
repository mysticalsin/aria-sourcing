"use client";
// Ported from iamlukethedev/Claw3D (MIT License)
// Pure-ref agent tick: no React state updates per frame.
// Simplified: working→desk, idle→roam, error→stand.

import { useCallback, useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { OfficeAgent } from "@/components/floor3d/types";
import type { RenderAgent } from "../core/types";
import {
  BUMP_FREEZE_MS,
  BUMP_RECOVERY_MS,
  DESK_STICKY_MS,
  SEPARATION_STRENGTH,
  AGENT_RADIUS,
  WALK_SPEED,
  WORKING_WALK_SPEED_MULTIPLIER,
} from "../core/constants";
import {
  DESK_POSITIONS,
  ROAM_POINTS,
  astar,
  buildNavGrid,
  type NavGrid,
} from "../core/navigation";

// Shared, static nav grid — no furniture blocking in this simplified port.
const STATIC_NAV_GRID: NavGrid = buildNavGrid([]);

function pickRoamPoint(): { x: number; y: number } {
  return ROAM_POINTS[Math.floor(Math.random() * ROAM_POINTS.length)];
}

function spawnPoint(): { x: number; y: number } {
  return {
    x: 200 + Math.random() * 800,
    y: 200 + Math.random() * 800,
  };
}

// ---------------------------------------------------------------------------
// Collision separation — simplified from Claw3D NavigationSystem.tsx
// ---------------------------------------------------------------------------
function applyCollisionBumps(agents: RenderAgent[], now: number): RenderAgent[] {
  const result = [...agents];
  const minDist = AGENT_RADIUS * 2;

  for (let i = 0; i < result.length; i += 1) {
    if (result[i].state === "sitting") continue;
    if (result[i].bumpedUntil !== undefined) continue;
    if ((result[i].collisionCooldownUntil ?? 0) > now) continue;

    let sx = 0, sy = 0;
    for (let j = 0; j < result.length; j += 1) {
      if (i === j) continue;
      const ddx = result[i].x - result[j].x;
      const ddy = result[i].y - result[j].y;
      const d = Math.hypot(ddx, ddy);
      if (d < minDist && d > 0) {
        const push = (1 - d / minDist) * SEPARATION_STRENGTH;
        sx += (ddx / d) * push;
        sy += (ddy / d) * push;
      }
    }

    if (sx === 0 && sy === 0) continue;

    const r = pickRoamPoint();
    result[i] = {
      ...result[i],
      state: "standing",
      path: [],
      targetX: r.x,
      targetY: r.y,
      facing: Math.atan2(sx, sy),
      bumpedUntil: now + BUMP_FREEZE_MS,
      bumpTalkUntil: now + BUMP_FREEZE_MS,
    };
  }

  return result;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useAgentTick(agents: OfficeAgent[]): {
  renderAgentsRef: React.RefObject<RenderAgent[]>;
  renderAgentLookupRef: React.RefObject<Map<string, RenderAgent>>;
} {
  const renderAgentsRef = useRef<RenderAgent[]>([]);
  const renderAgentLookupRef = useRef<Map<string, RenderAgent>>(new Map());
  const deskByAgentRef = useRef<Map<string, number>>(new Map());
  const stickyUntilRef = useRef<Map<string, number>>(new Map());

  const planPath = useCallback(
    (fx: number, fy: number, tx: number, ty: number) =>
      astar(fx, fy, tx, ty, STATIC_NAV_GRID),
    [],
  );

  // Sync agent roster whenever the agents prop changes.
  useEffect(() => {
    const activeIds = new Set(agents.map((a) => a.id));
    for (const id of deskByAgentRef.current.keys()) {
      if (!activeIds.has(id)) deskByAgentRef.current.delete(id);
    }
    for (const id of stickyUntilRef.current.keys()) {
      if (!activeIds.has(id)) stickyUntilRef.current.delete(id);
    }

    const currentMap = new Map(renderAgentsRef.current.map((a) => [a.id, a]));
    const now = Date.now();
    const next: RenderAgent[] = [];

    agents.forEach((agent, idx) => {
      // Assign desk (permanent per-agent)
      if (!deskByAgentRef.current.has(agent.id)) {
        deskByAgentRef.current.set(agent.id, idx % DESK_POSITIONS.length);
      }
      const deskIdx = deskByAgentRef.current.get(agent.id)!;
      const deskPos = DESK_POSITIONS[deskIdx] ?? DESK_POSITIONS[0];

      // Status stickiness: keep "working" for DESK_STICKY_MS after it flips
      if (agent.status === "working") {
        stickyUntilRef.current.set(agent.id, now + DESK_STICKY_MS);
      }
      const stickyUntil = stickyUntilRef.current.get(agent.id) ?? 0;
      const effectiveStatus: RenderAgent["status"] =
        agent.status === "error"
          ? "error"
          : agent.status === "working" || stickyUntil > now
            ? "working"
            : "idle";

      const existing = currentMap.get(agent.id);

      if (existing) {
        let ns: RenderAgent = { ...existing, status: effectiveStatus };

        if (effectiveStatus === "working") {
          const targetChanged =
            existing.targetX !== deskPos.x || existing.targetY !== deskPos.y;
          ns.targetX = deskPos.x;
          ns.targetY = deskPos.y;
          if (targetChanged) {
            ns.path = planPath(existing.x, existing.y, deskPos.x, deskPos.y);
          }
          ns.state =
            Math.hypot(existing.x - deskPos.x, existing.y - deskPos.y) < 15
              ? "sitting"
              : "walking";
        } else if (effectiveStatus === "error") {
          ns.targetX = existing.x;
          ns.targetY = existing.y;
          ns.path = [];
          ns.state = "standing";
        } else {
          // idle — if we just switched from working, pick a roam point
          if (existing.status === "working") {
            const r = pickRoamPoint();
            ns.targetX = r.x;
            ns.targetY = r.y;
            ns.path = planPath(existing.x, existing.y, r.x, r.y);
            ns.state = "walking";
          }
        }

        next.push(ns);
      } else {
        // New agent: spawn at random position, walk to first target
        const { x: sx, y: sy } = spawnPoint();
        const initialTarget =
          effectiveStatus === "working"
            ? deskPos
            : pickRoamPoint();

        next.push({
          id: agent.id,
          name: agent.name,
          subtitle: agent.subtitle,
          status: effectiveStatus,
          color: agent.color,
          x: sx,
          y: sy,
          targetX: initialTarget.x,
          targetY: initialTarget.y,
          path: planPath(sx, sy, initialTarget.x, initialTarget.y),
          frame: Math.floor(Math.random() * 60),
          walkSpeed: WALK_SPEED * (0.7 + Math.random() * 0.6),
          phaseOffset: Math.random() * Math.PI * 2,
          state: "walking",
          facing: 0,
        });
      }
    });

    renderAgentsRef.current = next;
    renderAgentLookupRef.current = new Map(next.map((a) => [a.id, a]));
  }, [agents, planPath]);

  // Per-frame movement tick — no React state, pure ref mutation.
  useFrame(() => {
    const now = Date.now();

    const moved = renderAgentsRef.current.map((agent): RenderAgent => {
      // Bumped freeze
      if (agent.bumpedUntil !== undefined) {
        if (now < agent.bumpedUntil) {
          return { ...agent, state: "standing", frame: agent.frame + 1 };
        }
        return {
          ...agent,
          bumpedUntil: undefined,
          bumpTalkUntil: undefined,
          collisionCooldownUntil: now + BUMP_RECOVERY_MS,
          state: "walking",
          path: astar(
            agent.x, agent.y, agent.targetX, agent.targetY, STATIC_NAV_GRID,
          ),
          frame: agent.frame + 1,
        };
      }

      const baseSpeed = agent.walkSpeed ?? WALK_SPEED;
      const speed =
        agent.status === "working" && agent.state !== "sitting"
          ? baseSpeed * WORKING_WALK_SPEED_MULTIPLIER
          : baseSpeed;

      const path = agent.path ?? [];
      const wpX = path.length > 0 ? path[0].x : agent.x;
      const wpY = path.length > 0 ? path[0].y : agent.y;
      const dx = wpX - agent.x;
      const dy = wpY - agent.y;
      const dist = Math.hypot(dx, dy);

      let ns = agent.state;
      let nx = agent.x, ny = agent.y, nf = agent.facing;
      let npath = path;

      if (dist > speed) {
        nx = agent.x + (dx / dist) * speed;
        ny = agent.y + (dy / dist) * speed;
        nf = Math.atan2(dx, dy);
        ns = "walking";
      } else {
        nx = wpX;
        ny = wpY;
        if (path.length > 1) {
          npath = path.slice(1);
          ns = "walking";
        } else {
          npath = [];
          if (agent.status === "working") {
            ns = "sitting";
            // Face "north" (toward viewer) when seated
            nf = Math.PI;
          } else if (agent.status === "idle") {
            // Reached roam point — pause briefly then pick a new one
            const r = pickRoamPoint();
            return {
              ...agent,
              x: nx, y: ny,
              path: planPath(nx, ny, r.x, r.y),
              targetX: r.x, targetY: r.y,
              facing: nf, state: "standing",
              frame: agent.frame + 1,
            };
          } else {
            ns = "standing";
          }
        }
      }

      return {
        ...agent,
        x: nx, y: ny, path: npath,
        facing: nf, state: ns,
        frame: agent.frame + 1,
      };
    });

    const bumped = applyCollisionBumps(moved, now);
    renderAgentsRef.current = bumped;
    renderAgentLookupRef.current = new Map(bumped.map((a) => [a.id, a]));
  });

  return { renderAgentsRef, renderAgentLookupRef };
}
