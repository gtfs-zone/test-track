/* @vendored-from coloring-book:src/modules/page-state-manager.ts
   @sha dca23b3
   @status modified
   @changes
   - Reduced to test-track's five page variants; all `agency` / `service` /
     `pathway` branches deleted. Upstream's `timetable` page became a modal in
     `1c16f14` and was never here.
   - `BreadcrumbLookup` interface and `getObjectName` deleted. Breadcrumbs are now
     built by an injected synchronous `BreadcrumbBuilder` (see breadcrumbs.ts),
     because our model is in-memory rather than IndexedDB-backed.
   - `StateValidator` is synchronous, so `setPageState` / `adoptState` /
     `handleHashChange` are no longer async.
   - Added `setFeedParams()`: the hash carries the feed configuration alongside the
     focus, so `pageStateToURL` output is merged with those params on every write.
     coloring-book instead stripped a single `load=` command param.
   - `CONFIG.MAX_NAVIGATION_HISTORY` inlined, since test-track has no config module.
   - Dropped the module-level singleton (`getPageStateManager` /
     `initPageStateManager`); AppState owns the one instance.
   - Skipped `eca835c`'s `peekURLPageState`: boot reads the hash through
     `feed-url.ts` and `AppState.bootRequest()`, so nothing needs an unvalidated page
     state. `initializeFromURL()` is split into `pendingStateFromURL()` and
     `adoptState()` for the same reason: the feed has to load between the two.
   - Skipped `136329b`: the `zone` and `location_group` branches in
     `getBreadcrumbs`, `pageStateToURL` and `urlToPageState`, plus the two
     `BreadcrumbLookup` name getters, are GTFS Flex pages test-track has no
     data for.
   - Skipped `2287432`'s same-page guard in `setPageState`. The equivalent guard
     lives in `AppState.setFocus`, over `pageStatesEqual`, and is the only caller;
     a second copy here would compare against `buildHash` rather than
     `pageStateToURL` and never fire.
   - `1c16f14`'s modal dimension is taken as of Phase 12: `parseModalParams`,
     `clearModal`, the `modal_*` hash params and the modal-surviving home
     fallback. `clearModal` is async so the class satisfies `modal-router.ts`'s
     `ModalHost` unchanged, even though `setPageState` here is synchronous.
     The modal params are namespaced, so they cannot collide with the feed
     params `setFeedParams` merges into the same hash. */

import type {
  BreadcrumbItem,
  ModalState,
  ModalType,
  NavigationEvent,
  PageState,
  PageStateManagerConfig,
  StateValidator,
} from '../types/page-state';
import { MODAL_TYPES, isPageState } from '../types/page-state';

const MAX_NAVIGATION_HISTORY = 50;

type NavigationEventHandler = (event: NavigationEvent) => void;

/** Resolves a page state to its breadcrumb trail against the loaded feed. */
export type BreadcrumbBuilder = (state: PageState) => BreadcrumbItem[];

/** Single source of truth for what the app is currently looking at. */
export class PageStateManager {
  private currentState: PageState = { type: 'home' };
  private navigationHistory: NavigationEvent[] = [];
  private eventHandlers: NavigationEventHandler[] = [];
  private config: PageStateManagerConfig;
  private breadcrumbBuilder: BreadcrumbBuilder | null = null;
  private stateValidator: StateValidator | null = null;
  private feedParams: Record<string, string> = {};
  private suppressHashUpdate = false;

  constructor(config: Partial<PageStateManagerConfig> = {}) {
    this.config = {
      enableHistory: true,
      maxHistoryLength: MAX_NAVIGATION_HISTORY,
      enableUrlSync: false,
      ...config,
    };

    if (this.config.enableUrlSync && typeof window !== 'undefined') {
      window.addEventListener('hashchange', () => this.handleHashChange());
    }
  }

  setBreadcrumbBuilder(builder: BreadcrumbBuilder): void {
    this.breadcrumbBuilder = builder;
  }

  /**
   * Set the validator used to check that a restored state still names an object
   * in the loaded feed. Returns false to fall back to home.
   */
  setStateValidator(fn: StateValidator): void {
    this.stateValidator = fn;
  }

  /**
   * Replace the feed-configuration half of the hash. Written on the next state
   * change, or immediately when `writeNow` is set — the selection can change
   * while the focus does not.
   */
  setFeedParams(params: Record<string, string>, writeNow = true): void {
    this.feedParams = params;
    if (writeNow) this.writeHash(this.currentState);
  }

  getFeedParams(): Record<string, string> {
    return { ...this.feedParams };
  }

  getPageState(): PageState {
    return { ...this.currentState };
  }

  /** Update the current state, recording history and syncing the hash. */
  setPageState(newState: PageState): void {
    if (!isPageState(newState)) {
      throw new Error('Invalid page state provided');
    }

    const previousState = this.currentState;
    this.currentState = { ...newState };

    const navigationEvent: NavigationEvent = {
      from: previousState,
      to: newState,
      timestamp: Date.now(),
    };

    this.recordHistory(navigationEvent);
    this.writeHash(newState);
    this.notify(navigationEvent);
  }

  getBreadcrumbs(): BreadcrumbItem[] {
    if (!this.breadcrumbBuilder) return [];
    try {
      return this.breadcrumbBuilder(this.currentState);
    } catch (error) {
      console.error('Error building breadcrumbs:', error);
      return [];
    }
  }

  navigateTo(pageState: PageState): void {
    this.setPageState(pageState);
  }

  canNavigateBack(): boolean {
    return this.navigationHistory.length > 0;
  }

  /** Step back to the most recent state that differs from the current one. */
  navigateBack(): boolean {
    if (!this.canNavigateBack()) return false;

    const currentStateStr = JSON.stringify(this.currentState);
    for (let i = this.navigationHistory.length - 1; i >= 0; i--) {
      const fromStateStr = JSON.stringify(this.navigationHistory[i].from);
      if (fromStateStr !== currentStateStr) {
        this.setPageState(this.navigationHistory[i].from);
        return true;
      }
    }
    return false;
  }

  addNavigationHandler(handler: NavigationEventHandler): void {
    this.eventHandlers.push(handler);
  }

  removeNavigationHandler(handler: NavigationEventHandler): void {
    const index = this.eventHandlers.indexOf(handler);
    if (index >= 0) this.eventHandlers.splice(index, 1);
  }

  getNavigationHistory(): NavigationEvent[] {
    return [...this.navigationHistory];
  }

  clearNavigationHistory(): void {
    this.navigationHistory = [];
  }

  /** The focus named by the hash at boot, before any feed has loaded. */
  pendingStateFromURL(): PageState {
    if (typeof window === 'undefined') return { type: 'home' };
    return this.urlToPageState(window.location.hash.slice(1));
  }

  /**
   * Adopt a state without dispatching navigation events — used at boot, once
   * the feed has parsed and the validator can actually answer.
   */
  adoptState(state: PageState): void {
    if (state.type !== 'home' && this.stateValidator && !this.stateValidator(state)) {
      // The modal survives: it does not depend on the object that is missing.
      this.currentState = { type: 'home', ...(state.modal && { modal: state.modal }) };
      return;
    }
    this.currentState = { ...state };
  }

  /** Focus params only; the feed half is merged in by `writeHash`. */
  pageStateToURL(pageState: PageState): string {
    const params = new URLSearchParams();

    switch (pageState.type) {
      case 'home':
        break;
      case 'route':
        params.set('route', pageState.route_id);
        if (pageState.direction_id) params.set('dir', pageState.direction_id);
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
    // Its params are prefixed so they cannot collide with the page's or with
    // the feed params `buildHash` merges in.
    const modal = pageState.modal;
    if (modal) {
      params.set('modal', modal.type);
      if (modal.type === 'help' && modal.page) {
        params.set('modal_page', modal.page);
      }
    }

    return params.toString();
  }

  /**
   * Read the focus out of a hash string (no leading `#`), ignoring the feed
   * params. Priority stop -> vehicle -> alert -> route -> home; always returns a
   * valid state.
   */
  urlToPageState(hash: string): PageState {
    const params = new URLSearchParams(hash);
    const modal = this.parseModalParams(params);
    const withModal = (state: PageState): PageState =>
      modal ? { ...state, modal } : state;

    if (params.has('stop')) return withModal({ type: 'stop', stop_id: params.get('stop')! });
    if (params.has('vehicle'))
      return withModal({ type: 'vehicle', vehicle_id: params.get('vehicle')! });
    if (params.has('alert')) return withModal({ type: 'alert', alert_id: params.get('alert')! });
    if (params.has('route')) {
      const dir = params.get('dir') ?? undefined;
      return withModal({
        type: 'route',
        route_id: params.get('route')!,
        ...(dir !== undefined && { direction_id: dir }),
      });
    }
    return withModal({ type: 'home' });
  }

  /**
   * Read the modal dimension out of a parsed hash. An unknown modal name is
   * dropped rather than throwing: the hash is user-editable.
   */
  private parseModalParams(params: URLSearchParams): ModalState | null {
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

  /**
   * Drop the modal from the current state, leaving the page beneath it. A
   * no-op when no modal is open, so a modal that navigated away before closing
   * does not bounce the page.
   */
  async clearModal(): Promise<void> {
    const current = this.getPageState();
    if (!current.modal) return;
    const rest = { ...current };
    delete rest.modal;
    this.setPageState(rest as PageState);
  }

  /** The full hash for a state, feed params first so links read consistently. */
  buildHash(pageState: PageState): string {
    const params = new URLSearchParams(this.feedParams);
    for (const [k, v] of new URLSearchParams(this.pageStateToURL(pageState))) {
      params.set(k, v);
    }
    return params.toString();
  }

  private writeHash(pageState: PageState): void {
    if (!this.config.enableUrlSync || typeof window === 'undefined') return;

    const hash = this.buildHash(pageState);
    const currentHash = window.location.hash.slice(1);
    if (hash === currentHash) return;

    // Guarded by the equality check above, so the flag can never be left set by
    // a write that produces no hashchange event.
    this.suppressHashUpdate = true;
    window.location.hash = hash;
  }

  /** Back/forward, or a hand-edited address bar. */
  private handleHashChange(): void {
    if (this.suppressHashUpdate) {
      this.suppressHashUpdate = false;
      return;
    }

    let newState = this.urlToPageState(window.location.hash.slice(1));

    if (newState.type !== 'home' && this.stateValidator && !this.stateValidator(newState)) {
      console.warn('[PageStateManager] hashchange: object not in feed, falling back to home');
      newState = { type: 'home', ...(newState.modal && { modal: newState.modal }) };
    }

    const navigationEvent: NavigationEvent = {
      from: this.currentState,
      to: newState,
      timestamp: Date.now(),
    };
    this.currentState = { ...newState };

    this.recordHistory(navigationEvent);
    this.notify(navigationEvent);
  }

  private recordHistory(event: NavigationEvent): void {
    if (!this.config.enableHistory) return;
    this.navigationHistory.push(event);
    if (this.navigationHistory.length > this.config.maxHistoryLength) {
      this.navigationHistory = this.navigationHistory.slice(-this.config.maxHistoryLength);
    }
  }

  private notify(event: NavigationEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('Error in navigation event handler:', error);
      }
    }
  }
}
