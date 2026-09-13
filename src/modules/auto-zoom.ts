/* @vendored-from coloring-book:src/modules/auto-zoom.ts
   @sha ec21487
   @status verbatim */
/**
 * The auto-zoom-to-selection preference, its persistence, its camera gates and
 * its map-tool control.
 *
 * No app imports: MapLibre types only. The holder takes the refit callback as
 * a constructor argument, so each app supplies its own "move the camera to
 * whatever is focused right now" (`refitFocusedObject()` in the editor,
 * `applyFocus(current)` in the viewers).
 *
 * The gates cover navigation-driven camera moves only. Moves that are meant to
 * happen whether or not the toggle is on call the map directly and bypass this
 * module: the fit after a feed loads, the fit that restores the view on a
 * resize, and the zoom nudge when a stop is added. A downstream implementer
 * porting this cannot tell that from the module alone, hence this note.
 */

import type {
  Map as MapLibreMap,
  LngLatBounds,
  FitBoundsOptions,
  FlyToOptions,
  EaseToOptions,
} from 'maplibre-gl';

/** Persisted user preference: whether navigation moves the camera. */
const AUTO_ZOOM_KEY = 'map.autoZoom';

function readAutoZoomPref(): boolean {
  try {
    return localStorage.getItem(AUTO_ZOOM_KEY) !== '0';
  } catch {
    return true;
  }
}

function writeAutoZoomPref(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_ZOOM_KEY, enabled ? '1' : '0');
  } catch {
    console.warn('[AutoZoom] could not persist the auto-zoom preference');
  }
}

export class AutoZoom {
  private enabled = readAutoZoomPref();
  private refit: () => void;

  constructor(refit: () => void) {
    this.refit = refit;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Turn navigation-driven camera movement on or off. Turning it on refits to
   * whatever is currently focused, so the button has an immediate effect
   * instead of waiting for the next navigation.
   */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    writeAutoZoomPref(enabled);
    if (enabled) {
      this.refit();
    }
  }

  /**
   * Camera move driven by navigation. Suppressed while auto-zoom is off, so
   * the highlight side effects around the call still run.
   */
  public fitBounds(
    map: MapLibreMap,
    bounds: LngLatBounds,
    options: FitBoundsOptions
  ): void {
    if (!this.enabled) {
      return;
    }
    map.fitBounds(bounds, options);
  }

  public flyTo(map: MapLibreMap, options: FlyToOptions): void {
    if (!this.enabled) {
      return;
    }
    map.flyTo(options);
  }

  /**
   * No caller here: this app flies where the two viewers ease. Kept so the
   * file stays one copy across the three apps rather than forking on a method.
   */
  public easeTo(map: MapLibreMap, options: EaseToOptions): void {
    if (!this.enabled) {
      return;
    }
    map.easeTo(options);
  }
}

const TIP_ON = 'Auto-zoom to selection';
const TIP_OFF = 'Auto-zoom off (map stays put)';

/** The map-tool card holding the toggle. Append to the map control row. */
export function renderAutoZoomControl(): string {
  return (
    '<div class="card card-bordered bg-base-100 shadow-lg p-1 flex-shrink-0">' +
    `<div id="auto-zoom-tooltip" class="tooltip tooltip-bottom" data-tip="${TIP_ON}">` +
    '<label id="auto-zoom-btn" class="swap btn btn-sm btn-square btn-primary">' +
    '<input type="checkbox" id="auto-zoom-toggle" checked />' +
    '<svg class="swap-on h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />' +
    '<path d="M12 17.5c1.9-2.4 2.9-4.2 2.9-5.6a2.9 2.9 0 1 0-5.8 0c0 1.4 1 3.2 2.9 5.6z" />' +
    '</svg>' +
    '<svg class="swap-off h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />' +
    '<rect x="9" y="12.5" width="6" height="4.5" rx="1" />' +
    '<path d="M10.5 12.5v-1.5a1.5 1.5 0 0 1 3 0v1.5" />' +
    '</svg>' +
    '</label>' +
    '</div>' +
    '</div>'
  );
}

/** Paint the control to match the preference. Boot included, not just toggles. */
export function syncAutoZoomControl(enabled: boolean): void {
  const toggle = document.getElementById(
    'auto-zoom-toggle'
  ) as HTMLInputElement | null;
  if (toggle) {
    toggle.checked = enabled;
  }
  document
    .getElementById('auto-zoom-btn')
    ?.classList.toggle('btn-primary', enabled);
  document
    .getElementById('auto-zoom-tooltip')
    ?.setAttribute('data-tip', enabled ? TIP_ON : TIP_OFF);
}

/** Wire the rendered control to the holder. */
export function wireAutoZoomControl(autoZoom: AutoZoom): void {
  document
    .getElementById('auto-zoom-toggle')
    ?.addEventListener('change', (e) => {
      const enabled = (e.target as HTMLInputElement).checked;
      autoZoom.setEnabled(enabled);
      syncAutoZoomControl(enabled);
    });
}
