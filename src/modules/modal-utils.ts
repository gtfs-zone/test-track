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
}): Promise<void> {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal modal-open';
    modal.innerHTML = `
      <div class="modal-box relative max-h-[80vh] flex flex-col">
        ${options.escapeAction !== undefined ? '<button class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2" data-dismiss>✕</button>' : ''}
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
