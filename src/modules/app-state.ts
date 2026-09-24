/**
 * Focus changes and feed selection.
 *
 * The focus half is `interlocking`'s `FocusController`: map click, panel link,
 * hash change and boot restore all converge on it. What this adds is the feed
 * half of the hash, and the boot sequence that reads a link before its feed
 * has loaded.
 */

import type { FeedSelection } from 'interlocking/gtfs/feed-selection';
import type { BreadcrumbItem } from 'interlocking/ui/breadcrumb-trail';
import type { FocusHooks } from 'interlocking/ui/focus-controller';
import { FocusController } from 'interlocking/ui/focus-controller';
import { homeWithModal } from 'interlocking/ui/page-state-manager';
import type { PageState } from '../types/page-state';
import { buildBreadcrumbs, validateState } from './breadcrumbs';
import type { FeedSession } from './feed-session';
import { describeMissing, isComplete } from 'interlocking/gtfs/feed-selection';
import { paramsToSelection, selectionToParams } from './feed-url';
import { notify } from 'interlocking/ui/notification-system';
import { createPageStateManager } from './page-state-manager';

/** What the hash named at boot, read once before anything loads. */
export interface BootRequest {
  selection: FeedSelection | null;
  /** True when the selection can be loaded as it stands. */
  complete: boolean;
  /** Why it cannot, when it names only half a session. */
  problem: string | null;
  /** The focus the link carried, captured before a load rewrites the hash. */
  pending: PageState;
}

export type AppStateHooks = FocusHooks<PageState>;

export class AppState extends FocusController<PageState, BreadcrumbItem<PageState>> {
  private session: FeedSession;

  constructor(session: FeedSession, hooks: AppStateHooks) {
    super(createPageStateManager(), hooks);
    this.session = session;

    this.pages.setBreadcrumbBuilder(state => buildBreadcrumbs(session, state));
    this.pages.setStateValidator(state => validateState(session, state));

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

  /**
   * What the hash named, without loading any of it.
   *
   * The loading itself belongs to the one caller that already knows how to
   * report a failed load, so this only reads. `pending` has to be captured here
   * and handed back rather than re-read later: loading rewrites the feed half of
   * the hash, and the focus half would be re-read from a hash that no longer
   * names what the link named.
   *
   * `problem` is set for a link that names only half a session — the boot modal
   * prints it rather than a toast, since the modal is where it gets fixed.
   */
  bootRequest(): BootRequest {
    const selection = paramsToSelection(window.location.hash.slice(1));
    const pending = this.pages.pendingStateFromURL();
    if (!selection) {
      return { selection: null, complete: false, problem: null, pending };
    }
    const complete = isComplete(selection);
    return {
      selection,
      complete,
      // The modal's own hint line already names what is missing; this says why
      // the modal is open at all, which the hint cannot.
      problem: complete
        ? null
        : `This link names only part of a feed — ${describeMissing(selection).toLowerCase()}.`,
      pending,
    };
  }

  /** Apply the focus a link carried, once its feed has actually loaded. */
  finishBoot(pending: PageState): void {
    this.applyPendingFocus(pending);
  }

  /** Paint the empty app when boot loaded nothing. */
  bootEmpty(): void {
    this.repaint();
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
      this.adopt(homeWithModal(pending));
    } else {
      this.adopt(pending);
    }
  }
}
