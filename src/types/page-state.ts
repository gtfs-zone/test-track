/* @vendored-from coloring-book:src/types/page-state.ts
   @sha a4b5ee1
   @status modified
   @changes
   - Page types reduced to test-track's four object pages plus home: dropped
     `agency`, `timetable`, `service`, and `pathway`.
   - `route` gained an optional `direction_id` (absorbed from `timetable`), so the
     route strip's direction tab is linkable.
   - Added `vehicle` and `alert`, which have no coloring-book equivalent.
   - `StateValidator` is synchronous, ours resolves against in-memory maps, not a
     database.
   - `BreadcrumbItem` moved upstream into `breadcrumb-trail.ts` when it gained a
     `typeLabel`; re-exported here so import sites are unchanged.
   - Skipped `136329b`: the `zone` and `location_group` variants and their
     `isPageState` cases are GTFS Flex pages test-track has no data for. */

/**
 * Union of every page test-track can display. Each variant carries the minimal
 * set of object keys needed to identify and restore the page.
 *
 * Route, stop, vehicle and alert ids are each unique within a feed, so no
 * variant needs a parent id to disambiguate.
 */
export type PageState =
  | { type: 'home' }
  | { type: 'route'; route_id: string; direction_id?: string }
  | { type: 'stop'; stop_id: string }
  | { type: 'vehicle'; vehicle_id: string }
  | { type: 'alert'; alert_id: string };

export type PageStateType = PageState['type'];

/** Re-export, so the crumb shape and the page states stay one import apart. */
export type { BreadcrumbItem } from '../modules/breadcrumb-trail.js';

/** Type guard for a valid PageState. */
export function isPageState(value: unknown): value is PageState {
  if (!value || typeof value !== 'object') return false;

  const state = value as { type?: string };
  if (typeof state.type !== 'string') return false;

  switch (state.type) {
    case 'home':
      return Object.keys(state).length === 1;

    case 'route': {
      const s = state as { route_id?: string; direction_id?: string };
      const keys = Object.keys(state).length;
      return (
        typeof s.route_id === 'string' &&
        (s.direction_id === undefined || typeof s.direction_id === 'string') &&
        (keys === 2 || keys === 3)
      );
    }

    case 'stop': {
      const s = state as { stop_id?: string };
      return Object.keys(state).length === 2 && typeof s.stop_id === 'string';
    }

    case 'vehicle': {
      const s = state as { vehicle_id?: string };
      return Object.keys(state).length === 2 && typeof s.vehicle_id === 'string';
    }

    case 'alert': {
      const s = state as { alert_id?: string };
      return Object.keys(state).length === 2 && typeof s.alert_id === 'string';
    }

    default:
      return false;
  }
}

/** Two states are equal when they name the same object with the same options. */
export function pageStatesEqual(a: PageState, b: PageState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Navigation event emitted on every focus change. */
export type NavigationEvent = {
  from: PageState;
  to: PageState;
  timestamp: number;
};

export type PageStateManagerConfig = {
  enableHistory: boolean;
  maxHistoryLength: number;
  enableUrlSync: boolean;
};

/**
 * Checks whether a page state refers to an object that exists in the currently
 * loaded feed. Returns false and the caller falls back to home.
 *
 * Synchronous, unlike coloring-book's: our model is a set of in-memory maps.
 */
export type StateValidator = (state: PageState) => boolean;
