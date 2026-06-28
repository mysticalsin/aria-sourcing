"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

/* ============================================================================
   CityWorld — the office sits inside a living city block. A ring of buildings,
   a distant skyline, driving traffic, a bank + a glass car-showroom, street
   lights and trees — all visible through the office's frosted-glass walls.

   Every GLB is auto-fitted by bounding box to a target height and grounded on
   y=0, so placement is robust to each model's unknown native scale. Geometry is
   shared from the useGLTF cache across clones (memory-efficient) and is NOT
   disposed here — the cache owns it; disposing would corrupt re-mounts.
   ========================================================================== */

const A = "/office3d/assets/";
const URL = {
  building1: A + "building1.glb",
  building2: A + "building2.glb",
  apartment: A + "apartment.glb",
  apartment2: A + "apartment2.glb",
  atm: A + "atm.glb",
  car1: A + "car1.glb",
  car2: A + "car2.glb",
  truck1: A + "truck1.glb",
  streetLight: A + "street-light.glb",
  trafficLight: A + "traffic-light.glb",
  tree: A + "tree.glb",
} as const;

for (const u of Object.values(URL)) useGLTF.preload(u);

/** Deterministic [0,1) noise from an integer — no Math.random (stable layout). */
function noise(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

/** Clone a GLB, scale it to `height` world-units tall, and report the y-offset
 *  that grounds its base on y=0. Shared geometry (intentional). */
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

/** A grounded, auto-fitted GLB instance. */
function Glb({
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
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <primitive object={obj} position={[0, yOffset, 0]} />
    </group>
  );
}

/** A car/truck that drives along an east-west road, looping at the ends. */
function TrafficVehicle({
  url,
  z,
  dir,
  speed,
  startX,
  height,
}: {
  url: string;
  z: number;
  dir: 1 | -1;
  speed: number;
  startX: number;
  height: number;
}) {
  const ref = useRef<THREE.Group>(null);
  const { obj, yOffset } = useFitted(url, height);
  const HALF = 52;
  useFrame((_, delta) => {
    const g = ref.current;
    if (!g) return;
    g.position.x += dir * speed * Math.min(delta, 0.05);
    if (dir > 0 && g.position.x > HALF) g.position.x = -HALF;
    if (dir < 0 && g.position.x < -HALF) g.position.x = HALF;
  });
  // Vehicles model nose-forward on +Z; rotate ±90° to drive along X.
  return (
    <group ref={ref} position={[startX, 0, z]} rotation={[0, dir > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}>
      <primitive object={obj} position={[0, yOffset, 0]} />
    </group>
  );
}

/* ── City layout (computed once, deterministic) ───────────────────────────── */

interface Placed {
  key: string;
  url: string;
  x: number;
  z: number;
  height: number;
  ry: number;
}

const BUILDING_URLS = [URL.building1, URL.building2, URL.apartment, URL.apartment2];

/** Ring of mid-rise buildings hugging the office block. */
const BUILDINGS: Placed[] = (() => {
  const out: Placed[] = [];
  const N = 18;
  const cx = 0;
  const cz = 2;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const rx = 34 + noise(i) * 8;
    const rz = 31 + noise(i * 3.3) * 8;
    const x = cx + Math.cos(a) * rx;
    const z = cz + Math.sin(a) * rz;
    out.push({
      key: `b${i}`,
      url: BUILDING_URLS[i % BUILDING_URLS.length],
      x,
      z,
      height: 9 + noise(i * 7.1) * 17,
      ry: Math.atan2(cx - x, cz - z), // face the office
    });
  }
  return out;
})();

/** Far skyline — cheap extruded boxes for depth behind the buildings. */
const SKYLINE: { key: string; x: number; z: number; w: number; h: number; d: number }[] = (() => {
  const out: { key: string; x: number; z: number; w: number; h: number; d: number }[] = [];
  const N = 30;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = 62 + noise(i * 5.7) * 26;
    out.push({
      key: `s${i}`,
      x: Math.cos(a) * r,
      z: 2 + Math.sin(a) * r,
      w: 6 + noise(i) * 6,
      h: 16 + noise(i * 2.2) * 40,
      d: 6 + noise(i * 9.1) * 6,
    });
  }
  return out;
})();

/** Street lights + trees along the rear boulevard and side street. */
const STREET_PROPS: { key: string; url: string; x: number; z: number; height: number }[] = (() => {
  const out: { key: string; url: string; x: number; z: number; height: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const x = -45 + i * 15;
    out.push({ key: `sl${i}`, url: URL.streetLight, x, z: -18, height: 5 });
    out.push({ key: `tr${i}`, url: URL.tree, x: x + 7, z: -21, height: 4.2 + noise(i) * 1.6 });
  }
  for (let i = 0; i < 5; i++) {
    const z = -10 + i * 10;
    out.push({ key: `slx${i}`, url: URL.streetLight, x: -26, z, height: 5 });
  }
  return out;
})();

/* ── The world ────────────────────────────────────────────────────────────── */

export function CityWorld() {
  const groundMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#2E2C38", roughness: 0.95, metalness: 0 }),
    [],
  );
  const roadMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#1B1A22", roughness: 0.9, metalness: 0 }),
    [],
  );
  const skylineMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#2A2440", roughness: 0.85, metalness: 0.05 }),
    [],
  );

  return (
    <group>
      {/* City ground — sits just below the office oak floor (no z-fight). */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.06, 2]} receiveShadow material={groundMat}>
        <planeGeometry args={[260, 260]} />
      </mesh>

      {/* Rear boulevard + side street (dark asphalt strips). */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, -18]} receiveShadow material={roadMat}>
        <planeGeometry args={[120, 9]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-26, -0.04, -2]} receiveShadow material={roadMat}>
        <planeGeometry args={[9, 60]} />
      </mesh>

      {/* Distant skyline */}
      {SKYLINE.map((s) => (
        <mesh key={s.key} position={[s.x, s.h / 2, s.z]} material={skylineMat} castShadow>
          <boxGeometry args={[s.w, s.h, s.d]} />
        </mesh>
      ))}

      {/* Mid-rise building ring */}
      {BUILDINGS.map((b) => (
        <Glb key={b.key} url={b.url} height={b.height} position={[b.x, 0, b.z]} rotationY={b.ry} />
      ))}

      {/* Driving traffic on the rear boulevard */}
      <TrafficVehicle url={URL.car1} z={-16.4} dir={1} speed={9} startX={-40} height={1.5} />
      <TrafficVehicle url={URL.car2} z={-16.4} dir={1} speed={7} startX={6} height={1.5} />
      <TrafficVehicle url={URL.truck1} z={-16.4} dir={1} speed={5.5} startX={-12} height={2.6} />
      <TrafficVehicle url={URL.car2} z={-19.6} dir={-1} speed={8} startX={30} height={1.5} />
      <TrafficVehicle url={URL.car1} z={-19.6} dir={-1} speed={6.5} startX={-20} height={1.5} />

      {/* Bank block (right) — building + ATM out front */}
      <Glb url={URL.building2} height={11} position={[30, 0, 4]} rotationY={-Math.PI / 2} />
      <Glb url={URL.atm} height={1.9} position={[24, 0, 8]} rotationY={-Math.PI / 2} />

      {/* Car showroom (left) — a glass box with a car inside */}
      <group position={[-30, 0, 6]}>
        <mesh position={[0, 2.4, 0]}>
          <boxGeometry args={[10, 4.8, 8]} />
          <meshPhysicalMaterial
            color="#9C6BE0"
            transmission={0.9}
            thickness={0.4}
            roughness={0.08}
            metalness={0}
            transparent
            opacity={0.5}
            side={THREE.DoubleSide}
          />
        </mesh>
        <Glb url={URL.car2} height={1.6} position={[0, 0, 0]} rotationY={Math.PI / 2} />
      </group>

      {/* Street lights + trees */}
      {STREET_PROPS.map((p) => (
        <Glb key={p.key} url={p.url} height={p.height} position={[p.x, 0, p.z]} />
      ))}
    </group>
  );
}
