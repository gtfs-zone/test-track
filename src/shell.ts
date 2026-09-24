/**
 * Mounts the shared app shell. Imported first by `index.ts`, so the markup
 * exists before any other module is evaluated and looks up an element id.
 */

import { mountAppShell } from 'interlocking/ui/app-shell';

// The realtime refresh rate is a dropdown, so it sits beside the rendered
// action row rather than inside it.
const RT_INTERVAL_DROPDOWN = `
  <div id="rt-interval-dropdown" class="tooltip tooltip-bottom hidden" data-tip="Realtime refresh rate">
    <div class="dropdown dropdown-end">
      <label tabindex="0" class="btn btn-ghost btn-sm" aria-label="Realtime refresh rate">
        <span id="rt-interval-label">15s</span>
        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </label>
      <ul id="rt-interval-menu" tabindex="0" class="dropdown-content menu bg-base-200 rounded-box z-50 w-28 p-1 shadow-lg mt-1"></ul>
    </div>
  </div>`;

mountAppShell({
  brandPrefix: 'viz',
  brandSuffix: '.rt.gtfs.zone',
  navbarExtra: RT_INTERVAL_DROPDOWN,
  panelPlaceholder: 'No feed loaded',
  dock: [
    { id: 'dock-browse', label: 'Browse', active: true },
    { id: 'dock-alerts', label: 'Alerts', ariaLabel: 'Service alerts', badge: true },
    { id: 'dock-help', label: 'Help' },
  ],
});
