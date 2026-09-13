/**
 * This app's keyboard commands.
 *
 * `keyboard-shortcuts.ts` is shared across the three apps and holds no list of
 * its own; each app supplies one. A viewer's plausible set is small on purpose:
 * there is no export, no undo and no patch manager here, so nothing in this
 * list is a shortcut to a feature that does not exist.
 */

import type { ShortcutCommand } from './keyboard-shortcuts';

interface ShortcutHost {
  /** Open the load modal and load whatever it returns. */
  openLoadModal: () => Promise<void>;
  /** Open the guide, through the modal router so the hash names it. */
  openGuide: () => void;
  /** Drop the search text and its result list. */
  clearSearch: () => void;
}

export function viewerShortcuts(host: ShortcutHost): ShortcutCommand[] {
  return [
    {
      keys: 'ctrl+o',
      description: 'Open the load feed dialog',
      handler: e => {
        e?.preventDefault();
        return host.openLoadModal();
      },
    },
    // Two keys for one action: `/` is the map convention and Ctrl+K the
    // command-palette one, and neither is worth making the user guess.
    {
      keys: '/',
      description: 'Focus map search',
      handler: e => {
        e?.preventDefault();
        focusMapSearch();
      },
    },
    {
      keys: 'ctrl+k',
      description: 'Focus map search',
      handler: e => {
        e?.preventDefault();
        focusMapSearch();
      },
    },
    // Allowed in input fields: Escape from inside the search box is the main
    // way this one is pressed.
    {
      keys: 'escape',
      description: 'Clear the search',
      allowInInputFields: true,
      handler: () => {
        (document.getElementById('map-search') as HTMLInputElement | null)?.blur();
        host.clearSearch();
      },
    },
    // `?` is Shift+/, so the normalized key string carries the modifier.
    {
      keys: 'shift+?',
      description: 'Show the guide',
      handler: e => {
        e?.preventDefault();
        host.openGuide();
      },
    },
  ];
}

function focusMapSearch(): void {
  const mapSearch = document.getElementById('map-search') as HTMLInputElement | null;
  mapSearch?.focus();
  mapSearch?.select();
}
