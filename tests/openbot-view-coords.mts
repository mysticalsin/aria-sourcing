import assert from "node:assert/strict";
import { mapViewPoint } from "../scripts/lib/openbot-view-coords.mjs";

// Downscaled JPEG (1280×800) → full viewport (1400×900): center click
{
  const pt = mapViewPoint({
    clientX: 640,
    clientY: 400,
    rect: { left: 0, top: 0, width: 1280, height: 800 },
    bitmapW: 1280,
    bitmapH: 800,
    deviceW: 1400,
    deviceH: 900,
  });
  assert.ok(pt);
  assert.equal(pt.x, 700);
  assert.equal(pt.y, 450);
}

// Same sizes: identity mapping at bottom-right interior
{
  const pt = mapViewPoint({
    clientX: 1399,
    clientY: 899,
    rect: { left: 0, top: 0, width: 1400, height: 900 },
    bitmapW: 1400,
    bitmapH: 900,
    deviceW: 1400,
    deviceH: 900,
  });
  assert.ok(pt);
  assert.equal(pt.x, 1399);
  assert.equal(pt.y, 899);
}

// Letterboxed display: canvas element taller than bitmap aspect
{
  // scale=1, oy = 50 + (1000-800)/2 = 150
  const pt = mapViewPoint({
    clientX: 100 + 640,
    clientY: 150 + 400,
    rect: { left: 100, top: 50, width: 1280, height: 1000 },
    bitmapW: 1280,
    bitmapH: 800,
    deviceW: 1400,
    deviceH: 900,
  });
  assert.ok(pt);
  assert.equal(pt.x, 700);
  assert.equal(pt.y, 450);
}

// Outside letterbox → null
{
  const pt = mapViewPoint({
    clientX: 10,
    clientY: 10,
    rect: { left: 0, top: 0, width: 1280, height: 1000 },
    bitmapW: 1280,
    bitmapH: 800,
    deviceW: 1400,
    deviceH: 900,
  });
  assert.equal(pt, null);
}

console.log("openbot-view-coords: ok");
