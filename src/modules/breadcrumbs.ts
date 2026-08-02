import type { BreadcrumbItem, PageState } from '../types/page-state';
import type { FeedSession } from './feed-session';

/**
 * Synchronous breadcrumb building and focus validation against the loaded feed.
 *
 * coloring-book resolves breadcrumbs through an async, database-backed lookup
 * interface. Our whole model is in memory, so both of these are plain reads.
 */

const HOME: BreadcrumbItem = { label: 'Feed status', pageState: { type: 'home' } };

/** Human label for a route: short name, long name, or the bare id. */
export function routeLabel(session: FeedSession, routeId: string): string {
  const route = session.staticFeed?.routes.get(routeId);
  if (!route) return routeId;
  return route.short_name || route.long_name || route.id;
}

export function stopLabel(session: FeedSession, stopId: string): string {
  return session.staticFeed?.stops.get(stopId)?.name || stopId;
}

export function vehicleLabel(session: FeedSession, vehicleId: string): string {
  return session.vehicles.get(vehicleId)?.label || vehicleId;
}

export function alertLabel(session: FeedSession, alertId: string): string {
  const alert = session.alerts.get(alertId)?.alert;
  const header = alert?.headerText?.translation?.[0]?.text;
  return header ? String(header) : `Alert ${alertId}`;
}

/**
 * The chain of parents leading to a stop, outermost first.
 *
 * `parent_station` is a single edge in practice, but the loop guards against a
 * feed with a cycle rather than hanging on one.
 */
function stopAncestors(session: FeedSession, stopId: string): string[] {
  const feed = session.staticFeed;
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
 * static data, otherwise whatever `route_id` the feed asserted.
 */
function vehicleRouteId(session: FeedSession, vehicleId: string): string | null {
  const vehicle = session.vehicles.get(vehicleId);
  if (!vehicle) return null;
  const fromTrip = vehicle.tripId
    ? session.staticFeed?.trips.get(vehicle.tripId)?.route_id
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

export function buildBreadcrumbs(session: FeedSession, state: PageState): BreadcrumbItem[] {
  switch (state.type) {
    case 'home':
      return [];

    case 'route':
      return [
        HOME,
        {
          label: routeLabel(session, state.route_id),
          pageState: { type: 'route', route_id: state.route_id },
        },
      ];

    case 'stop':
      return [
        HOME,
        ...stopAncestors(session, state.stop_id).map(id => ({
          label: stopLabel(session, id),
          pageState: { type: 'stop' as const, stop_id: id },
        })),
        { label: stopLabel(session, state.stop_id), pageState: state },
      ];

    case 'vehicle': {
      const routeId = vehicleRouteId(session, state.vehicle_id);
      return [
        HOME,
        ...(routeId
          ? [
              {
                label: routeLabel(session, routeId),
                pageState: { type: 'route' as const, route_id: routeId },
              },
            ]
          : []),
        { label: vehicleLabel(session, state.vehicle_id), pageState: state },
      ];
    }

    case 'alert': {
      const parent = alertParent(session, state.alert_id);
      return [
        HOME,
        ...(parent
          ? [
              {
                label:
                  parent.type === 'route'
                    ? routeLabel(session, parent.route_id)
                    : stopLabel(session, parent.stop_id),
                pageState: parent,
              },
            ]
          : []),
        { label: alertLabel(session, state.alert_id), pageState: state },
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
      return session.staticFeed?.routes.has(state.route_id) ?? false;
    case 'stop':
      return session.staticFeed?.stops.has(state.stop_id) ?? false;
    case 'vehicle':
      return session.vehicles.has(state.vehicle_id);
    case 'alert':
      return session.alerts.has(state.alert_id);
  }
}
