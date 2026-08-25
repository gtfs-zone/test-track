/**
 * The last successfully loaded feed, remembered across sessions.
 *
 * Boot uses it for the load modal's "Continue with ..." card, so the record
 * carries both the selection to reload and the counts the card prints. Only
 * reproducible selections are stored: a file-backed scheduled source has no URL
 * to restore from, which is the same rule the share link uses.
 *
 * The record is versioned. Any other shape — an older version, hand-edited
 * JSON, a half-written value — reads as absent rather than being migrated.
 */

import type { FeedSelection } from './feed-selection';
import { isReproducible } from './feed-url';

const KEY = 'viz:last-feed';
const VERSION = 1;

export interface LastFeedSummary {
  label: string;
  routes: number;
  stops: number;
  trips: number;
}

export interface LastFeedRecord {
  v: number;
  selection: FeedSelection;
  summary: LastFeedSummary;
  savedAt: number;
}

/** The stored record, or null when there is none, it is unreadable, or stale. */
export function readLastFeed(): LastFeedRecord | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<LastFeedRecord>;
    if (parsed?.v !== VERSION) return null;
    const { selection, summary } = parsed;
    if (!selection || !summary) return null;
    // A file source cannot survive JSON, so a record holding one is corrupt.
    if (!isReproducible(selection)) return null;
    return { v: VERSION, selection, summary, savedAt: parsed.savedAt ?? 0 };
  } catch {
    return null;
  }
}

/** Store a selection and its counts. A non-reproducible selection is dropped. */
export function writeLastFeed(selection: FeedSelection, summary: LastFeedSummary): void {
  if (!isReproducible(selection)) {
    clearLastFeed();
    return;
  }
  const record: LastFeedRecord = { v: VERSION, selection, summary, savedAt: Date.now() };
  try {
    localStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    // Storage unavailable or full; the continue card is not worth failing a load.
  }
}

export function clearLastFeed(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to do: a record we cannot remove is also one we cannot read.
  }
}
