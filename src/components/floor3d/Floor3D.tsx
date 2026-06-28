"use client";

import * as React from "react";
import { Suspense } from "react";
import { Box } from "lucide-react";
import RetroOfficeScene from "./retro/RetroOfficeScene";
import type { OfficeAgent } from "./types";

/* ============================================================================
   Client wrapper for the 3D floor. Sizes the canvas container and provides a
   Suspense boundary while GLBs / fonts stream in. The floor page imports this
   via next/dynamic({ ssr: false }).

   Feature-detects WebGL before mounting the scene: on devices/browsers without
   a usable WebGL context the three.js renderer throws on init, which would
   crash the floor page. Instead we render a graceful fallback that points the
   operator at the 2D grid view.
   ========================================================================== */

interface Floor3DProps {
  agents: OfficeAgent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** True when a WebGL rendering context can actually be created. */
function detectWebGL(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.WebGLRenderingContext === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    return gl != null;
  } catch {
    return false;
  }
}

function WebGLFallback() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <Box className="h-8 w-8 text-muted" aria-hidden />
      <p className="text-sm font-semibold text-ink">3D floor unavailable</p>
      <p className="max-w-sm text-sm text-muted">
        Your browser or device doesn&apos;t support WebGL, so the 3D office
        can&apos;t render. Switch to the <strong>2D grid</strong> view above to
        see your fleet.
      </p>
    </div>
  );
}

export default function Floor3D({ agents, selectedId, onSelect }: Floor3DProps) {
  // null = not yet checked (avoids mounting the scene during the first paint
  // before we know WebGL is available).
  const [webglOk, setWebglOk] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    setWebglOk(detectWebGL());
  }, []);

  return (
    <div className="relative h-[70vh] w-full overflow-hidden rounded-2xl border border-line bg-canvas">
      {webglOk === false ? (
        <WebGLFallback />
      ) : webglOk === null ? (
        <div className="flex h-full items-center justify-center text-sm text-muted">
          Loading 3D floor…
        </div>
      ) : (
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-sm text-muted">
              Loading 3D floor…
            </div>
          }
        >
          <RetroOfficeScene
            agents={agents}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        </Suspense>
      )}
    </div>
  );
}
