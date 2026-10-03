"use client";
// Open-plan office floor, furniture and Mantu branding using GLBs from
// public/office3d/assets/. All enclosing walls and the ceiling have been
// removed so the camera can orbit freely without a wall slicing across the
// middle of the view.

import { Text, useGLTF, useTexture } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { toWorld } from "../core/geometry";
import { DESK_POSITIONS } from "../core/navigation";

const MANTU_PURPLE = "#A0289C";
const FLOOR_OAK = "#B5803F";

// ---------------------------------------------------------------------------
// GLB preloads
// ---------------------------------------------------------------------------
useGLTF.preload("/office3d/assets/desk.glb");
useGLTF.preload("/office3d/assets/chairDesk.glb");
useGLTF.preload("/office3d/assets/loungeSofa.glb");
useGLTF.preload("/office3d/assets/tableCoffee.glb");
useGLTF.preload("/office3d/assets/loungeDesignChair.glb");
useGLTF.preload("/office3d/assets/bookcaseClosed.glb");
useGLTF.preload("/office3d/assets/pottedPlant.glb");
useGLTF.preload("/office3d/assets/plantSmall1.glb");
useGLTF.preload("/office3d/assets/kitchenCoffeeMachine.glb");
useGLTF.preload("/office3d/assets/kitchenFridgeSmall.glb");
useGLTF.preload("/office3d/assets/kitchenCabinet.glb");
useGLTF.preload("/office3d/assets/lampRoundFloor.glb");
useGLTF.preload("/office3d/assets/computerScreen.glb");
useTexture.preload("/brand/mantu-logo-source.jpg");

// ---------------------------------------------------------------------------
// Cloneable GLB instance
// ---------------------------------------------------------------------------
function GlbInstance({
  src,
  position,
  rotation,
  scale,
}: {
  src: string;
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: number | [number, number, number];
}) {
  const { scene } = useGLTF(src);
  const clone = useMemo(() => scene.clone(), [scene]);
  const scaleArr: [number, number, number] =
    typeof scale === "number" ? [scale, scale, scale] : scale ?? [1, 1, 1];
  return (
    <primitive
      object={clone}
      position={position}
      rotation={rotation ?? [0, 0, 0]}
      scale={scaleArr}
    />
  );
}

// ---------------------------------------------------------------------------
// Desk + chair unit at a canvas position
// ---------------------------------------------------------------------------
function DeskUnit({ cx, cy }: { cx: number; cy: number }) {
  const [wx, , wz] = toWorld(cx, cy);
  return (
    <group>
      <GlbInstance
        src="/office3d/assets/desk.glb"
        position={[wx, 0, wz]}
        rotation={[0, 0, 0]}
        scale={0.85}
      />
      <GlbInstance
        src="/office3d/assets/computerScreen.glb"
        position={[wx, 0, wz - 0.1]}
        scale={0.85}
      />
      <GlbInstance
        src="/office3d/assets/chairDesk.glb"
        position={[wx, 0, wz + 0.9]}
        rotation={[0, Math.PI, 0]}
        scale={0.85}
      />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Open floor — no walls, no ceiling, just a branded floor plane + grid.
// ---------------------------------------------------------------------------
function OpenFloor() {
  const [minX, , minZ] = toWorld(50, 50);
  const [maxX, , maxZ] = toWorld(1750, 1750);
  const w = maxX - minX;
  const d = maxZ - minZ;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0, cz]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color={FLOOR_OAK} roughness={0.72} metalness={0.04} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0.002, cz]}>
        <planeGeometry args={[w, d, 24, 24]} />
        <meshBasicMaterial color="#7a5022" wireframe transparent opacity={0.1} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Mantu brand sign — camera-facing billboard at the back edge of the floor.
// No solid wall behind it, so orbiting never hits a blocking slab.
// ---------------------------------------------------------------------------
/**
 * Yaw-only billboard. Keeps the sign upright and readable from every orbit
 * angle, without the flipping/mirroring that can happen with full lookAt.
 */
function FaceCameraY({ children, ...props }: React.ComponentProps<"group">) {
  const ref = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    if (!ref.current) return;
    const p = ref.current.position;
    ref.current.rotation.y = Math.atan2(camera.position.x - p.x, camera.position.z - p.z);
  });
  return (
    <group ref={ref} {...props}>
      {children}
    </group>
  );
}

function MantuSign() {
  const tex = useTexture("/brand/mantu-logo-source.jpg?v=2");
  tex.colorSpace = THREE.SRGBColorSpace;

  const [minX, , minZ] = toWorld(50, 50);
  const [maxX] = toWorld(1750, 50);
  const cx = (minX + maxX) / 2;
  const zSign = minZ + 1.4;

  const logoW = 9.0;
  const logoH = logoW / (617 / 324);
  const logoY = 3.4;

  return (
    <group position={[cx, 0, zSign]}>
      {/* Logo board — always faces the camera but stays vertical. */}
      <FaceCameraY position={[0, logoY, 0]}>
        {/* Purple frame */}
        <mesh renderOrder={-1}>
          <planeGeometry args={[logoW + 0.35, logoH + 0.35]} />
          <meshBasicMaterial color={MANTU_PURPLE} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        {/* White light-box backing */}
        <mesh position={[0, 0, 0.01]} renderOrder={-1}>
          <planeGeometry args={[logoW + 0.15, logoH + 0.15]} />
          <meshBasicMaterial color="#FFFFFF" side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        {/* Logo image, pushed slightly forward to avoid z-fighting. */}
        <mesh position={[0, 0, 0.02]}>
          <planeGeometry args={[logoW, logoH]} />
          <meshBasicMaterial
            map={tex}
            side={THREE.DoubleSide}
            toneMapped={false}
            transparent
            depthWrite={false}
          />
        </mesh>
      </FaceCameraY>

      {/* Attribution line below the sign, also camera-facing. */}
      <FaceCameraY position={[0, 0.7, 0]}>
        <Text
          font="/office3d/fonts/Manrope-SemiBold.ttf"
          fontSize={0.32}
          color="#1A0A2E"
          anchorX="center"
          anchorY="middle"
          letterSpacing={0.06}
        >
          ARIA SOURCING · BY MANTU
        </Text>
      </FaceCameraY>

      {/* Soft purple wash on the floor around the sign. */}
      <pointLight position={[0, 2.2, 3.5]} color={MANTU_PURPLE} intensity={1.2} distance={12} decay={2} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Colourful acoustic ceiling baffles
// ---------------------------------------------------------------------------
function CeilingBaffles() {
  const defs: { cx: number; cy: number; rot: number; color: string }[] = [
    { cx: 300, cy: 300, rot: 0, color: "#F97316" },
    { cx: 620, cy: 250, rot: Math.PI / 2, color: MANTU_PURPLE },
    { cx: 460, cy: 620, rot: 0, color: "#EF4444" },
    { cx: 780, cy: 520, rot: Math.PI / 2, color: "#EAB308" },
    { cx: 320, cy: 900, rot: 0, color: MANTU_PURPLE },
    { cx: 640, cy: 980, rot: Math.PI / 2, color: "#F97316" },
    { cx: 460, cy: 1280, rot: 0, color: "#EAB308" },
    { cx: 760, cy: 1360, rot: Math.PI / 2, color: "#EF4444" },
  ];
  return (
    <group>
      {defs.map(({ cx, cy, rot, color }, i) => {
        const [wx, , wz] = toWorld(cx, cy);
        return (
          <mesh key={i} position={[wx, 3.25, wz]} rotation={[0, rot, 0]} castShadow>
            <boxGeometry args={[2.4, 0.16, 0.62]} />
            <meshStandardMaterial color={color} roughness={0.75} metalness={0.04} />
          </mesh>
        );
      })}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Lounge zone
// ---------------------------------------------------------------------------
function LoungeZone() {
  const [lx, , lz] = toWorld(1380, 700);
  return (
    <group>
      <GlbInstance src="/office3d/assets/plantSmall1.glb" position={[lx - 1.8, 0, lz - 3]} scale={0.9} />
      <GlbInstance src="/office3d/assets/plantSmall1.glb" position={[lx - 1.8, 0, lz + 3]} scale={0.9} />
      <GlbInstance src="/office3d/assets/loungeSofa.glb" position={[lx + 0.4, 0, lz - 3]} rotation={[0, Math.PI / 2, 0]} scale={0.9} />
      <GlbInstance src="/office3d/assets/tableCoffee.glb" position={[lx + 0.4, 0, lz - 1.2]} scale={0.9} />
      <GlbInstance src="/office3d/assets/loungeDesignChair.glb" position={[lx - 0.8, 0, lz - 1.2]} rotation={[0, Math.PI / 2, 0]} scale={0.85} />
      <GlbInstance src="/office3d/assets/loungeDesignChair.glb" position={[lx + 1.6, 0, lz - 1.2]} rotation={[0, -Math.PI / 2, 0]} scale={0.85} />
      <GlbInstance src="/office3d/assets/lampRoundFloor.glb" position={[lx + 1.4, 0, lz - 3.5]} scale={0.85} />
      <GlbInstance src="/office3d/assets/lampRoundFloor.glb" position={[lx + 1.4, 0, lz + 1.5]} scale={0.85} />
      <GlbInstance src="/office3d/assets/pottedPlant.glb" position={[lx + 1.8, 0, lz - 4.2]} scale={0.8} />
      <GlbInstance src="/office3d/assets/plantSmall1.glb" position={[lx - 1.0, 0, lz - 4.0]} scale={0.9} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Kitchen zone
// ---------------------------------------------------------------------------
function KitchenZone() {
  const [kx, , kz] = toWorld(1380, 1500);
  return (
    <group>
      <GlbInstance src="/office3d/assets/kitchenCabinet.glb" position={[kx, 0, kz]} scale={0.9} />
      <GlbInstance src="/office3d/assets/kitchenCoffeeMachine.glb" position={[kx + 1.2, 0, kz]} scale={0.9} />
      <GlbInstance src="/office3d/assets/kitchenFridgeSmall.glb" position={[kx + 2.4, 0, kz]} scale={0.9} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Bookcase row
// ---------------------------------------------------------------------------
function BookcaseRow() {
  const [, , wallZ] = toWorld(90, 900);
  const [wx] = toWorld(150, 900);
  return (
    <group>
      {[0, 2.2, 4.4].map((offset) => (
        <GlbInstance
          key={offset}
          src="/office3d/assets/bookcaseClosed.glb"
          position={[wx, 0, wallZ - 3 + offset]}
          rotation={[0, Math.PI / 2, 0]}
          scale={0.88}
        />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Accent plants
// ---------------------------------------------------------------------------
function AccentPlants() {
  const plants: [number, number][] = [
    [120, 250], [120, 650], [120, 1050], [120, 1450],
    [1080, 250], [1080, 650], [1080, 1050], [1080, 1450],
  ];
  return (
    <>
      {plants.map(([cx, cy], i) => {
        const [wx, , wz] = toWorld(cx, cy);
        return (
          <GlbInstance
            key={i}
            src={i % 2 === 0 ? "/office3d/assets/pottedPlant.glb" : "/office3d/assets/plantSmall1.glb"}
            position={[wx, 0, wz]}
            scale={0.75}
          />
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Overhead strip lights
// ---------------------------------------------------------------------------
function OverheadLights() {
  const lightPositions: [number, number][] = [
    [300, 250], [700, 250], [300, 650], [700, 650],
    [300, 1050], [700, 1050], [300, 1450], [700, 1450],
    [1380, 500], [1380, 1000], [1380, 1400],
  ];
  return (
    <>
      {lightPositions.map(([cx, cy], i) => {
        const [wx, , wz] = toWorld(cx, cy);
        return (
          <group key={i} position={[wx, 3.08, wz]}>
            <mesh>
              <boxGeometry args={[0.9, 0.06, 0.18]} />
              <meshStandardMaterial color="#f9f5e8" emissive="#f9f5e8" emissiveIntensity={0.4} />
            </mesh>
            <pointLight intensity={0.4} distance={5} color="#fff8e8" position={[0, -0.1, 0]} castShadow={false} />
          </group>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Desk rows
// ---------------------------------------------------------------------------
function DeskArea() {
  return (
    <>
      {DESK_POSITIONS.map(({ x, y }, i) => (
        <DeskUnit key={i} cx={x} cy={y} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export function OfficeEnvironment() {
  return (
    <group>
      <OpenFloor />
      <MantuSign />
      <CeilingBaffles />
      <DeskArea />
      <LoungeZone />
      <KitchenZone />
      <BookcaseRow />
      <AccentPlants />
      <OverheadLights />
    </group>
  );
}
