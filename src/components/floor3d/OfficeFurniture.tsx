"use client";

import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import * as THREE from "three";

/* ============================================================================
   OfficeFurniture — a richer, Claw3D-style furnished workspace around the desk
   grid: a lounge, a kitchen, a meeting area, bookcases, floor lamps and plants.
   GLBs (from the Claw3D office-asset set) are auto-fitted by bounding box to a
   target height and grounded, so placement is robust to each model's scale.
   ========================================================================== */

const A = "/office3d/assets/";
const F = {
  sofa: A + "loungeSofa.glb",
  loungeChair: A + "loungeDesignChair.glb",
  coffee: A + "tableCoffee.glb",
  roundTable: A + "tableRound.glb",
  meetChair: A + "chairModernCushion.glb",
  cabinet: A + "kitchenCabinet.glb",
  fridge: A + "kitchenFridgeSmall.glb",
  coffeeMachine: A + "kitchenCoffeeMachine.glb",
  bookcase: A + "bookcaseClosed.glb",
  lamp: A + "lampRoundFloor.glb",
  plant: A + "pottedPlant.glb",
  plantS: A + "plantSmall1.glb",
  table: A + "table.glb",
} as const;

for (const u of Object.values(F)) useGLTF.preload(u);

function useFitted(url: string, height: number): { obj: THREE.Object3D; yOffset: number } {
  const { scene } = useGLTF(url);
  return useMemo(() => {
    const obj = scene.clone(true);
    obj.updateMatrixWorld(true);
    const size = new THREE.Vector3();
    new THREE.Box3().setFromObject(obj).getSize(size);
    obj.scale.setScalar(height / (size.y || 1));
    obj.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(obj);
    obj.traverse((c) => {
      if (c instanceof THREE.Mesh) {
        c.castShadow = true;
        c.receiveShadow = true;
      }
    });
    return { obj, yOffset: -box2.min.y };
  }, [scene, height]);
}

function Item({
  url,
  height,
  position,
  rotationY = 0,
}: {
  url: string;
  height: number;
  position: [number, number, number];
  rotationY?: number;
}) {
  const { obj, yOffset } = useFitted(url, height);

  // Dispose cloned geometry + materials on unmount to prevent GPU leaks.
  useEffect(() => {
    return () => {
      obj.traverse((c) => {
        if (c instanceof THREE.Mesh) {
          c.geometry?.dispose();
          const m = c.material;
          (Array.isArray(m) ? m : [m]).forEach((mat) => mat?.dispose());
        }
      });
    };
  }, [obj]);

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <primitive object={obj} position={[0, yOffset, 0]} />
    </group>
  );
}

export function OfficeFurniture() {
  return (
    <group>
      {/* ── Lounge (left side) ─────────────────────────────────────────── */}
      <Item url={F.sofa} height={0.85} position={[-10.5, 0, 5]} rotationY={Math.PI / 2} />
      <Item url={F.loungeChair} height={0.9} position={[-8.6, 0, 3.9]} rotationY={-Math.PI / 3} />
      <Item url={F.loungeChair} height={0.9} position={[-8.6, 0, 6.1]} rotationY={-(Math.PI * 2) / 3} />
      <Item url={F.coffee} height={0.42} position={[-9.4, 0, 5]} />
      <Item url={F.lamp} height={1.6} position={[-11.5, 0, 6.8]} />
      <Item url={F.plant} height={0.95} position={[-11.5, 0, 3.4]} />

      {/* ── Kitchen (back-left) ────────────────────────────────────────── */}
      <Item url={F.cabinet} height={0.95} position={[-11.6, 0, -4.2]} rotationY={Math.PI / 2} />
      <Item url={F.fridge} height={1.15} position={[-11.6, 0, -2.6]} rotationY={Math.PI / 2} />
      <Item url={F.coffeeMachine} height={0.4} position={[-11.5, 0.95, -5.3]} rotationY={Math.PI / 2} />
      <Item url={F.table} height={0.74} position={[-8.8, 0, -3.6]} />
      <Item url={F.meetChair} height={0.9} position={[-8.8, 0, -2.4]} rotationY={Math.PI} />
      <Item url={F.meetChair} height={0.9} position={[-8.8, 0, -4.8]} />

      {/* ── Meeting area (right side) ──────────────────────────────────── */}
      <Item url={F.roundTable} height={0.75} position={[10.5, 0, 5]} />
      {[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2;
        return (
          <Item
            key={i}
            url={F.meetChair}
            height={0.9}
            position={[10.5 + Math.cos(a) * 1.3, 0, 5 + Math.sin(a) * 1.3]}
            rotationY={a + Math.PI}
          />
        );
      })}
      <Item url={F.plant} height={0.95} position={[12.4, 0, 2.8]} />

      {/* ── Bookcases (left wall) ──────────────────────────────────────── */}
      <Item url={F.bookcase} height={1.85} position={[-12.7, 0, -0.2]} rotationY={Math.PI / 2} />
      <Item url={F.bookcase} height={1.85} position={[-12.7, 0, 1.6]} rotationY={Math.PI / 2} />

      {/* ── Scattered plants + lamps ───────────────────────────────────── */}
      <Item url={F.plantS} height={0.6} position={[8.5, 0, 11.5]} />
      <Item url={F.lamp} height={1.6} position={[12.4, 0, 9.5]} />
      <Item url={F.plantS} height={0.6} position={[-7, 0, 10]} />
    </group>
  );
}
