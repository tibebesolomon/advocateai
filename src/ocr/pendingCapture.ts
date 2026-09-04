/**
 * Module-level store for passing URI arrays to the review screen.
 * File URIs contain characters (://, %, /) that corrupt when JSON-encoded
 * in URL query params. We store them here and read once on mount.
 */

export type PendingCapture = {
  uris: string[]
  mimeType?: string
}

let _pending: PendingCapture | null = null

export function queueCapture(capture: PendingCapture): void {
  _pending = capture
}

/** Returns the pending capture and clears it (one-shot read). */
export function takeCapture(): PendingCapture | null {
  const c = _pending
  _pending = null
  return c
}
