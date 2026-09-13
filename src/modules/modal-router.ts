/* @vendored-from coloring-book:src/modules/modal-router.ts
   @sha d8afa32
   @status verbatim */
/**
 * Modal Router
 *
 * Reconciles the modal named by the URL hash with the modal that is actually
 * open. Every routed content modal (shapes, calendar, fares, on-demand, feed
 * data, levels) is opened through here, so the hash stays truthful whichever
 * way the modal was closed: its Close button, Escape, the X, the backdrop, or
 * a back/forward step in the browser.
 *
 * Modal modules are unchanged: they still call `showModal` themselves and know
 * nothing about the hash. The router opens one by calling the opener registered
 * for its type, and closes one by taking the modal stack back down to the depth
 * it had before that opener ran.
 */

import {
  ModalState,
  ModalStateOf,
  ModalType,
  PageState,
} from '../types/page-state';
import { closeModalsAbove, modalStackDepth } from './modal-utils';

/**
 * The navigation state the router writes back to. Structural rather than the
 * `PageStateManager` class, so each app can hand over its own.
 */
interface ModalHost {
  /** Drop the modal from the URL when the user, not the router, closed it. */
  clearModal(): Promise<void>;
}

/**
 * Per-open details that do not belong in the URL: a row to draw attention to,
 * and what to run once the modal is gone.
 */
export interface ModalTransient {
  /** Primary key of a row the modal should scroll to and highlight. */
  rowKey?: string;
  /** Run after the modal closes, however it was closed. */
  onClosed?: () => void;
}

export type ModalOpener<M extends ModalState = ModalState> = (
  modal: M,
  transient: ModalTransient,
  /**
   * True once the router has closed this session. An opener that awaits
   * something before showing its own modal (a help page, a data load) must
   * check this and return, or it would open a modal the URL no longer names.
   */
  cancelled: () => boolean
) => Promise<void>;

interface ModalSession {
  type: ModalType;
  /** Modal stack depth before the opener ran. */
  depth: number;
  /** Set when the router closes the session, possibly mid-open. */
  cancelled: boolean;
}

class ModalRouter {
  private openers = new Map<ModalType, ModalOpener>();
  private session: ModalSession | null = null;
  private pendingTransient: ModalTransient = {};

  constructor(private host: ModalHost) {}

  /** Wire a modal type to the function that opens it. */
  register<T extends ModalType>(
    type: T,
    opener: ModalOpener<ModalStateOf<T>>
  ): void {
    this.openers.set(type, opener as ModalOpener);
  }

  /**
   * Details for the next open, consumed by the opener the following `sync`
   * runs. Set by `openModal` just before it moves the page state.
   */
  setPendingTransient(transient: ModalTransient): void {
    this.pendingTransient = transient;
  }

  /**
   * Open the modal the state names and close any other. Called on every
   * navigation event and once on boot.
   */
  sync(state: PageState): void {
    const wanted = state.modal;
    // A parameter change inside an open modal is the modal's own business, so
    // a matching type is left alone rather than reopened on a new `table` or a
    // new timetable target. Such a modal listens for navigation itself.
    if (this.session && this.session.type === wanted?.type) {
      return;
    }
    if (this.session) {
      this.closeSession();
    }
    if (wanted) {
      this.openSession(wanted);
    }
  }

  private closeSession(): void {
    const session = this.session;
    if (!session) {
      return;
    }
    console.log(`[ModalRouter] closing ${session.type} modal`);
    this.session = null;
    session.cancelled = true;
    closeModalsAbove(session.depth);
  }

  private openSession(modal: ModalState): void {
    const opener = this.openers.get(modal.type);
    if (!opener) {
      console.warn(`[ModalRouter] no opener registered for ${modal.type}`);
      return;
    }

    const transient = this.pendingTransient;
    this.pendingTransient = {};
    const session: ModalSession = {
      type: modal.type,
      depth: modalStackDepth(),
      cancelled: false,
    };
    this.session = session;
    console.log(`[ModalRouter] opening ${modal.type} modal`);

    void (async () => {
      try {
        await opener(modal, transient, () => session.cancelled);
      } catch (error) {
        console.error(`[ModalRouter] ${modal.type} modal failed:`, error);
      }
      // Still the current session means the user closed the modal rather than
      // the router closing it for a navigation, so the hash has to catch up.
      // Checking identity rather than a flag keeps this correct even though
      // the close resolves a promise a microtask later.
      if (this.session === session) {
        this.session = null;
        await this.host.clearModal();
      }
      transient.onClosed?.();
    })();
  }
}

let instance: ModalRouter | null = null;

/** Build the router for this app. Called once, during boot. */
export function createModalRouter(host: ModalHost): ModalRouter {
  instance = new ModalRouter(host);
  return instance;
}

export function getModalRouter(): ModalRouter {
  if (!instance) {
    throw new Error('[ModalRouter] createModalRouter has not run yet');
  }
  return instance;
}
