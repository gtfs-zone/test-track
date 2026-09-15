/**
 * Round-trips a `FeedSelection` through the URL hash, so a link reproduces the
 * whole session and not just what was focused.
 *
 * Scheme: `scheduled=<url>&rt_vp=<url>&rt_tu=<url>&rt_al=<url>&cors=s,r`
 *
 * `cors` is a compact flag list rather than two booleans, because the common
 * cases are "both" and "neither" and `cors=s,r` reads better in an address bar
 * than `scheduled_cors=1&rt_cors=1`. "Neither" is written as `cors=none` rather
 * than by leaving the key out, because the key is always written and a missing
 * one therefore means something else.
 *
 * A missing `cors` means *unknown*, and both halves default to the proxy. Links
 * are written by other apps too — yard-master's "Open in visualizer" names four
 * URLs and no proxy setting — and the hosts feeds actually come from mostly send
 * no CORS headers, so "off" is the wrong guess far more often than "on". The
 * proxy costs a hop where it was not needed; guessing "off" costs the whole
 * load. `maybeProxy` already bypasses the proxy for local and private hosts, so
 * this does not break a link into a dev stack.
 *
 * `static=` is the old name of `scheduled=` and is still read, because links
 * are already in the wild. Only `scheduled=` is ever written, so an old link
 * rewrites itself in the address bar as soon as the feed loads, since the
 * session change that follows a load rewrites the whole feed param block.
 *
 * A file-backed scheduled source cannot be represented at all — there is no URL
 * to put in the link. Such a selection encodes with no `scheduled` key and
 * reports as non-reproducible, rather than silently producing a link that loads
 * half a session.
 */

import type { FeedSelection, RealtimeSource, ScheduledSource } from 'interlocking/modules/feed-selection';

// `static` stays in the list so a legacy-only hash still counts as naming a feed.
const PARAM_KEYS = ['scheduled', 'static', 'rt_vp', 'rt_tu', 'rt_al', 'cors'] as const;

/** True when a link can restore this selection in full. */
export function isReproducible(sel: FeedSelection | null): boolean {
  return sel?.scheduled?.kind === 'url';
}

/** The hash params describing a selection. Empty when there is nothing to say. */
export function selectionToParams(sel: FeedSelection | null): Record<string, string> {
  const params: Record<string, string> = {};
  if (!sel) return params;

  const corsFlags: string[] = [];

  if (sel.scheduled?.kind === 'url' && sel.scheduled.url) {
    params.scheduled = sel.scheduled.url;
    if (sel.scheduled.useCors) corsFlags.push('s');
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

  // Always written alongside a URL, never omitted: a missing key reads as
  // "proxy both" below. A selection with no URL at all still writes nothing,
  // so a file-backed session leaves no stray `cors=none` in the address bar.
  if (Object.keys(params).length > 0) {
    params.cors = corsFlags.length > 0 ? corsFlags.join(',') : 'none';
  }
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

  // Absent means unknown, so both halves proxy; `none` is the explicit "off".
  const corsParam = params.get('cors');
  const cors = new Set(
    corsParam === null ? ['s', 'r'] : corsParam.split(',').filter(Boolean),
  );

  const scheduledUrl = params.get('scheduled') ?? params.get('static');
  const scheduledSource: ScheduledSource | null = scheduledUrl
    ? {
        kind: 'url',
        url: scheduledUrl,
        useCors: cors.has('s'),
        label: labelForUrl(scheduledUrl),
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

  if (!scheduledSource && !realtime) return null;
  return { scheduled: scheduledSource, realtime };
}

/**
 * A selection restored from a link has no name of its own; use its host.
 *
 * `host`, not `hostname`: the port is part of the identity here. Two local
 * stacks on different ports are different feeds, and labelling both `localhost`
 * reads as if the port had been dropped somewhere.
 */
function labelForUrl(url: string): string {
  try {
    return new URL(url, location.href).host;
  } catch {
    return 'Linked feed';
  }
}
