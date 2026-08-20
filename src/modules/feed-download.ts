/* @vendored-from coloring-book:src/modules/feed-download.ts
   @sha 2505f6c
   @status verbatim */
/**
 * Fetching a feed archive with real byte progress.
 *
 * Split out of test-track's private downloader so both apps share one
 * implementation: the progress line, the error wording (borrowed from
 * `feed-selection.ts` so the CORS-proxy hints come along), and the cancel
 * semantics.
 *
 * Cancel aborts the *fetch* only. Once the bytes are in hand the caller parses
 * them to completion, so no app can end up with a half-ingested feed.
 *
 * Progress callbacks are coalesced: a fetch chunk is 16-64 KB, so an unthrottled
 * callback turns a large feed into thousands of main-thread DOM writes that
 * compete with draining the body.
 *
 * Deliberately DOM-free: it is vendored into test-track and has to stay
 * testable outside a browser document.
 */

import { describeHttpError, describeNetworkError } from './feed-selection';

/**
 * Shortest gap between two `onProgress` calls. Kept local rather than in the
 * app's CONFIG because this file is vendored into test-track and stays
 * dependency-free.
 */
const PROGRESS_INTERVAL_MS = 100;

/** Thrown when the caller's `AbortSignal` fires before the body is fully read. */
export class LoadCancelledError extends Error {
  constructor(message = 'Load cancelled') {
    super(message);
    this.name = 'LoadCancelledError';
  }
}

export interface DownloadOptions {
  /** `total` is null when the server sends no `Content-Length`. */
  onProgress?: (loaded: number, total: number | null) => void;
  signal?: AbortSignal;
}

/** True for the `DOMException` both `fetch` and `reader.read()` throw on abort. */
function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/**
 * Fetch a zip, reporting real byte progress when the server tells us the size.
 * Falls back to a single unmeasured read when the body is not streamable.
 */
export async function downloadWithProgress(
  url: string,
  options: DownloadOptions = {}
): Promise<Blob> {
  const { onProgress, signal } = options;

  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (err) {
    if (isAbort(err)) {
      throw new LoadCancelledError();
    }
    throw new Error(describeNetworkError(url, err));
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      describeHttpError(url, response.status, response.statusText, body)
    );
  }

  const lengthHeader = response.headers.get('Content-Length');
  const total = lengthHeader ? Number(lengthHeader) : null;

  if (!response.body || !onProgress) {
    onProgress?.(0, total);
    try {
      return await response.blob();
    } catch (err) {
      if (isAbort(err)) {
        throw new LoadCancelledError();
      }
      throw err;
    }
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  let lastEmit = 0;
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (err) {
      if (isAbort(err)) {
        throw new LoadCancelledError();
      }
      throw err;
    }
    if (chunk.done) {
      break;
    }
    chunks.push(chunk.value);
    loaded += chunk.value.length;
    const now = performance.now();
    if (now - lastEmit >= PROGRESS_INTERVAL_MS) {
      lastEmit = now;
      onProgress(loaded, total);
    }
  }

  // The throttle can swallow the last chunk, so land the bar on the real count.
  onProgress(loaded, total);
  // Blob assembly, not a merged Uint8Array: every caller wants a Blob, and this
  // keeps the whole feed from being copied twice through the JS heap. The cast
  // covers lib.dom typing chunks as possibly SharedArrayBuffer-backed, which a
  // fetch body never is.
  return new Blob(chunks as BlobPart[]);
}

/**
 * Percent of a download, or null when the size is unknown.
 *
 * A gzipped transfer reports the compressed length in `Content-Length` while
 * the reader yields decompressed bytes, so `loaded` can run past `total`;
 * clamping here keeps a `<progress>` element from overflowing.
 */
export function downloadPercent(
  loaded: number,
  total: number | null
): number | null {
  if (!total || total <= 0) {
    return null;
  }
  return Math.min(100, Math.round((loaded / total) * 100));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
