/**
 * The feeds this stack serves, from cafe-car's public `GET /feeds`.
 *
 * These are the only feeds anyone here operates, so they belong above the four
 * thousand TransitLand rows in the Load modal — and unlike those, the server
 * can say whether each one is currently carrying anything, which is the
 * difference between "a feed exists" and "there is something to look at".
 *
 * Resolved against `RT_BASE`, so dev talks to the local cafe-car and the built
 * site talks to rt.gtfs.zone.
 */

import { RT_BASE } from './feed-url-resolve';

/** One row of `GET /feeds`; mirrors `FeedCatalogEntry` in cafe-car. */
export interface CatalogFeed {
  feed_name: string;
  static_url: string;
  vehicle_positions_url: string;
  trip_updates_url: string;
  service_alerts_url: string;
  has_vehicles: boolean;
  has_trip_updates: boolean;
  has_alerts: boolean;
}

/**
 * Cached for the page's lifetime, like the atlas data. The flags go stale
 * within a poll cycle or two, but re-fetching them every time the modal opens
 * would buy a freshness nobody is reading.
 */
let cached: Promise<CatalogFeed[]> | null = null;

export function loadCatalog(): Promise<CatalogFeed[]> {
  cached ??= fetchCatalog();
  return cached;
}

async function fetchCatalog(): Promise<CatalogFeed[]> {
  const res = await fetch(`${RT_BASE}/feeds`);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
  return (await res.json()) as CatalogFeed[];
}

/**
 * The realtime URLs as bare paths.
 *
 * Every URL this endpoint returns is served by the endpoint's own server, so
 * dropping the origin loses nothing and gains the environment-agnostic form
 * described in `feed-url-resolve.ts`: a link shared out of dev still works in
 * the built site, and vice versa.
 */
export function realtimePaths(feed: CatalogFeed): {
  vehiclesUrl: string;
  tripUpdatesUrl: string;
  alertsUrl: string;
} {
  return {
    vehiclesUrl: pathOf(feed.vehicle_positions_url),
    tripUpdatesUrl: pathOf(feed.trip_updates_url),
    alertsUrl: pathOf(feed.service_alerts_url),
  };
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** Which endpoints this feed currently has something in; '' when none do. */
export function describeLiveness(feed: CatalogFeed): string {
  const live = [
    feed.has_vehicles && 'vehicles',
    feed.has_trip_updates && 'trip updates',
    feed.has_alerts && 'alerts',
  ].filter(Boolean);
  return live.join(' · ');
}
