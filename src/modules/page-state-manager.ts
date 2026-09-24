/* @vendored-from coloring-book:src/modules/page-state-manager.ts
   @sha 1ce064d
   @status adopted
   @changes
   - The `PageStateManager` class is `interlocking`'s `ui/page-state-manager.ts`
     now, generic over the page-state union. What is left here is this app's
     hash codec, which the shared class is constructed with.
   - The codec covers test-track's five page variants; upstream's `agency` /
     `service` / `pathway` / `zone` / `location_group` branches are gone, and
     `timetable` was never here.
   - Upstream's `1c16f14` modal dimension: the `modal` / `modal_page` params,
     namespaced so they cannot collide with the feed params the manager merges
     into the same hash. */

import type { PageStateCodec } from 'interlocking/ui/page-state-manager';
import { PageStateManager } from 'interlocking/ui/page-state-manager';
import type { BreadcrumbItem } from 'interlocking/ui/breadcrumb-trail';
import type { ModalState, ModalType, PageState } from '../types/page-state';
import { MODAL_TYPES, isPageState } from '../types/page-state';

/**
 * Read the modal dimension out of a parsed hash. An unknown modal name is
 * dropped rather than throwing: the hash is user-editable.
 */
function parseModalParams(params: URLSearchParams): ModalState | null {
  const type = params.get('modal');
  if (type === null) return null;
  if (!MODAL_TYPES.includes(type as ModalType)) {
    console.warn(`[PageStateManager] unknown modal in hash: ${type}`);
    return null;
  }
  if (type === 'help') {
    const page = params.get('modal_page');
    return { type: 'help', ...(page !== null && { page }) };
  }
  return { type: 'alerts' };
}

const pageStateCodec: PageStateCodec<PageState> = {
  isPageState,

  toParams(pageState) {
    const params = new URLSearchParams();

    switch (pageState.type) {
      case 'home':
        break;
      case 'route':
        params.set('route', pageState.route_id);
        break;
      case 'stop':
        params.set('stop', pageState.stop_id);
        break;
      case 'vehicle':
        params.set('vehicle', pageState.vehicle_id);
        break;
      case 'alert':
        params.set('alert', pageState.alert_id);
        break;
    }

    // The modal rides on top of whatever page is beneath it, home included.
    const modal = pageState.modal;
    if (modal) {
      params.set('modal', modal.type);
      if (modal.type === 'help' && modal.page) {
        params.set('modal_page', modal.page);
      }
    }

    return params;
  },

  /** Priority stop -> vehicle -> alert -> route -> home. */
  fromParams(params) {
    const modal = parseModalParams(params);
    const withModal = (state: PageState): PageState =>
      modal ? { ...state, modal } : state;

    if (params.has('stop')) return withModal({ type: 'stop', stop_id: params.get('stop')! });
    if (params.has('vehicle'))
      return withModal({ type: 'vehicle', vehicle_id: params.get('vehicle')! });
    if (params.has('alert')) return withModal({ type: 'alert', alert_id: params.get('alert')! });
    if (params.has('route')) return withModal({ type: 'route', route_id: params.get('route')! });
    return withModal({ type: 'home' });
  },
};

export type AppPageStateManager = PageStateManager<PageState, BreadcrumbItem<PageState>>;

/** The one manager AppState owns, synced to the hash. */
export function createPageStateManager(): AppPageStateManager {
  return new PageStateManager({ codec: pageStateCodec, enableUrlSync: true });
}
