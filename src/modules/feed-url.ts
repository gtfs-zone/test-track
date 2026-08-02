/**
 * Round-trips a `FeedSelection` through the URL hash, so a link reproduces the
 * whole session and not just what was focused.
 *
 * Scheme: `static=<url>&rt_vp=<url>&rt_tu=<url>&rt_al=<url>&cors=s,r`
 *
 * `cors` is a compact flag list rather than two booleans, because the common
 * cases are "both" and "neither" and `cors=s,r` reads better in an address bar
 * than `static_cors=1&rt_cors=1`.
 *
 * A file-backed static source cannot be represented at all — there is no URL to
 * put in the link. Such a selection encodes with no `static` key and reports as
 * non-reproducible, rather than silently producing a link that loads half a
 * session.
 */

import type { FeedSelection, RealtimeSource, StaticSource } from './feed-selection';

const PARAM_KEYS = ['static', 'rt_vp', 'rt_tu', 'rt_al', 'cors'] as const;

/** True when a link can restore this selection in full. */
export function isReproducible(sel: FeedSelection | null): boolean {
  return sel?.static?.kind === 'url';
}

/** The hash params describing a selection. Empty when there is nothing to say. */
export function selectionToParams(sel: FeedSelection | null): Record<string, string> {
  const params: Record<string, string> = {};
  if (!sel) return params;

  const corsFlags: string[] = [];

  if (sel.static?.kind === 'url' && sel.static.url) {
    params.static = sel.static.url;
    if (sel.static.useCors) corsFlags.push('s');
  }

  const rt = sel.realtime;
  if (rt) {
    if (rt.vehiclesUrl) params.rt_vp = rt.vehiclesUrl;
    if (rt.tripUpdatesUrl) params.rt_tu = rt.tripUpdatesUrl;
    if (rt.alertsUrl) params.rt_al = rt.alertsUrl;
    if (rt.useCors && (rt.vehiclesUrl || rt.tripUpdatesUrl || rt.alertsUrl)) {
      corsFlags.push('r');
    }
  }

  if (corsFlags.length > 0) params.cors = corsFlags.join(',');
  return params;
}

/**
 * Rebuild a selection from a hash string (no leading `#`). Returns null when
 * the hash names no feeds at all, and a partial selection when it names some —
 * `isComplete` remains the single gate on whether it can be loaded.
 */
export function paramsToSelection(hash: string): FeedSelection | null {
  const params = new URLSearchParams(hash);
  if (!PARAM_KEYS.some(k => params.has(k))) return null;

  const cors = new Set((params.get('cors') ?? '').split(',').filter(Boolean));

  const staticUrl = params.get('static');
  const staticSource: StaticSource | null = staticUrl
    ? {
        kind: 'url',
        url: staticUrl,
        useCors: cors.has('s'),
        label: labelForUrl(staticUrl),
      }
    : null;

  const vehiclesUrl = params.get('rt_vp') ?? undefined;
  const tripUpdatesUrl = params.get('rt_tu') ?? undefined;
  const alertsUrl = params.get('rt_al') ?? undefined;

  const realtime: RealtimeSource | null =
    vehiclesUrl || tripUpdatesUrl || alertsUrl
      ? {
          vehiclesUrl,
          tripUpdatesUrl,
          alertsUrl,
          useCors: cors.has('r'),
          label: labelForUrl(vehiclesUrl ?? tripUpdatesUrl ?? alertsUrl ?? ''),
        }
      : null;

  if (!staticSource && !realtime) return null;
  return { static: staticSource, realtime };
}

/** A selection restored from a link has no name of its own; use its host. */
function labelForUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'Linked feed';
  }
}
