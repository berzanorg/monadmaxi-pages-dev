import type { Eyes, Pt } from "./lib/detect.ts";
import {
  buildRenderCache, renderNativeInto, renderPreviewInto,
  stageBackgroundUrl, type RenderCache,
} from "./lib/lasers.ts";
import { deliver, isShareAvailable } from "./lib/share.ts";

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing ${sel}`);
  return el;
};

const dropzone = $("#dropzone");
const loader   = $("#loader");
const result   = $("#result");
const errorEl  = $("#error");
const noticeEl = $("#notice");
const fileIn   = $<HTMLInputElement>("#file");
const stageEl = $<HTMLDivElement>("#stage");
const bgWrap  = $<HTMLDivElement>(".stage-bg-wrap");
const bgImg   = $<HTMLImageElement>("#stage-bg");
const canvasEl = $<HTMLCanvasElement>("#result-canvas");
const resultImg = $<HTMLImageElement>("#result-img");
const handleLeft  = $<HTMLDivElement>("#eye-left");
const handleRight = $<HTMLDivElement>("#eye-right");
const errorText = $("#error-text");
const status   = $("#status");
const btnReplace = $<HTMLButtonElement>("#replace");
const btnSave    = $<HTMLButtonElement>("#save");
const btnSaveLabel = $("#save-label");

btnSaveLabel.textContent = "Share";

const shareAvailable = isShareAvailable();
if (!shareAvailable) {
  btnSave.disabled = true;
  btnSave.title = "Share requires HTTPS — open monadmaxi.pages.dev";
}

function updateSaveEnabled(): void {
  btnSave.disabled = !shareAvailable || !editor?.saveBlob;
}

type State = "empty" | "loading" | "result" | "error";

function showState(s: State): void {
  dropzone.classList.toggle("hidden", s !== "empty");
  loader.classList.toggle("hidden", s !== "loading");
  result.classList.toggle("hidden", s !== "result");
  errorEl.classList.toggle("hidden", s !== "error");
  btnReplace.disabled = s !== "result";
  /* Save stays disabled until the JPEG blob is fully encoded — otherwise an
     early tap loses the iOS user-gesture and the share sheet won't open.
     bakeFullResolution() flips this back on once the blob is ready. */
  if (s !== "result") btnSave.disabled = true;
}

function setStatus(msg: string): void { status.textContent = msg; }

let noticeTimer: number | null = null;
function showNotice(msg: string, durationMs = 2600): void {
  noticeEl.textContent = msg;
  // Force reflow so reapplying .show retriggers transition.
  void noticeEl.offsetWidth;
  noticeEl.classList.add("show");
  if (noticeTimer !== null) clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => {
    noticeEl.classList.remove("show");
    noticeTimer = null;
  }, durationMs);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = src;
  });
}

/* JPEG is dramatically cheaper to encode than PNG for large opaque photos
   (10–50× faster), and the save canvas is always fully opaque, so JPEG is
   lossless-enough at q=0.92 for sharing/posting to social. */
function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
}

/* ---------- Editor ---------- */

interface Editor {
  cache: RenderCache;
  eyes: Eyes;
  saveCanvas: HTMLCanvasElement;
  /** Pre-warmed JPEG blob for synchronous share() inside a user gesture. */
  saveBlob: Blob | null;
  bakeToken: number;
}

let editor: Editor | null = null;

/** Fast preview render that paints into the DOM canvas at preview resolution.
 *  Resolution is the smaller of: (stage CSS px × DPR) or the source's S, capped
 *  at 1280 so we never burn cycles drawing pixels nobody can see. */
function previewMaxDim(): number {
  const rect = canvasEl.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const target = Math.ceil(Math.max(rect.width, rect.height) * dpr);
  return Math.max(256, Math.min(1280, target));
}
function renderPreview(): void {
  if (!editor) return;
  renderPreviewInto(canvasEl, editor.cache, editor.eyes, previewMaxDim());
}

let resultImgUrl: string | null = null;

function setResultImgFromBlob(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  resultImg.src = url;
  resultImg.classList.add("show");
  stageEl.classList.add("has-save-img");
  if (resultImgUrl) URL.revokeObjectURL(resultImgUrl);
  resultImgUrl = url;
}

/** Full-res native-aspect JPEG — Share + iOS long-press (no blur letterbox). */
async function bakeFullResolution(): Promise<void> {
  if (!editor) return;
  const myToken = ++editor.bakeToken;
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  if (!editor || editor.bakeToken !== myToken) return;

  renderNativeInto(editor.saveCanvas, editor.cache, editor.eyes);
  if (!editor || editor.bakeToken !== myToken) return;

  const blob = await canvasToBlob(editor.saveCanvas);
  if (!editor || editor.bakeToken !== myToken) return;

  editor.saveBlob = blob;
  if (blob) {
    updateSaveEnabled();
    setResultImgFromBlob(blob);
  }
}

function clientToImage(clientX: number, clientY: number): Pt {
  if (!editor) return { x: 0, y: 0 };
  const c = editor.cache;
  const rect = canvasEl.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };

  const scaleX = c.iw / rect.width;
  const scaleY = c.ih / rect.height;
  return {
    x: Math.max(0, Math.min(c.iw, (clientX - rect.left) * scaleX)),
    y: Math.max(0, Math.min(c.ih, (clientY - rect.top) * scaleY)),
  };
}

function positionHandles(): void {
  if (!editor) return;
  const c = editor.cache;
  const canvasRect = canvasEl.getBoundingClientRect();
  const stageRect  = stageEl.getBoundingClientRect();
  if (canvasRect.width === 0 || canvasRect.height === 0) return;
  // Canvas is centered in the (square) stage with object-fit-style sizing
  // via max-width/max-height; compute its offset within the stage.
  const offsetX = canvasRect.left - stageRect.left;
  const offsetY = canvasRect.top  - stageRect.top;

  const scaleX = canvasRect.width / c.iw;
  const scaleY = canvasRect.height / c.ih;
  const setPos = (el: HTMLElement, p: Pt) => {
    el.style.left = `${offsetX + p.x * scaleX}px`;
    el.style.top  = `${offsetY + p.y * scaleY}px`;
  };
  setPos(handleLeft,  editor.eyes.left);
  setPos(handleRight, editor.eyes.right);
}

interface DragState {
  pointerId: number;
  which: "left" | "right";
  offset: Pt;
  handle: HTMLElement;
  pending: boolean;
}
let drag: DragState | null = null;

function onPointerDown(ev: PointerEvent): void {
  if (!editor || drag) return;
  const target = ev.currentTarget as HTMLElement;
  const which = target.dataset.eye === "right" ? "right" : "left";
  const eyePt = editor.eyes[which];
  const ptr = clientToImage(ev.clientX, ev.clientY);
  drag = {
    pointerId: ev.pointerId,
    which,
    offset: { x: eyePt.x - ptr.x, y: eyePt.y - ptr.y },
    handle: target,
    pending: false,
  };
  // Mark blobs stale immediately so a quick tap-save doesn't ship a stale image.
  if (editor) {
    editor.saveBlob = null;
    editor.bakeToken++;
  }
  updateSaveEnabled();
  hideSaveLayer();
  target.classList.add("dragging");
  target.setPointerCapture(ev.pointerId);
  ev.preventDefault();
}

function onPointerMove(ev: PointerEvent): void {
  if (!drag || !editor || ev.pointerId !== drag.pointerId) return;
  const c = editor.cache;
  const ptr = clientToImage(ev.clientX, ev.clientY);
  const nextX = Math.max(0, Math.min(c.iw, ptr.x + drag.offset.x));
  const nextY = Math.max(0, Math.min(c.ih, ptr.y + drag.offset.y));
  editor.eyes[drag.which] = { x: nextX, y: nextY };
  editor.eyes.interocular = Math.hypot(
    editor.eyes.right.x - editor.eyes.left.x,
    editor.eyes.right.y - editor.eyes.left.y,
  );
  positionHandles();
  if (!drag.pending) {
    drag.pending = true;
    requestAnimationFrame(() => {
      if (drag) drag.pending = false;
      renderPreview();
    });
  }
  ev.preventDefault();
}

function onPointerEnd(ev: PointerEvent): void {
  if (!drag || ev.pointerId !== drag.pointerId) return;
  drag.handle.classList.remove("dragging");
  try { drag.handle.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
  drag = null;
  // Settle → full-res bake + blob warm-up.
  void bakeFullResolution();
}

for (const h of [handleLeft, handleRight]) {
  h.addEventListener("pointerdown",   onPointerDown);
  h.addEventListener("pointermove",   onPointerMove);
  h.addEventListener("pointerup",     onPointerEnd);
  h.addEventListener("pointercancel", onPointerEnd);
  h.addEventListener("contextmenu", (ev) => ev.preventDefault());
  h.addEventListener("dragstart",   (ev) => ev.preventDefault());
}

function hideSaveLayer(): void {
  resultImg.classList.remove("show");
  stageEl.classList.remove("has-save-img");
}

window.addEventListener("resize", positionHandles);

/* Lazy-load ~145KB MediaPipe chunk + WASM until a photo is picked (or idle). */
let detectModule = import("./lib/detect.ts");
function loadDetect() {
  return detectModule;
}
const preloadDetect = (): void => { void detectModule; };
if ("requestIdleCallback" in window) {
  requestIdleCallback(preloadDetect, { timeout: 4000 });
} else {
  setTimeout(preloadDetect, 1500);
}

/* ---------- Pipeline ---------- */

/** Minimum time the scanning loader stays on screen so the animation has
 *  time to read, even when detection itself is faster than the eye can catch. */
const MIN_LOADER_MS = 1000;

function waitAtLeast<T>(p: Promise<T>, startedAt: number, minMs: number): Promise<T> {
  return p.then((v) =>
    new Promise<T>((resolve) => {
      const remaining = Math.max(0, minMs - (performance.now() - startedAt));
      if (remaining === 0) resolve(v);
      else setTimeout(() => resolve(v), remaining);
    }),
  );
}

async function processFile(file: File): Promise<void> {
  showState("loading");
  setStatus("");
  // Drop any previous result image so a stale blob doesn't flash on swap.
  hideSaveLayer();
  resultImg.removeAttribute("src");
  if (resultImgUrl) URL.revokeObjectURL(resultImgUrl);
  resultImgUrl = null;
  const startedAt = performance.now();
  const photoURL = URL.createObjectURL(file);
  let img: HTMLImageElement;
  try {
    img = await loadImage(photoURL);
    await img.decode();
  } catch {
    URL.revokeObjectURL(photoURL);
    await waitAtLeast(Promise.resolve(), startedAt, MIN_LOADER_MS);
    showError("Couldn't read that image. Try a different photo.");
    return;
  }

  setStatus("Finding eyes…");
  let detected: Eyes | null;
  let detect: Awaited<ReturnType<typeof loadDetect>>;
  try {
    detect = await loadDetect();
    detected = await detect.detectEyes(img);
  } catch (err) {
    console.error(err);
    URL.revokeObjectURL(photoURL);
    await waitAtLeast(Promise.resolve(), startedAt, MIN_LOADER_MS);
    showError("Face detector failed to load. Check your connection and reload.");
    return;
  }

  const eyes = detected ?? detect.defaultEyes(img);
  const cache = buildRenderCache(img);
  const saveCanvas = document.createElement("canvas");
  editor = { cache, eyes, saveCanvas, saveBlob: null, bakeToken: 0 };

  if (cache.iw !== cache.ih) {
    bgImg.src = stageBackgroundUrl(cache);
    bgWrap.classList.remove("hidden");
  } else {
    bgImg.removeAttribute("src");
    bgWrap.classList.add("hidden");
  }

  setStatus("Adjust laser according to your eyes.");
  await waitAtLeast(Promise.resolve(), startedAt, MIN_LOADER_MS);
  showState("result");
  if (!detected) showNotice("Local AI couldn’t detect eyes");
  // Render AFTER the result section is visible so the canvas has its real
  // bounding rect; otherwise previewMaxDim() reads 0 and we end up at the
  // 256-px minimum (visibly blurry on high-DPR screens).
  requestAnimationFrame(() => {
    renderPreview();
    positionHandles();
    void bakeFullResolution();
  });
  URL.revokeObjectURL(photoURL);
}

function showError(msg: string): void {
  setStatus("");
  errorText.textContent = msg;
  showState("error");
}

function pickPhoto(): void {
  fileIn.value = "";
  fileIn.click();
}

fileIn.addEventListener("change", () => {
  const f = fileIn.files?.[0];
  if (f) void processFile(f);
});

window.addEventListener("paste", (ev) => {
  const items = ev.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) {
        ev.preventDefault();
        void processFile(file);
        return;
      }
    }
  }
});

btnReplace.addEventListener("click", pickPhoto);

btnSave.addEventListener("click", () => {
  if (!editor?.saveBlob || !shareAvailable) return;
  deliver(editor.saveBlob, () => {
    showNotice("Couldn't open share sheet — long-press the image to save.");
  });
});

showState("empty");
