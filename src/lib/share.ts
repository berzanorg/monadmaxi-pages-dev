export const SHARE_FILENAME = "monad-maxi-pfp.jpg";

/** Web Share API is only exposed in secure contexts (HTTPS, localhost). */
export function isShareAvailable(): boolean {
  return typeof navigator.share === "function";
}

/** Call synchronously from a click handler; blob must already be ready. */
export function deliver(blob: Blob, onError?: (err: DOMException) => void): void {
  if (!isShareAvailable()) return;

  const file = new File([blob], SHARE_FILENAME, {
    type: blob.type || "image/jpeg",
  });

  navigator.share({ files: [file] }).catch((err: DOMException) => {
    if (err?.name === "AbortError") return;
    onError?.(err);
  });
}
