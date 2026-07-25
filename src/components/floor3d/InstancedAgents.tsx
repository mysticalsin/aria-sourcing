"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { OfficeAgent } from "./types";

/* ============================================================================
   InstancedAgents — the LOD tail for the floor. Agents beyond the full-detail
   cap render as cheap seated proxies (desk block + capsule body + head box) via
   three InstancedMeshes, so 300 agents cost ~3 draw calls for the tail instead
   of thousands. Per-instance position (desk grid) + per-instance body/head
   colour. Static (no walk sim) — these are the background of the room.
   ========================================================================== */

// Mirror the desk-grid constants from Floor3DScene so the proxy grid lines up
// seamlessly with the full-detail desks in front.
const COLS = 6;
const COL_SPACING = 2.4;
const ROW_SPACING = 2.8;
const SEAT_Z_OFFSET = 0.45;

export function InstancedAgents({
  agents,
  startIndex,
}: {
  agents: OfficeAgent[];
  startIndex: number;
}) {
  const count = agents.length;
  const deskRef = useRef<THREE.InstancedMesh>(null);
  const bodyRef = useRef<THREE.InstancedMesh>(null);
  const headRef = useRef<THREE.InstancedMesh>(null);

  const deskMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#9B6535", roughness: 0.62, metalness: 0 }),
    [],
  );

  // Dispose the explicitly-created material on unmount to prevent GPU leaks.
  useEffect(() => {
    return () => {
      deskMat.dispose();
    };
  }, [deskMat]);

  useLayoutEffect(() => {
    const desk = deskRef.current;
    const body = bodyRef.current;
    const head = headRef.current;
    if (!desk || !body || !head) return;

    const d = new THREE.Object3D();
    const col = new THREE.Color();

    agents.forEach((a, k) => {
      const gi = startIndex + k;
      const c = gi % COLS;
      const r = Math.floor(gi / COLS);
      const x = (c - (COLS - 1) / 2) * COL_SPACING;
      const z = r * ROW_SPACING;

      d.rotation.set(0, 0, 0);
      d.scale.set(1, 1, 1);

      // Desk block
      d.position.set(x, 0.34, z);
      d.updateMatrix();
      desk.setMatrixAt(k, d.matrix);

      // Seated body (behind the desk)
      d.position.set(x, 0.92, z + SEAT_Z_OFFSET);
      d.updateMatrix();
      body.setMatrixAt(k, d.matrix);

      // Head
      d.position.set(x, 1.24, z + SEAT_Z_OFFSET);
      d.updateMatrix();
      head.setMatrixAt(k, d.matrix);

      col.set(a.color);
      body.setColorAt(k, col);
      head.setColorAt(k, col);
    });

    desk.instanceMatrix.needsUpdate = true;
    body.instanceMatrix.needsUpdate = true;
    head.instanceMatrix.needsUpdate = true;
    if (body.instanceColor) body.instanceColor.needsUpdate = true;
    if (head.instanceColor) head.instanceColor.needsUpdate = true;
  }, [agents, startIndex]);

  if (count === 0) return null;

  return (
    // key={count} forces a fresh InstancedMesh when the tail size changes —
    // InstancedMesh count is fixed at construction.
    <group key={count}>
      <instancedMesh ref={deskRef} args={[undefined, undefined, count]} receiveShadow castShadow material={deskMat}>
        <boxGeometry args={[1.2, 0.68, 0.6]} />
      </instancedMesh>
      <instancedMesh ref={bodyRef} args={[undefined, undefined, count]} castShadow>
        <capsuleGeometry args={[0.16, 0.22, 4, 8]} />
        <meshStandardMaterial roughness={0.32} metalness={0.05} />
      </instancedMesh>
      <instancedMesh ref={headRef} args={[undefined, undefined, count]} castShadow>
        <boxGeometry args={[0.24, 0.26, 0.22]} />
        <meshStandardMaterial roughness={0.28} metalness={0.05} />
      </instancedMesh>
    </group>
  );
}
