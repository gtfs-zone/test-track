export function renderTrashIcon(sizeClass = 'h-4 w-4'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${sizeClass}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>`;
}

export function renderUploadIcon(sizeClass = 'h-4 w-4'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${sizeClass}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>`;
}

export function renderCloseIcon(sizeClass = 'h-4 w-4'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${sizeClass}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 6l12 12M18 6L6 18" /></svg>`;
}

/**
 * Filled triangle pointing right, centred in its viewBox so rotating it stays
 * put: `rotate-180` for left, `-rotate-90` for up, `rotate-90` for down.
 */
export function renderTriangleIcon(sizeClass = 'h-4 w-4'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${sizeClass}" fill="currentColor" viewBox="0 0 24 24"><path d="M8 6l8 6-8 6z" /></svg>`;
}

export function renderWarningIcon(sizeClass = 'h-4 w-4'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${sizeClass}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>`;
}

export interface ModalAction {
  label: string;
  className?: string;
  onClick: () => boolean | void | Promise<boolean | void>;
}

/**
 * Show a DaisyUI modal and wait for the user to click an action.
 * Buttons are disabled while the action's onClick promise is pending.
 * If onClick returns true, the modal stays open (for validation failures).
 *
 * `enterAction` — index of the action triggered by Enter (skipped when focused
 *   element is a <button> or <textarea>).
 * `escapeAction` — index of the action triggered by Escape; also controls
 *   whether the X button is rendered.
 * `onMount` — called after the modal is in the DOM; receives a `close`
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
      <div class="modal-box relative max-h-[80vh] max-w-4xl w-11/12 flex flex-col ${options.boxClassName ?? ''}">
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
    document.body.appendChild(modal);

    const close = () => {
      document.removeEventListener('keydown', onKeydown);
      document.body.removeChild(modal);
      resolve();
    };

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

    const onKeydown = (e: KeyboardEvent) => {
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

    options.onMount?.(close);
  });
}
