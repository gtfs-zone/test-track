/* @vendored-from coloring-book:src/modules/feed-url-resolve.ts
   @sha 27587a0
   @status verbatim */
/**
 * Turning what someone typed into a URL that can actually be fetched.
 *
 * Three jobs, deliberately kept apart from `feed-selection.ts` so the proxy
 * rules there stay readable:
 *
 * 1. `RT_BASE` — a feed URL may be stored as a bare path (`/amtrak/
 *    vehicle_positions.pb`). That form is environment-agnostic, so a shared link
 *    works for whoever opens it. Resolution happens at fetch time only; the
 *    selection and the hash keep the path.
 * 2. `normalizeFeedUrl` — accept the shapes people actually type.
 * 3. `isLocalUrl` — the CORS proxy lives on the public internet and cannot reach
 *    the user's own machine, so a local URL must never be routed through it.
 */

import { CONFIG } from '../config';

/**
 * Where a path-only realtime URL points.
 *
 * Each app decides this in its own `CONFIG`, because they do not agree: an app
 * with a local feed server wants localhost in dev, one without wants the
 * deployed server always. Re-exported here so every consumer still reads it
 * from one place.
 */
export const RT_BASE: string = CONFIG.RT_BASE;

/**
 * Split `…/outer.zip#inner.zip` into the URL to fetch and the entries to
 * descend into once it is unzipped.
 *
 * Some agencies publish one archive holding several GTFS datasets — SEPTA's
 * `gtfs_public.zip` contains `google_bus.zip` and `google_rail.zip` — so
 * naming the outer archive alone is not enough to say which feed you mean.
 * The fragment is the natural place for that: it is the part of a URL a server
 * never sees, and it round-trips through the share hash unharmed (a `#` inside
 * a param value is encoded as `%23`).
 *
 * Every `#` is a level, so nesting falls out for free — though one level is
 * what anyone actually publishes.
 */
export function splitInnerZipPath(url: string): {
  url: string;
  innerPaths: string[];
} {
  const [base, ...innerPaths] = url.split('#');
  return { url: base, innerPaths: innerPaths.filter(Boolean) };
}

/** True for a stored URL that is a bare path rather than an absolute URL. */
export function isPathOnly(url: string): boolean {
  return url.startsWith('/') && !url.startsWith('//');
}

/** Resolve a path-only realtime URL against `RT_BASE`; leave anything else alone. */
export function resolveRealtimeUrl(url: string): string {
  return isPathOnly(url) ? RT_BASE + url : url;
}

/**
 * Hosts that only exist on the user's own machine or LAN. Anything matching is
 * unreachable from the CORS proxy, and is served over plain http.
 */
function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) {
    return true;
  }
  if (h === '::1' || h === '0.0.0.0') {
    return true;
  }
  if (/^127\./.test(h)) {
    return true;
  }
  if (/^10\./.test(h)) {
    return true;
  }
  if (/^192\.168\./.test(h)) {
    return true;
  }
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) {
    return true;
  }
  return false;
}

/**
 * True when this URL names something the CORS proxy cannot reach: a bare path,
 * which is same-origin and needs no proxy by definition, or an explicit
 * local/private host.
 *
 * Callers must resolve a realtime path against `RT_BASE` *before* asking — in
 * the built site `/amtrak/…` resolves to rt.gtfs.zone, which is emphatically not
 * local and does need the proxy.
 */
export function isLocalUrl(url: string): boolean {
  if (!url) {
    return false;
  }
  if (isPathOnly(url)) {
    return true;
  }
  try {
    return isLocalHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Schemes a feed URL may legitimately use. */
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * `localhost:8000/x` is not a scheme-less URL to the URL parser — it reads
 * `localhost:` as the scheme and the rest as an opaque path, so it parses
 * "successfully" and then fails to fetch with nothing useful to say. Detect the
 * host:port shape and treat it as the authority it obviously is.
 */
function looksLikeHostPort(raw: string): boolean {
  return /^[a-z0-9.-]+:\d{1,5}(\/|$)/i.test(raw);
}

/**
 * What someone typed, turned into something fetchable. Bare paths pass through
 * untouched (they are resolved later against `RT_BASE`); everything else ends up
 * with an explicit scheme — http for local hosts, which do not serve https, and
 * https for everything else.
 */
export function normalizeFeedUrl(raw: string): string {
  const url = raw.trim();
  if (!url) {
    return '';
  }
  if (isPathOnly(url)) {
    return url;
  }
  if (url.startsWith('//')) {
    return `https:${url}`;
  }
  if (SCHEME_RE.test(url) && !looksLikeHostPort(url)) {
    return url;
  }

  const host = url.split(/[/?#]/, 1)[0].split(':')[0];
  return `${isLocalHost(host) ? 'http' : 'https'}://${url}`;
}

/**
 * Why this URL cannot be used, or null when it is fine. Checked before any fetch
 * so a typo is reported against the field instead of arriving as an opaque
 * network error a poll cycle later.
 *
 * `useCors` is the source's proxy setting, and it decides the mixed-content rule
 * below: through the proxy the browser only ever requests
 * `https://cors.gtfs.zone/…` and the plain-http hop happens server-side, so an
 * http feed is perfectly usable. Several curated examples are http for exactly
 * that reason.
 */
export function validateFeedUrl(raw: string, useCors = false): string | null {
  const url = normalizeFeedUrl(raw);
  if (!url) {
    return null;
  }
  if (isPathOnly(url)) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'Not a valid URL.';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return `Unsupported scheme "${parsed.protocol.replace(':', '')}" — use http or https.`;
  }
  if (!parsed.hostname) {
    return 'URL is missing a host.';
  }

  // A plain-http subresource on an https page is blocked as mixed content.
  // Browsers exempt localhost, so the local stack is fine over http, and the
  // proxy sidesteps it entirely.
  if (
    parsed.protocol === 'http:' &&
    !useCors &&
    typeof location !== 'undefined' &&
    location.protocol === 'https:' &&
    !isLocalHost(parsed.hostname)
  ) {
    return 'An http:// URL is blocked as mixed content on this https page — use https.';
  }
  return null;
}
