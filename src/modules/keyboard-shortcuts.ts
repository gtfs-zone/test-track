/* @vendored-from coloring-book:src/modules/keyboard-shortcuts.ts
   @sha d8afa32
   @status verbatim */
import { notify } from './notification-system';
import { isOutsideTopModal } from './modal-utils';

/**
 * One keyboard command. `keys` is a normalized key string as
 * `getKeyString` builds it: modifiers in the order ctrl, alt, shift, then the
 * key itself, joined with `+` (`ctrl+shift+z`, `escape`, `f1`).
 */
export interface ShortcutCommand {
  keys: string;
  description: string;
  handler: (e?: Event) => void | Promise<void>;
  /** Fire even while a text field or CodeMirror has focus. */
  allowInInputFields?: boolean;
}

/**
 * Binds a list of keyboard commands to the document.
 *
 * The class holds no commands of its own: each app passes its own list, so the
 * only thing here is the dispatch — the key string, the input-field and
 * top-modal guards, and the error toast for a handler that rejects.
 */
export class KeyboardShortcuts {
  private shortcuts = new Map<string, ShortcutCommand>();
  private initialized = false;
  private isActive: () => boolean;

  /**
   * @param commands the app's command list
   * @param isActive gate for the whole dispatch, so an app that only owns the
   *   keyboard some of the time (a tab lock) can say when
   */
  constructor(
    commands: ShortcutCommand[],
    isActive: () => boolean = () => true
  ) {
    for (const command of commands) {
      this.shortcuts.set(command.keys, command);
    }
    this.isActive = isActive;
  }

  initialize() {
    if (this.initialized) {
      return;
    }

    this.bindEventListeners();
    this.initialized = true;
  }

  bindEventListeners() {
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (!this.isActive()) {
        return;
      }
      // A modal on top owns the keyboard. Keyed on the target rather than on
      // "any modal is open" so the shortcuts still work inside a modal that
      // hosts real content, like the timetable.
      if (isOutsideTopModal(e.target)) {
        return;
      }
      const key = this.getKeyString(e);
      const shortcut = this.shortcuts.get(key);

      if (shortcut) {
        // Don't trigger shortcuts if user is typing in an input field
        const activeElement = document.activeElement;
        const isInputField =
          activeElement &&
          (activeElement.tagName === 'INPUT' ||
            activeElement.tagName === 'TEXTAREA' ||
            (activeElement as HTMLElement).contentEditable === 'true' ||
            activeElement.classList.contains('cm-content')); // CodeMirror editor

        if (!isInputField || shortcut.allowInInputFields) {
          void Promise.resolve(shortcut.handler(e)).catch((error: unknown) =>
            notify.error(
              `${shortcut.description} failed: ${error instanceof Error ? error.message : String(error)}`
            )
          );
        }
      }
    });
  }

  getKeyString(e: KeyboardEvent): string {
    const parts: string[] = [];

    if (e.ctrlKey || e.metaKey) {
      parts.push('ctrl');
    }
    if (e.altKey) {
      parts.push('alt');
    }
    if (e.shiftKey) {
      parts.push('shift');
    }

    const key = e.key.toLowerCase();

    // Handle special keys
    const specialKeys: Record<string, string> = {
      ' ': 'space',
      enter: 'enter',
      tab: 'tab',
      escape: 'escape',
      backspace: 'backspace',
      delete: 'delete',
      arrowup: 'up',
      arrowdown: 'down',
      arrowleft: 'left',
      arrowright: 'right',
    };

    parts.push(specialKeys[key] || key);

    return parts.join('+');
  }

  destroy() {
    // Clean up event listeners if needed
    this.initialized = false;
  }
}

/**
 * The command list as the guide's Keyboard Shortcuts page wants it: display
 * key strings, sorted by description. Takes the list rather than an instance
 * so a help page renders its own app's commands.
 */
export function describeShortcuts(
  commands: ShortcutCommand[]
): Array<{ key: string; description: string }> {
  return commands
    .map((command) => ({
      key: formatKeyForDisplay(command.keys),
      description: command.description,
    }))
    .sort((a, b) => a.description.localeCompare(b.description));
}

function formatKeyForDisplay(keyString: string): string {
  return keyString
    .split('+')
    .map((part: string) => {
      const capitalizeMap: Record<string, string> = {
        ctrl: 'Ctrl',
        alt: 'Alt',
        shift: 'Shift',
        meta: 'Cmd',
        escape: 'Esc',
        enter: 'Enter',
        tab: 'Tab',
        space: 'Space',
        backspace: 'Backspace',
        delete: 'Delete',
      };
      return capitalizeMap[part] || part.toUpperCase();
    })
    .join('+');
}
