/**
 * The single entry point for focus changes.
 *
 * Map click, panel link, hash change and boot restore all converge here, and
 * everything downstream — the panel, the map, the bottom sheet, the address bar
 * — reacts to this module rather than to each other. In particular, only
 * `PageStateManager` ever writes the hash, which is what keeps its
 * `suppressHashUpdate` guard honest.
 */

import type { FeedSelection } from './feed-selection';
import type { ModalState, PageState } from '../types/page-state';
import { pageStatesEqual, sameLocation } from '../types/page-state';
import { buildBreadcrumbs, validateState } from './breadcrumbs';
import type { FeedSession } from './feed-session';
import { isComplete } from './feed-selection';
import { LoadCancelledError } from './feed-download';
import { paramsToSelection, selectionToParams } from './feed-url';
import { notify } from './notification-system';
import { PageStateManager } from './page-state-manager';

export interface AppStateHooks {
  /**
   * Called when the page underneath the modal changes, including the boot
   * restore. Opening or closing a modal leaves the page alone, so this does
   * not fire for one.
   */
  onFocusChange: (state: PageState) => void;
  /**
   * Called on every navigation, modal-only ones included. The modal router
   * reads the whole state from here, which is what keeps the hash and the open
   * modal reconciled however the modal was closed.
   */
  onStateChange: (state: PageState) => void;
}

export class AppState {
  readonly pages = new PageStateManager({ enableUrlSync: true });
  /**
   * What the hash named when `boot()` could not load it: a partial selection,
   * or null. Boot's modal seeds itself with this, so a link naming only half a
   * session is completed rather than retyped.
   */
  bootSeed: FeedSelection | null = null;
  private session: FeedSession;
  private hooks: AppStateHooks;

  constructor(session: FeedSession, hooks: AppStateHooks) {
    this.session = session;
    this.hooks = hooks;

    this.pages.setBreadcrumbBuilder(state => buildBreadcrumbs(session, state));
    this.pages.setStateValidator(state => validateState(session, state));
    this.pages.addNavigationHandler(event => this.emit(event.to, event.from));

    // The selection is half of the hash, so any change to it — a modal load, an
    // inline URL edit on the status page — has to be reflected there too.
    session.addEventListener('change', () => {
      this.pages.setFeedParams(selectionToParams(session.selection));
    });

    // A new scheduled feed almost never contains the object that was focused in
    // the old one, and leaving a stale focus in place would render an object
    // page for something the loaded feed does not describe.
    session.addEventListener('scheduleloaded', () => {
      const current = this.focus;
      if (current.type !== 'home' && !validateState(session, current)) {
        this.clearFocus();
      }
    });
  }

  get focus(): PageState {
    return this.pages.getPageState();
  }

  get breadcrumbs() {
    return this.pages.getBreadcrumbs();
  }

  /**
   * Fan a state out to the hooks. The focus hook is skipped when only the modal
   * moved, so opening the guide over a stop page does not re-render the panel
   * or move the camera. `from` is omitted at boot, where there is no previous
   * state and both hooks have to run.
   */
  private emit(to: PageState, from?: PageState): void {
    if (!from || !sameLocation(from, to)) this.hooks.onFocusChange(to);
    this.hooks.onStateChange(to);
  }

  /**
   * Navigate. The state replaces the current one whole, so a focus change with
   * no `modal` field closes whatever modal was open — which is what an alert
   * row inside the alerts modal wants.
   */
  setFocus(state: PageState): void {
    if (pageStatesEqual(state, this.focus)) return;
    this.pages.setPageState(state);
  }

  clearFocus(): void {
    this.setFocus({ type: 'home' });
  }

  /** Open a modal over the current page, leaving that page where it is. */
  openModal(modal: ModalState): void {
    this.setFocus({ ...this.focus, modal });
  }

  /**
   * Restore a session from the hash: read the feed config, load it, then apply
   * the focus — which cannot resolve until the scheduled feed has parsed.
   *
   * Returns false when the hash named no feeds, leaving the app in its empty
   * state. A focus without feeds is meaningless, so it is discarded rather than
   * held pending.
   */
  async boot(): Promise<boolean> {
    const hash = window.location.hash.slice(1);
    const selection = paramsToSelection(hash);

    if (!selection || !isComplete(selection)) {
      if (selection) {
        this.bootSeed = selection;
        notify.warning('The link is missing a scheduled or realtime feed — nothing loaded.');
      }
      this.emit(this.focus);
      return false;
    }

    const pending = this.pages.pendingStateFromURL();

    try {
      await this.session.load(selection);
    } catch (err) {
      if (err instanceof LoadCancelledError) {
        notify.info('Load cancelled');
        this.emit(this.focus);
        return false;
      }
      notify.error(
        `Failed to load feeds from link: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.emit(this.focus);
      return false;
    }

    this.applyPendingFocus(pending);
    return true;
  }

  /**
   * A focus restored from a link is applied without dispatching navigation
   * history, but a focus that no longer resolves is reported rather than
   * silently dropped — a dead link should say so.
   */
  private applyPendingFocus(pending: PageState): void {
    if (pending.type !== 'home' && !validateState(this.session, pending)) {
      notify.warning(`Nothing in this feed matches the linked ${pending.type}.`);
      // The modal outlives the page it was linked over: it names no object.
      this.pages.adoptState({ type: 'home', ...(pending.modal && { modal: pending.modal }) });
    } else {
      this.pages.adoptState(pending);
    }
    this.emit(this.focus);
  }

  /**
   * The hash a link to `state` should carry. Object pages render real `<a>`
   * elements so middle-click and copy-link-address behave, even though the
   * click itself is intercepted and handled in place.
   */
  hrefFor(state: PageState): string {
    const hash = this.pages.buildHash(state);
    return hash ? `#${hash}` : '#';
  }

  /** The full shareable URL for the current session. */
  shareableUrl(): string {
    const hash = this.pages.buildHash(this.focus);
    return `${window.location.origin}${window.location.pathname}${hash ? `#${hash}` : ''}`;
  }
}
