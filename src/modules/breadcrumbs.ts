import type { PageState } from '../types/page-state';
import type { BreadcrumbItem } from 'interlocking/ui/breadcrumb-trail';
import { stopTypeLabel } from 'interlocking/ui/breadcrumb-trail';
import { knownExamples } from 'interlocking/gtfs/examples';
import type { FeedSelection } from 'interlocking/gtfs/feed-selection';
import { describeSelection } from 'interlocking/gtfs/feed-selection';
import type { FeedSession } from './feed-session';
import { vehicleDisplayName } from 'interlocking/gtfs/entity-render';

/**
 * Synchronous breadcrumb building and focus validation against the loaded feed.
 *
 * coloring-book resolves breadcrumbs through an async, database-backed lookup
 * interface. Our whole model is in memory, so both of these are plain reads.
 */

/**
 * Cap a breadcrumb label's length. Some GTFS-RT producers put full sentences
 * in an alert's `header_text` rather than a short title, which wraps a crumb
 * across several lines and reads as body copy instead of a breadcrumb.
 */
function truncate(text: string, max = 40): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

/** The curated name for a selection whose scheduled URL we ship an entry for. */
function exampleName(selection: FeedSelection | null): string | null {
  const scheduled = selection?.scheduled;
  if (scheduled?.kind !== 'url') return null;
  const match = knownExamples().find(
    example =>
      example.selection.scheduled?.kind === 'url' &&
      example.selection.scheduled.url === scheduled.url,
  );
  return match?.name ?? null;
}

/**
 * What to call the loaded feed.
 *
 * A selection restored from a link carries no name, so it falls back to its
 * host — a URL where a name belongs. Once the schedule parses, the feed names
 * itself, so ask it first and only walk back towards the URL from there.
 */
function feedName(session: FeedSession): string | null {
  const feed = session.scheduledFeed;

  const publisher = feed?.feedInfo[0]?.publisher_name.trim();
  if (publisher) return publisher;

  const named = (feed?.agencies ?? []).filter(agency => agency.name.trim());
  if (named.length === 1) return named[0].name.trim();
  if (named.length > 1) return `${named[0].name.trim()} +${named.length - 1} more`;

  const example = exampleName(session.selection);
  if (example) return example;

  const described = session.selection ? describeSelection(session.selection) : null;
  return described && described !== 'feeds' ? described : null;
}

/**
 * The root crumb. Its eyebrow says what the page is, its label names the feed
 * being looked at, so the crumb reads like every other one: type over object.
 */
function home(session: FeedSession): BreadcrumbItem<PageState> {
  return {
    typeLabel: 'Feed',
    label: truncate(feedName(session) ?? 'No feed'),
    pageState: { type: 'home' },
  };
}

/** Human label for a route: short name, long name, or the bare id. */
export function routeLabel(session: FeedSession, routeId: string): string {
  const route = session.scheduledFeed?.routes.get(routeId);
  if (!route) return routeId;
  return route.short_name || route.long_name || route.id;
}

export function stopLabel(session: FeedSession, stopId: string): string {
  return session.scheduledFeed?.stops.get(stopId)?.name || stopId;
}

/** The crumb eyebrow for a stop: its `location_type`, or a plain stop. */
function stopEyebrow(session: FeedSession, stopId: string): string {
  return stopTypeLabel(session.scheduledFeed?.stops.get(stopId)?.location_type);
}

export function vehicleLabel(session: FeedSession, vehicleId: string): string {
  const vehicle = session.vehicles.get(vehicleId);
  return vehicle ? vehicleDisplayName(session.scheduledFeed, vehicle) : vehicleId;
}

export function alertLabel(session: FeedSession, alertId: string): string {
  const alert = session.alerts.get(alertId)?.alert;
  const header = alert?.headerText?.translation?.[0]?.text;
  // The crumb's eyebrow already says "Service alert", so the fallback is the
  // bare id rather than a second "Alert".
  return header ? String(header) : alertId;
}

/**
 * The chain of parents leading to a stop, outermost first.
 *
 * `parent_station` is a single edge in practice, but the loop guards against a
 * feed with a cycle rather than hanging on one.
 */
function stopAncestors(session: FeedSession, stopId: string): string[] {
  const feed = session.scheduledFeed;
  if (!feed) return [];

  const chain: string[] = [];
  const seen = new Set<string>([stopId]);
  let parent = feed.stops.get(stopId)?.parent_station;
  while (parent && !seen.has(parent) && feed.stops.has(parent)) {
    chain.unshift(parent);
    seen.add(parent);
    parent = feed.stops.get(parent)?.parent_station;
  }
  return chain;
}

/**
 * The route a vehicle is on: its trip's route when the trip resolves against
 * the schedule, otherwise whatever `route_id` the feed asserted.
 */
function vehicleRouteId(session: FeedSession, vehicleId: string): string | null {
  const vehicle = session.vehicles.get(vehicleId);
  if (!vehicle) return null;
  const fromTrip = vehicle.tripId
    ? session.scheduledFeed?.trips.get(vehicle.tripId)?.route_id
    : undefined;
  return fromTrip ?? vehicle.routeId ?? null;
}

type AlertParent =
  | { type: 'route'; route_id: string }
  | { type: 'stop'; stop_id: string };

/** The first entity an alert names that we have a page for. */
function alertParent(session: FeedSession, alertId: string): AlertParent | null {
  const informed = session.alerts.get(alertId)?.alert.informedEntity;
  if (!informed) return null;

  for (const entity of informed) {
    if (entity.routeId) return { type: 'route', route_id: entity.routeId };
    if (entity.stopId) return { type: 'stop', stop_id: entity.stopId };
  }
  return null;
}

export function buildBreadcrumbs(session: FeedSession, state: PageState): BreadcrumbItem<PageState>[] {
  switch (state.type) {
    case 'home':
      return [];

    case 'route':
      return [
        home(session),
        {
          typeLabel: 'Route',
          label: truncate(routeLabel(session, state.route_id)),
          pageState: { type: 'route', route_id: state.route_id },
        },
      ];

    case 'stop':
      return [
        home(session),
        ...stopAncestors(session, state.stop_id).map(id => ({
          typeLabel: stopEyebrow(session, id),
          label: truncate(stopLabel(session, id)),
          pageState: { type: 'stop' as const, stop_id: id },
        })),
        {
          typeLabel: stopEyebrow(session, state.stop_id),
          label: truncate(stopLabel(session, state.stop_id)),
          pageState: state,
        },
      ];

    case 'vehicle': {
      const routeId = vehicleRouteId(session, state.vehicle_id);
      return [
        home(session),
        ...(routeId
          ? [
              {
                typeLabel: 'Route',
                label: truncate(routeLabel(session, routeId)),
                pageState: { type: 'route' as const, route_id: routeId },
              },
            ]
          : []),
        {
          typeLabel: 'Vehicle',
          label: truncate(vehicleLabel(session, state.vehicle_id)),
          pageState: state,
        },
      ];
    }

    case 'alert': {
      const parent = alertParent(session, state.alert_id);
      return [
        home(session),
        ...(parent
          ? [
              {
                typeLabel:
                  parent.type === 'route' ? 'Route' : stopEyebrow(session, parent.stop_id),
                label: truncate(
                  parent.type === 'route'
                    ? routeLabel(session, parent.route_id)
                    : stopLabel(session, parent.stop_id),
                ),
                pageState: parent,
              },
            ]
          : []),
        {
          typeLabel: 'Service alert',
          label: truncate(alertLabel(session, state.alert_id)),
          pageState: state,
        },
      ];
    }
  }
}

/**
 * Whether a focus still names something in the loaded feed.
 *
 * Vehicles and alerts are checked against the last poll, so a focus can go
 * invalid without anything changing on our side — that is the point, and the
 * caller reports it rather than hiding it.
 */
export function validateState(session: FeedSession, state: PageState): boolean {
  switch (state.type) {
    case 'home':
      return true;
    case 'route':
      return session.scheduledFeed?.routes.has(state.route_id) ?? false;
    case 'stop':
      return session.scheduledFeed?.stops.has(state.stop_id) ?? false;
    case 'vehicle':
      return session.vehicles.has(state.vehicle_id);
    case 'alert':
      return session.alerts.has(state.alert_id);
  }
}
