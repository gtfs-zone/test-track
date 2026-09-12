/* @vendored-from coloring-book:src/modules/modal-utils.ts
   @sha 039b6bd
   @status verbatim */
export function renderTrashIcon(sizeClass = 'h-4 w-4'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${sizeClass}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>`;
}

export function renderUploadIcon(sizeClass = 'h-4 w-4'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${sizeClass}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>`;
}

export function renderPencilIcon(sizeClass = 'h-4 w-4'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${sizeClass}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>`;
}

/**
 * Route-waypoints icon: start/end pins connected by a path, matching the
 * "open in brouter" affordance without spending a wide `->` text link.
 */
export function renderRouteWaypointsIcon(sizeClass = 'h-4 w-4'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${sizeClass}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 4a2 2 0 100 4 2 2 0 000-4zM18 16a2 2 0 100 4 2 2 0 000-4z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 8v3a3 3 0 003 3h6a3 3 0 013 3v-1" /></svg>`;
}

/**
 * Sort-by-time icon: descending bars beside a clock face, for the action that
 * puts a trip's stop_times back into chronological order.
 */
export function renderSortByTimeIcon(sizeClass = 'h-4 w-4'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${sizeClass}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 6h8M3 12h5M3 18h3" /><circle cx="17" cy="14" r="5" stroke-width="2" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 12v2l1.5 1.5" /></svg>`;
}

/**
 * Two overlapping sheets, for the action that copies a trip.
 */
export function renderCopyIcon(sizeClass = 'h-4 w-4'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${sizeClass}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><rect x="9" y="9" width="11" height="11" rx="2" stroke-width="2" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15H5a1 1 0 01-1-1V6a2 2 0 012-2h8a1 1 0 011 1v0" /></svg>`;
}

/**
 * Two arrows pointing opposite ways, for the action that reverses a trip's
 * stop order.
 */
export function renderReverseIcon(sizeClass = 'h-4 w-4'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${sizeClass}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5v14m0-14L5 8m3-3l3 3" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 19V5m0 14l3-3m-3 3l-3-3" /></svg>`;
}

/**
 * Clock with a right-pointing arrow, for the action that shifts every time of
 * a trip along the clock.
 */
export function renderShiftTimeIcon(sizeClass = 'h-4 w-4'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${sizeClass}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="9" cy="12" r="6" stroke-width="2" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 9v3l2 1" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 12h5m0 0l-2.5-2.5M22 12l-2.5 2.5" /></svg>`;
}

/**
 * Simplify icon: a jagged line above the straight line it collapses to, for
 * the action that drops intermediate shape points.
 */
export function renderSimplifyIcon(sizeClass = 'h-4 w-4'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${sizeClass}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9l4-4 4 4 4-4 6 4" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 17h18" /></svg>`;
}

/**
 * Question mark in a circle, for the button that opens a guide page.
 */
export function renderHelpIcon(sizeClass = 'h-4 w-4'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${sizeClass}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="12" cy="12" r="9" stroke-width="2" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.5 9.5a2.5 2.5 0 114 2c-.9.7-1.5 1.2-1.5 2.5" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 17.5h.01" /></svg>`;
}

export function renderCloseIcon(sizeClass = 'h-4 w-4'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${sizeClass}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 6l12 12M18 6L6 18" /></svg>`;
}

/**
 * Chevron pointing down. Rotate it for the other directions rather than
 * shipping a second icon: `renderChevronIcon('h-3 w-3 rotate-180')`, or toggle
 * `rotate-180` on the element for an expand/collapse state.
 */
export function renderChevronIcon(sizeClass = 'h-4 w-4'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${sizeClass}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>`;
}

/**
 * Filled triangle pointing right, centred in its viewBox so rotating it stays
 * put: `rotate-180` for left, `-rotate-90` for up, `rotate-90` for down. Used
 * for the feed start/end markers and the added/removed service date markers.
 */
export function renderTriangleIcon(sizeClass = 'h-4 w-4'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${sizeClass}" fill="currentColor" viewBox="0 0 24 24"><path d="M8 6l8 6-8 6z" /></svg>`;
}

/**
 * Warning triangle, for a card or row that reports a problem with the feed.
 *
 * No caller here: this app's warnings render through `notification-system.ts`,
 * which draws its own. Kept so the file stays one copy across the three apps
 * rather than forking on an export.
 *
 * @lintignore
 */
export function renderWarningIcon(sizeClass = 'h-4 w-4'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${sizeClass}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>`;
}

/**
 * A modal list table whose body scrolls under a pinned header.
 *
 * Keeps the column headers visible with hundreds of rows; anything that must
 * stay reachable (an upload/add button) belongs after the returned markup, not
 * inside it.
 */
export function renderScrollableTable(
  headers: string[],
  rowsHtml: string,
  maxHeightClass = 'max-h-[55vh]'
): string {
  return `
    <div class="${maxHeightClass} overflow-y-auto">
      <table class="table table-sm table-pin-rows">
        <thead>
          <tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>`;
}

export interface ModalAction {
  label: string;
  className?: string;
  onClick: () => boolean | void | Promise<boolean | void>;
}

// Stack of currently-open showModal() modals, innermost last. Every open modal
// has its own document-level keydown listener, so all of them fire on a single
// Escape; only the topmost is allowed to act on it.
interface OpenModal {
  el: HTMLElement;
  close: () => void;
}

const modalStack: OpenModal[] = [];

function isTopmostModal(modal: HTMLElement): boolean {
  return modalStack[modalStack.length - 1]?.el === modal;
}

/** How many modals are open, used as a mark to close back down to. */
export function modalStackDepth(): number {
  return modalStack.length;
}

/**
 * True when an event landed outside the topmost modal, i.e. on the page or on
 * the modal it covers. Delegated document listeners use it to stay quiet while
 * a modal owns the keyboard, without disabling the content that modal renders
 * (the timetable is itself a modal).
 */
export function isOutsideTopModal(target: EventTarget | null): boolean {
  const top = modalStack[modalStack.length - 1];
  if (!top) {
    return false;
  }
  return !(target instanceof Node) || !top.el.contains(target);
}

// Everything inside a modal that Tab can land on, used to wrap focus at the
// ends rather than let it walk out onto the page behind.
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Close every modal opened after the stack reached `depth`, topmost first.
 *
 * The modal router uses this to take down a routed modal, along with anything
 * the modal itself stacked on top (a confirm, a picker), when the URL says the
 * modal is no longer open.
 */
export function closeModalsAbove(depth: number): void {
  while (modalStack.length > depth) {
    const top = modalStack[modalStack.length - 1];
    top.close();
    if (modalStack[modalStack.length - 1] === top) {
      console.error('[modal-utils] modal did not leave the stack on close');
      modalStack.pop();
    }
  }
}

/**
 * Show a DaisyUI modal and wait for the user to click an action.
 * Buttons are disabled while the action's onClick promise is pending.
 * If onClick returns true, the modal stays open (for validation failures).
 *
 * `enterAction`: index of the action triggered by Enter (skipped when focused
 *   element is a <button> or <textarea>).
 * `escapeAction`: index of the action triggered by Escape; also controls
 *   whether the X button is rendered.
 * `onMount`: called after the modal is in the DOM; receives a `close`
 *   callback so the mount handler can close the modal programmatically.
 */
export async function showModal(options: {
  title: string;
  body: string;
  actions: ModalAction[];
  actionBarContent?: string;
  onMount?: (close: () => void) => void;
  enterAction?: number;
  escapeAction?: number;
  boxClassName?: string;
}): Promise<void> {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal modal-open';
    modal.innerHTML = `
      <div class="modal-box relative max-h-[80vh] max-w-4xl w-11/12 flex flex-col outline-none focus:outline-none ${options.boxClassName ?? ''}" tabindex="-1">
        ${options.escapeAction !== undefined ? `<button class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2" data-dismiss>${renderCloseIcon()}</button>` : ''}
        <h3 class="font-bold text-lg">${options.title}</h3>
        <div class="flex-1 overflow-y-auto py-4">${options.body}</div>
        <div class="modal-action">
          ${options.actionBarContent ? `<div class="flex items-center gap-2 flex-1">${options.actionBarContent}</div>` : ''}
          ${options.actions
            .map(
              (a, i) =>
                `<button class="btn ${a.className ?? ''}" data-idx="${i}">${a.label}</button>`
            )
            .join('')}
        </div>
      </div>
    `;
    // Focus moves into the modal below; remember where it came from so closing
    // puts the user back on the control they opened it from.
    const opener = document.activeElement as HTMLElement | null;
    document.body.appendChild(modal);

    const close = () => {
      document.removeEventListener('keydown', onKeydown);
      const idx = modalStack.findIndex((entry) => entry.el === modal);
      if (idx !== -1) {
        modalStack.splice(idx, 1);
      }
      document.body.removeChild(modal);
      if (opener?.isConnected) {
        opener.focus({ preventScroll: true });
      }
      resolve();
    };

    modalStack.push({ el: modal, close });

    const triggerAction = async (idx: number): Promise<void> => {
      modal
        .querySelectorAll('button')
        .forEach((b) => ((b as HTMLButtonElement).disabled = true));
      const keepOpen = await options.actions[idx].onClick();
      if (keepOpen === true) {
        modal
          .querySelectorAll('button')
          .forEach((b) => ((b as HTMLButtonElement).disabled = false));
        return;
      }
      close();
    };

    // Keep Tab inside the modal. Without this it walks onto the page behind,
    // where Enter or Space would activate whatever it landed on - including the
    // button that opened this modal.
    const trapTab = (e: KeyboardEvent): void => {
      const focusable = Array.from(
        modal.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      );
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const inside = active instanceof Node && modal.contains(active);
      if (!inside) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    const onKeydown = (e: KeyboardEvent) => {
      // Let the modal stacked on top of this one handle the key instead.
      if (!isTopmostModal(modal)) {
        return;
      }
      if (e.key === 'Escape' && options.escapeAction !== undefined) {
        e.preventDefault();
        void triggerAction(options.escapeAction);
      } else if (
        e.key === 'Enter' &&
        options.enterAction !== undefined &&
        !(e.target instanceof HTMLButtonElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        void triggerAction(options.enterAction);
      } else if (e.key === 'Tab') {
        trapTab(e);
      }
    };

    document.addEventListener('keydown', onKeydown);

    if (options.escapeAction !== undefined) {
      modal
        .querySelector<HTMLButtonElement>('[data-dismiss]')
        ?.addEventListener(
          'click',
          () => void triggerAction(options.escapeAction!)
        );
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          void triggerAction(options.escapeAction!);
        }
      });
    }

    modal
      .querySelectorAll<HTMLButtonElement>('button[data-idx]')
      .forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.dataset.idx);
          void triggerAction(idx);
        });
      });

    // Default focus is the box itself, not an action button: a focused div is
    // neither a button nor a textarea, so `enterAction` still fires on Enter.
    // `outline-none` on the box keeps this from painting a focus ring around
    // the whole modal. Before onMount, so a caller that focuses a better
    // target still wins.
    modal
      .querySelector<HTMLElement>('.modal-box')
      ?.focus({ preventScroll: true });

    options.onMount?.(close);
  });
}
