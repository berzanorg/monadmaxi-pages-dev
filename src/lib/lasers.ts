import type { Eyes, Pt } from "./detect.ts";

function unit(v: Pt): Pt {
  const m = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / m, y: v.y / m };
}

/** Cached source photo — build once per upload. */
export interface RenderCache {
  base: HTMLCanvasElement;
  iw: number;
  ih: number;
}

export function buildRenderCache(img: HTMLImageElement): RenderCache {
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const base = document.createElement("canvas");
  base.width = iw;
  base.height = ih;
  base.getContext("2d")!.drawImage(img, 0, 0);
  return { base, iw, ih };
}

/** Tiny JPEG data URL for the stage blur layer (UI only, not exported). */
export function stageBackgroundUrl(cache: RenderCache): string {
  const max = 160;
  const scale = max / Math.max(cache.iw, cache.ih);
  const tw = Math.max(1, Math.round(cache.iw * scale));
  const th = Math.max(1, Math.round(cache.ih * scale));
  const tiny = document.createElement("canvas");
  tiny.width = tw;
  tiny.height = th;
  tiny.getContext("2d")!.drawImage(cache.base, 0, 0, tw, th);
  return tiny.toDataURL("image/jpeg", 0.75);
}

/** Full-resolution render — native aspect with lasers, no blurred square BG. */
export function renderFromCache(cache: RenderCache, eyes: Eyes): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = cache.iw;
  canvas.height = cache.ih;
  renderNativeInto(canvas, cache, eyes);
  return canvas;
}

/** Reuses an existing canvas for full-res export (avoids alloc on every drag settle). */
export function renderNativeInto(
  target: HTMLCanvasElement,
  cache: RenderCache,
  eyes: Eyes,
): void {
  if (target.width !== cache.iw) target.width = cache.iw;
  if (target.height !== cache.ih) target.height = cache.ih;
  const ctx = target.getContext("2d")!;
  ctx.drawImage(cache.base, 0, 0);
  const axis = unit({
    x: eyes.right.x - eyes.left.x,
    y: eyes.right.y - eyes.left.y,
  });
  drawEyeBlast(ctx, eyes.left, eyes.interocular, axis);
  drawEyeBlast(ctx, eyes.right, eyes.interocular, axis);
}

/** Preview at native aspect (lasers only — blur BG is a separate DOM layer). */
export function renderPreviewInto(
  target: HTMLCanvasElement,
  cache: RenderCache,
  eyes: Eyes,
  maxDim = 1280,
): void {
  const factor = Math.min(1, maxDim / Math.max(cache.iw, cache.ih));
  const tw = Math.max(1, Math.round(cache.iw * factor));
  const th = Math.max(1, Math.round(cache.ih * factor));
  if (target.width !== tw) target.width = tw;
  if (target.height !== th) target.height = th;

  const ctx = target.getContext("2d")!;
  ctx.clearRect(0, 0, tw, th);
  ctx.drawImage(cache.base, 0, 0, tw, th);

  const axis = unit({
    x: eyes.right.x - eyes.left.x,
    y: eyes.right.y - eyes.left.y,
  });
  const sI = eyes.interocular * factor;
  drawEyeBlast(ctx, { x: eyes.left.x * factor, y: eyes.left.y * factor }, sI, axis);
  drawEyeBlast(ctx, { x: eyes.right.x * factor, y: eyes.right.y * factor }, sI, axis);
}

function drawEyeBlast(
  ctx: CanvasRenderingContext2D,
  p: Pt,
  eye: number,
  axis: Pt,
): void {
  const angle = Math.atan2(axis.y, axis.x);

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  const rOuter = eye * 2.2;
  const outer = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rOuter);
  outer.addColorStop(0.00, "rgba(221, 215, 254, 0.42)");
  outer.addColorStop(0.15, "rgba(180, 150, 255, 0.42)");
  outer.addColorStop(0.38, "rgba(110,  84, 255, 0.46)");
  outer.addColorStop(0.62, "rgba(110,  84, 255, 0.34)");
  outer.addColorStop(0.85, "rgba(110,  84, 255, 0.14)");
  outer.addColorStop(1.00, "rgba(110,  84, 255, 0)");
  ctx.fillStyle = outer;
  ctx.beginPath();
  ctx.arc(p.x, p.y, rOuter, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.translate(p.x, p.y);
  ctx.rotate(angle);
  drawSoftStreak(ctx, eye * 2.6, eye * 0.085, true);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const rDot = eye * 0.32;
  const dot = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rDot);
  dot.addColorStop(0.00, "rgba(221, 215, 254, 1.00)");
  dot.addColorStop(0.28, "rgba(221, 215, 254, 0.75)");
  dot.addColorStop(0.58, "rgba(170, 140, 255, 0.38)");
  dot.addColorStop(0.85, "rgba(110,  84, 255, 0.14)");
  dot.addColorStop(1.00, "rgba(110,  84, 255, 0)");
  ctx.fillStyle = dot;
  ctx.beginPath();
  ctx.arc(p.x, p.y, rDot, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawSoftStreak(
  ctx: CanvasRenderingContext2D,
  halfLen: number,
  halfThick: number,
  horizontal: boolean,
): void {
  ctx.save();
  if (horizontal) ctx.scale(halfLen / halfThick, 1);
  else            ctx.scale(1, halfLen / halfThick);

  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, halfThick);
  grad.addColorStop(0.00, "rgba(221, 215, 254, 0.85)");
  grad.addColorStop(0.22, "rgba(210, 200, 254, 0.55)");
  grad.addColorStop(0.52, "rgba(140, 108, 255, 0.32)");
  grad.addColorStop(0.82, "rgba(110,  84, 255, 0.14)");
  grad.addColorStop(1.00, "rgba(110,  84, 255, 0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, halfThick, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
