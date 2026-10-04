/**
 * Map a click on the live-view canvas/img to CDP CSS viewport coordinates.
 *
 * Screencast JPEGs are often downscaled (OPENBOT_STREAM_MAX_*) while
 * Input.dispatchMouseEvent expects full deviceWidth/deviceHeight DIPs.
 * Mapping in bitmap space without scaling causes systematic click offset.
 *
 * @param {{
 *   clientX: number,
 *   clientY: number,
 *   rect: { left: number, top: number, width: number, height: number },
 *   bitmapW: number,
 *   bitmapH: number,
 *   deviceW: number,
 *   deviceH: number,
 * }} args
 * @returns {{ x: number, y: number } | null}
 */
export function mapViewPoint({
  clientX,
  clientY,
  rect,
  bitmapW,
  bitmapH,
  deviceW,
  deviceH,
}) {
  const bw = Math.max(1, Number(bitmapW) || Number(deviceW) || 1);
  const bh = Math.max(1, Number(bitmapH) || Number(deviceH) || 1);
  const dw = Math.max(1, Number(deviceW) || bw);
  const dh = Math.max(1, Number(deviceH) || bh);
  if (!rect || !rect.width || !rect.height) return null;

  // object-fit: contain letterbox inside the element box
  const scale = Math.min(rect.width / bw, rect.height / bh);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const drawW = bw * scale;
  const drawH = bh * scale;
  const ox = rect.left + (rect.width - drawW) / 2;
  const oy = rect.top + (rect.height - drawH) / 2;
  const imgX = (clientX - ox) / scale;
  const imgY = (clientY - oy) / scale;
  if (imgX < 0 || imgY < 0 || imgX > bw || imgY > bh) return null;

  const x = Math.round((imgX / bw) * dw);
  const y = Math.round((imgY / bh) * dh);
  return {
    x: Math.min(Math.max(0, x), dw - 1),
    y: Math.min(Math.max(0, y), dh - 1),
  };
}
