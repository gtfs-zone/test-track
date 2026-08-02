/**
 * Feed selection model.
 *
 * A session needs BOTH a static GTFS source and at least one GTFS-RT endpoint
 * before it can load. That contract lives here: every load path (examples,
 * atlas, manual, and later the URL hash) produces a `FeedSelection`, and
 * `isComplete` is the single gate.
 *
 * `useCors` is per-source rather than global, because a static feed from an
 * agency CDN and an RT feed from rt.gtfs.zone have genuinely different proxy
 * needs.
 */

const CORS_PROXY = 'https://cors.gtfs.zone/';

/** True when a URL is already routed through the CORS proxy. */
export function isProxied(url: string): boolean {
  return url.startsWith(CORS_PROXY);
}

/**
 * A fetch that rejects with a `TypeError` is what the browser gives for *any*
 * CORS refusal, and it carries no detail — "NetworkError when attempting to
 * fetch resource" and nothing more. When the URL was not proxied, CORS is the
 * likely cause, so say so rather than passing the bare message through
 * (Plan 06 Phase 8).
 */
export function describeNetworkError(url: string, err: unknown): string {
  const base = err instanceof Error ? err.message : String(err);
  if (err instanceof TypeError && !isProxied(url)) {
    return `${base} — this may be CORS; try enabling the proxy for this source.`;
  }
  return base;
}

/**
 * A non-2xx from the proxy carries a plain-text explanation in its body — e.g.
 * `The origin "…" was not whitelisted by the operator of this proxy.` — that is
 * otherwise thrown away. Surface it instead of a bare status line.
 */
export function describeHttpError(
  url: string,
  status: number,
  statusText: string,
  body: string,
): string {
  const head = `HTTP ${status} ${statusText}`.trim();
  const trimmed = body.trim();
  if (isProxied(url) && trimmed) return `${head} — proxy said: ${trimmed.slice(0, 300)}`;
  return head;
}

export type StaticSource =
  | { kind: 'url'; url: string; useCors: boolean; label: string }
  | { kind: 'file'; file: File; label: string };

export interface RealtimeSource {
  vehiclesUrl?: string;
  tripUpdatesUrl?: string;
  alertsUrl?: string;
  useCors: boolean;
  label: string;
}

export interface FeedSelection {
  static: StaticSource | null;
  realtime: RealtimeSource | null;
}

export type RealtimeEndpointName = 'vehicles' | 'tripUpdates' | 'alerts';

export const REALTIME_ENDPOINTS: readonly RealtimeEndpointName[] = [
  'vehicles',
  'tripUpdates',
  'alerts',
];

export const REALTIME_ENDPOINT_LABELS: Record<RealtimeEndpointName, string> = {
  vehicles: 'Vehicle Positions',
  tripUpdates: 'Trip Updates',
  alerts: 'Service Alerts',
};

/** Route a URL through the CORS proxy, unless it is already proxied. */
export function maybeProxy(url: string, useCors: boolean): string {
  if (!useCors || !url || url.startsWith(CORS_PROXY)) return url;
  return CORS_PROXY + url;
}

/** True when the RT source names at least one endpoint. */
export function hasAnyRealtimeUrl(rt: RealtimeSource | null): boolean {
  if (!rt) return false;
  return Boolean(rt.vehiclesUrl || rt.tripUpdatesUrl || rt.alertsUrl);
}

/** Both halves chosen, and the RT half actually points somewhere. */
export function isComplete(sel: FeedSelection): boolean {
  if (!sel.static) return false;
  if (sel.static.kind === 'url' && !sel.static.url) return false;
  return hasAnyRealtimeUrl(sel.realtime);
}

/** Human-readable reason a selection is not yet loadable; '' when complete. */
export function describeMissing(sel: FeedSelection): string {
  const needStatic = !sel.static || (sel.static.kind === 'url' && !sel.static.url);
  const needRt = !hasAnyRealtimeUrl(sel.realtime);
  if (needStatic && needRt) return 'Choose a static feed and a realtime feed';
  if (needStatic) return 'Choose a static feed';
  if (needRt) return 'Choose a realtime feed';
  return '';
}

/** The static URL to actually fetch, proxied if the source asks for it. */
export function resolvedStaticUrl(src: StaticSource): string {
  return src.kind === 'url' ? maybeProxy(src.url, src.useCors) : '';
}

/** The three RT URLs to actually fetch, proxied per the source's setting. */
export function resolvedRealtimeUrls(
  rt: RealtimeSource,
): Record<RealtimeEndpointName, string> {
  return {
    vehicles: maybeProxy(rt.vehiclesUrl ?? '', rt.useCors),
    tripUpdates: maybeProxy(rt.tripUpdatesUrl ?? '', rt.useCors),
    alerts: maybeProxy(rt.alertsUrl ?? '', rt.useCors),
  };
}

/** A short description of the whole selection, for toasts and titles. */
export function describeSelection(sel: FeedSelection): string {
  const parts: string[] = [];
  if (sel.static) parts.push(sel.static.label);
  if (sel.realtime && sel.realtime.label !== sel.static?.label) {
    parts.push(sel.realtime.label);
  }
  return parts.join(' + ') || 'feeds';
}

export function emptySelection(): FeedSelection {
  return { static: null, realtime: null };
}
