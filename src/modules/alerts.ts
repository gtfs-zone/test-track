/**
 * Which alerts apply to what, and at which level.
 *
 * The stop sheet this replaces matched alerts with
 * `informedEntity.some(e => !e.stopId || e.stopId === stopId)`. The `!e.stopId`
 * clause makes every route-level and agency-level alert match every stop in the
 * feed, which is why a single system-wide alert used to light up hundreds of
 * stops. Matching here is explicit about the level an entity selector names,
 * and every page shows that level next to the alert rather than implying the
 * alert is about the object being viewed.
 */

import type { AlertRecord, ServiceAlert } from '../gtfs-rt';
import { toSeconds } from '../gtfs-rt';
import type { FeedSession } from './feed-session';

type EntitySelector = NonNullable<ServiceAlert['informedEntity']>[number];
type TranslatedString = NonNullable<ServiceAlert['headerText']>;

/** How broadly a single entity selector applies. */
export type AlertLevel = 'feed' | 'agency' | 'route-type' | 'route' | 'trip' | 'stop' | 'route-stop';

export function selectorLevel(e: EntitySelector): AlertLevel {
  const hasStop = Boolean(e.stopId);
  const hasRoute = Boolean(e.routeId);
  if (hasStop && hasRoute) return 'route-stop';
  if (hasStop) return 'stop';
  if (e.trip?.tripId) return 'trip';
  if (hasRoute) return 'route';
  if (e.routeType !== null && e.routeType !== undefined) return 'route-type';
  if (e.agencyId) return 'agency';
  return 'feed';
}

export const ALERT_LEVEL_LABELS: Record<AlertLevel, string> = {
  feed: 'Whole feed',
  agency: 'Agency-wide',
  'route-type': 'All routes of a mode',
  route: 'Route',
  trip: 'Trip',
  stop: 'Stop',
  'route-stop': 'Route at stop',
};

function selectors(record: AlertRecord): EntitySelector[] {
  return record.alert.informedEntity ?? [];
}

/** The broadest level any of an alert's selectors names. */
export function alertLevel(record: AlertRecord): AlertLevel {
  const order: AlertLevel[] = ['feed', 'agency', 'route-type', 'route', 'trip', 'route-stop', 'stop'];
  let best = order.length - 1;
  for (const e of selectors(record)) {
    best = Math.min(best, order.indexOf(selectorLevel(e)));
  }
  return order[best];
}

function all(session: FeedSession): AlertRecord[] {
  return [...session.alerts.values()];
}

/**
 * Alerts that name no object at all, or only an agency or mode — the ones that
 * belong at the top of every page rather than attached to one row.
 */
export function feedWideAlerts(session: FeedSession): AlertRecord[] {
  return all(session).filter(r =>
    selectors(r).some(e => {
      const level = selectorLevel(e);
      return level === 'feed' || level === 'agency' || level === 'route-type';
    }),
  );
}

/** Route-level alerts: the route named directly, or via one of its trips. */
export function alertsForRoute(session: FeedSession, routeId: string): AlertRecord[] {
  const feed = session.staticFeed;
  return all(session).filter(r =>
    selectors(r).some(e => {
      if (e.stopId) return false;
      if (e.routeId === routeId) return true;
      const tripId = e.trip?.tripId;
      if (!tripId) return false;
      return feed?.trips.get(tripId)?.route_id === routeId;
    }),
  );
}

/** Every alert naming this stop, at any level of specificity. */
export function alertsForStop(session: FeedSession, stopId: string): AlertRecord[] {
  return all(session).filter(r => selectors(r).some(e => e.stopId === stopId));
}

/**
 * Alerts to show inline on one row of the route strip: this stop generally, or
 * this stop on this route.
 */
export function alertsForRouteStop(
  session: FeedSession,
  routeId: string,
  stopIds: string[],
): AlertRecord[] {
  // Several ids because the caller may be asking on behalf of a whole station:
  // an alert naming one platform is an alert about that station's row on the
  // route strip.
  const wanted = new Set(stopIds);
  return all(session).filter(r =>
    selectors(r).some(
      e => Boolean(e.stopId) && wanted.has(e.stopId!) && (!e.routeId || e.routeId === routeId),
    ),
  );
}

/** Alerts naming a specific trip, or the route that trip runs on. */
export function alertsForTrip(
  session: FeedSession,
  tripId: string,
  routeId: string | undefined,
): AlertRecord[] {
  return all(session).filter(r =>
    selectors(r).some(
      e =>
        e.trip?.tripId === tripId ||
        (routeId !== undefined && !e.stopId && e.routeId === routeId),
    ),
  );
}

// ─── Active periods ───────────────────────────────────────────────────────────

export interface ActivePeriod {
  start?: number;
  end?: number;
}

/**
 * `activePeriod` may be absent entirely, which the spec defines as "always
 * active", and either bound may be missing on its own. An alert with a start
 * and no end is open-ended — never render that as an end of 1970.
 */
export function activePeriods(alert: ServiceAlert): ActivePeriod[] {
  return (alert.activePeriod ?? []).map(p => ({
    start: toSeconds(p.start),
    end: toSeconds(p.end),
  }));
}

export function isActiveNow(alert: ServiceAlert, nowSeconds = Date.now() / 1000): boolean {
  const periods = activePeriods(alert);
  if (periods.length === 0) return true;
  return periods.some(
    p => (p.start === undefined || p.start <= nowSeconds) && (p.end === undefined || p.end >= nowSeconds),
  );
}

export function activeAlerts(session: FeedSession): AlertRecord[] {
  const now = Date.now() / 1000;
  return all(session).filter(r => isActiveNow(r.alert, now));
}

// ─── Translations ─────────────────────────────────────────────────────────────

export interface Translation {
  language: string;
  text: string;
}

/** Every translation the feed supplied, not just the one we happen to prefer. */
export function translations(ts: TranslatedString | null | undefined): Translation[] {
  return (ts?.translation ?? []).map(t => ({
    language: t.language ?? '',
    text: String(t.text ?? ''),
  }));
}

/** The browser's language if the feed has it, else English, else the first. */
export function preferredText(ts: TranslatedString | null | undefined): string {
  const list = translations(ts);
  if (list.length === 0) return '';
  const wanted = navigator.language.split('-')[0].toLowerCase();
  const match =
    list.find(t => t.language.toLowerCase().split('-')[0] === wanted) ??
    list.find(t => t.language.toLowerCase().startsWith('en'));
  return (match ?? list[0]).text;
}

export const CAUSE_LABELS: Record<number, string> = {
  1: 'Unknown cause',
  2: 'Other cause',
  3: 'Technical problem',
  4: 'Strike',
  5: 'Demonstration',
  6: 'Accident',
  7: 'Holiday',
  8: 'Weather',
  9: 'Maintenance',
  10: 'Construction',
  11: 'Police activity',
  12: 'Medical emergency',
};

export const EFFECT_LABELS: Record<number, string> = {
  1: 'No service',
  2: 'Reduced service',
  3: 'Significant delays',
  4: 'Detour',
  5: 'Additional service',
  6: 'Modified service',
  7: 'Other effect',
  8: 'Unknown effect',
  9: 'Stop moved',
  10: 'No effect',
  11: 'Accessibility issue',
};

export const SEVERITY_LABELS: Record<number, string> = {
  1: 'Unknown severity',
  2: 'Info',
  3: 'Warning',
  4: 'Severe',
};
