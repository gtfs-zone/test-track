/* @vendored-from coloring-book:src/types/page-state.ts
   @sha ce1bfa0
   @status modified
   @changes
   - Page types reduced to test-track's four object pages plus home: dropped
     `agency`, `service`, and `pathway`. Upstream's `timetable` page became a
     modal in `1c16f14` and was never here.
   - Added `vehicle` and `alert`, which have no coloring-book equivalent.
   - `StateValidator` is synchronous, ours resolves against in-memory maps, not a
     database.
   - `BreadcrumbItem`, `NavigationEvent`, `PageStateManagerConfig`,
     `StateValidator`, `pageStatesEqual` and `sameLocation` are generic over the
     union and live in `interlocking`'s `ui/page-state-manager.ts`.
   - Skipped `136329b`: the `zone` and `location_group` variants and their
     `isPageState` cases are GTFS Flex pages test-track has no data for.
   - `1c16f14`'s modal dimension is taken as of Phase 12, with this repo's own
     `MODAL_TYPES`: `alerts` and `help`, the two modals worth linking to. Every
     name in upstream's list is an editor modal. Upstream's `TimetableModalState`
     / `PaneModalState` split has no counterpart here, because neither modal
     needs more than one optional selector: the help modal carries `page`, a
     `HELP_PAGES` id, and the alerts modal takes no parameters at all. Upstream's
     own comment calls the guide transient and keeps it out of the hash; it is
     routed here, because a link to a guide page is worth having.
   - `page` names the guide page the modal *opens* on, not the one showing:
     `sidebar-modal.ts` has no hook for a pane change and is `verbatim`, so
     teaching it one is an upstream change rather than a local edit.
   - `ModalStateOf` follows upstream's drop: `modal-router.ts` narrows an
     opener's argument itself now. */

/**
 * Union of every page test-track can display. Each variant carries the minimal
 * set of object keys needed to identify and restore the page.
 *
 * Route, stop, vehicle and alert ids are each unique within a feed, so no
 * variant needs a parent id to disambiguate.
 */
export type PageLocation =
  | { type: 'home' }
  | { type: 'route'; route_id: string }
  | { type: 'stop'; stop_id: string }
  | { type: 'vehicle'; vehicle_id: string }
  | { type: 'alert'; alert_id: string };

/**
 * The modals that live in the URL hash. The load modal is deliberately absent:
 * it is a boot step and a transient editor of the feed selection, and the
 * selection it produces is already in the hash on its own.
 */
export const MODAL_TYPES = ['alerts', 'help'] as const;

export type ModalType = (typeof MODAL_TYPES)[number];

/**
 * A modal is orthogonal to the page beneath it: closing one returns to that
 * page rather than to a separate page state.
 */
export type ModalState =
  | { type: 'alerts' }
  | { type: 'help'; page?: string };

/** Distributed so that narrowing on `type` still works through the modal field. */
type WithModal<T> = T extends unknown ? T & { modal?: ModalState } : never;

export type PageState = WithModal<PageLocation>;

export type PageStateType = PageLocation['type'];

/** Type guard for a valid ModalState. */
export function isModalState(value: unknown): value is ModalState {
  if (!value || typeof value !== 'object') return false;

  const modal = value as { type?: unknown; page?: unknown };
  if (!MODAL_TYPES.includes(modal.type as ModalType)) return false;

  if (modal.type === 'help') {
    if (modal.page !== undefined && typeof modal.page !== 'string') return false;
    return Object.keys(modal).every(k => k === 'type' || k === 'page');
  }
  return Object.keys(modal).length === 1;
}

/** Type guard for a valid PageState. */
export function isPageState(value: unknown): value is PageState {
  if (!value || typeof value !== 'object') return false;

  // The modal dimension is validated on its own; the checks below count the
  // keys of the page underneath it.
  const { modal, ...state } = value as { modal?: unknown; type?: string };
  if (modal !== undefined && !isModalState(modal)) return false;
  if (typeof state.type !== 'string') return false;

  switch (state.type) {
    case 'home':
      return Object.keys(state).length === 1;

    case 'route': {
      const s = state as { route_id?: string };
      return Object.keys(state).length === 2 && typeof s.route_id === 'string';
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
