/* @vendored-from coloring-book:src/modules/basemap-control.ts
   @sha dca23b3
   @status modified
   @changes
   - Constructor takes an options object (initial basemap / projection plus an
     `onAppearanceChange` callback) so the caller can restore and persist
     appearance; upstream hardcodes `standard` + `globe` and persists nothing.
   - The projection/sky block was duplicated three times upstream; it is now one
     `styleWithProjection()` helper.
   - `rebuildControl()` no longer leaks a `<style>` element per rebuild — the
     stylesheet is injected once, keyed by id.
   - Dropped the dead `parent` lookup in `rebuildControl` and the no-op keydown
     handler on the main FAB.
   - `a57ada5` (always use the globe projection) not taken: it deletes the
     projection toggle, `changeProjection` and the projection state field.
     This app persists the projection as half of `MapAppearance` and still
     offers the toggle, so taking that commit would remove a feature rather
     than re-sync one. Everything else through `dca23b3` is applied. */

/**
 * Basemap control UI component using DaisyUI FAB and speed dial
 */

import { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import { basemapStyles, getBasemapStyle } from './basemap-styles';

export type Projection = 'mercator' | 'globe';

export interface MapAppearance {
  basemap: string;
  projection: Projection;
}

export interface BasemapControlOptions {
  initial?: Partial<MapAppearance>;
  /** Fired whenever either basemap or projection changes. */
  onAppearanceChange?: (appearance: MapAppearance) => void;
}

const SKY = {
  'sky-color': '#199EF3',
  'sky-horizon-blend': 0.5,
  'horizon-color': '#ffffff',
  'horizon-fog-blend': 0.5,
  'fog-color': '#0000ff',
  'fog-ground-blend': 0.5,
  'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 10, 1, 12, 0],
};

/**
 * Merge projection + sky into a style spec. `sky` must be explicitly cleared
 * (not just left off) when leaving globe, or MapLibre keeps rendering the
 * atmosphere over a mercator map.
 */
function styleWithProjection(
  style: Record<string, unknown>,
  projection: Projection,
): StyleSpecification {
  return {
    ...style,
    projection: { type: projection },
    sky: projection === 'globe' ? SKY : undefined,
  } as unknown as StyleSpecification;
}

/**
 * The style the map should be constructed with, so the very first paint is
 * already the persisted basemap and projection. Without this the control would
 * have to `setStyle` right after load, which destroys any layers added in
 * between.
 */
export function initialMapStyle(appearance: Partial<MapAppearance>): StyleSpecification {
  const basemap = getBasemapStyle(appearance.basemap ?? 'standard') ?? basemapStyles[0];
  return styleWithProjection(basemap.style, appearance.projection ?? 'globe');
}

const CONTROL_STYLE_ID = 'basemap-control-styles';

export class BasemapControl {
  private map: MapLibreMap;
  private container: HTMLElement | null = null;
  private currentBasemap: string;
  private currentProjection: Projection;
  private onAppearanceChange: ((appearance: MapAppearance) => void) | null;

  constructor(map: MapLibreMap, options: BasemapControlOptions = {}) {
    this.map = map;
    this.currentBasemap = options.initial?.basemap ?? 'standard';
    this.currentProjection = options.initial?.projection ?? 'globe';
    this.onAppearanceChange = options.onAppearanceChange ?? null;

    this.createControl();
    this.applyInitialProjection();
  }

  public getAppearance(): MapAppearance {
    return {
      basemap: this.currentBasemap,
      projection: this.currentProjection,
    };
  }

  private emitAppearance(): void {
    this.onAppearanceChange?.(this.getAppearance());
  }

  /**
   * Apply the projection to whatever style the map booted with. Skipped when
   * the map was constructed from `initialStyle()`, which already carries it —
   * `setStyle` here would destroy any layers added in the meantime.
   */
  private applyInitialProjection(): void {
    const apply = () => {
      const current = this.map.getStyle() as unknown as Record<string, unknown> | undefined;
      if (!current) return;
      const projection = current.projection as { type?: string } | undefined;
      if (projection?.type === this.currentProjection) return;
      this.map.setStyle(styleWithProjection(current, this.currentProjection));
    };

    if (this.map.isStyleLoaded()) {
      apply();
    } else {
      this.map.once('load', apply);
    }
  }

  /**
   * Create the basemap control UI
   */
  private createControl(): void {
    // Create container
    this.container = document.createElement('div');
    this.container.className = 'basemap-control';
    this.container.style.cssText = `
      position: absolute;
      bottom: 40px;
      right: 10px;
      display: flex;
      gap: 12px;
      align-items: flex-end;
      flex-direction: row;
      pointer-events: none;
    `;

    // Get current basemap
    const currentStyle = basemapStyles.find(s => s.id === this.currentBasemap);
    const otherStyles = basemapStyles.filter(s => s.id !== this.currentBasemap);

    // Create FAB structure with vertical labeled layout
    this.container.innerHTML = `
      <div class="fab">
        <!-- Main FAB button (shows current basemap) -->
        <div tabindex="0" role="button" class="btn btn-lg btn-circle btn-neutral basemap-fab-main">
          ${currentStyle?.icon || basemapStyles[0].icon}
        </div>

        <!-- Main Action button (appears when FAB is open) -->
        <button class="fab-main-action btn btn-circle btn-lg btn-neutral basemap-current" data-basemap="${this.currentBasemap}" title="${currentStyle?.name || 'Standard'}">
          ${currentStyle?.icon || basemapStyles[0].icon}
        </button>

        <!-- Other basemap buttons with labels -->
        ${otherStyles
          .map(
            style => `
          <div class="flex items-center gap-2">
            <span class="bg-base-100 text-base-content text-sm px-2 py-1 rounded-lg shadow whitespace-nowrap">${style.name}</span>
            <button class="btn btn-lg btn-circle btn-base-100 basemap-btn" data-basemap="${style.id}">
              ${style.icon}
            </button>
          </div>
        `,
          )
          .join('')}
      </div>

      <!-- Globe/flat projection toggle -->
      <label class="swap swap-rotate btn btn-lg btn-circle btn-neutral projection-swap" title="Toggle globe / flat projection" aria-label="Toggle globe / flat projection">
        <input type="checkbox" class="projection-toggle" ${this.currentProjection === 'globe' ? 'checked' : ''} />
        <!-- Globe icon (when checked) -->
        <svg class="swap-on w-6 h-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <circle cx="12" cy="12" r="9" />
          <path stroke-linecap="round" d="M3 12h18" />
          <path d="M12 3a4.5 9 0 010 18a4.5 9 0 010-18" />
        </svg>
        <!-- Flat graticule icon (when unchecked) -->
        <svg class="swap-off w-6 h-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path stroke-linecap="round" d="M9 5v14M15 5v14M3 9.667h18M3 14.333h18" />
        </svg>
      </label>
    `;

    this.injectStyles();
    this.attachEventListeners();

    // Add to map container
    const mapContainer = this.map.getContainer();

    // Ensure map container has position relative for absolute positioning to work
    const computedStyle = window.getComputedStyle(mapContainer);
    if (computedStyle.position === 'static') {
      mapContainer.style.position = 'relative';
    }

    mapContainer.appendChild(this.container);
  }

  /** Injected once — `rebuildControl` runs on every basemap change. */
  private injectStyles(): void {
    if (document.getElementById(CONTROL_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = CONTROL_STYLE_ID;
    style.textContent = `
      .basemap-control .fab {
        position: relative;
        inset-inline-end: 0;
        bottom: auto;
        pointer-events: none;
      }

      .basemap-control .fab button,
      .basemap-control .fab [role="button"],
      .basemap-control .fab label {
        pointer-events: auto;
      }

      .basemap-control .projection-swap {
        flex-shrink: 0;
        pointer-events: auto;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Attach event listeners for basemap selection and projection toggle
   */
  private attachEventListeners(): void {
    if (!this.container) {
      return;
    }

    // Basemap selection buttons (plus the current one in the FAB centre)
    this.container.querySelectorAll('.basemap-btn, .basemap-current').forEach(button => {
      button.addEventListener('click', () => {
        const basemapId = (button as HTMLElement).getAttribute('data-basemap');
        if (basemapId) {
          this.changeBasemap(basemapId);
        }
      });
    });

    // Projection toggle
    const projectionToggle = this.container.querySelector('.projection-toggle');
    if (projectionToggle) {
      projectionToggle.addEventListener('change', e => {
        const isGlobe = (e.target as HTMLInputElement).checked;
        this.changeProjection(isGlobe ? 'globe' : 'mercator');
      });
    }
  }

  /**
   * Swap the style, restore the view once it lands, and tell everyone else to
   * re-add their layers — `setStyle` drops every source and layer we own.
   */
  private applyStyle(style: StyleSpecification, detail: Record<string, unknown>): void {
    const center = this.map.getCenter();
    const zoom = this.map.getZoom();
    const bearing = this.map.getBearing();
    const pitch = this.map.getPitch();

    this.map.setStyle(style);

    this.map.once('styledata', () => {
      this.map.setCenter(center);
      this.map.setZoom(zoom);
      this.map.setBearing(bearing);
      this.map.setPitch(pitch);
      this.map.fire('basemap:changed', detail);
    });
  }

  /**
   * Change the basemap style
   */
  private changeBasemap(basemapId: string): void {
    // Skip if already on this basemap
    if (basemapId === this.currentBasemap) {
      return;
    }

    const basemapStyle = getBasemapStyle(basemapId);
    if (!basemapStyle) {
      console.error(`Basemap style not found: ${basemapId}`);
      return;
    }

    this.applyStyle(styleWithProjection(basemapStyle.style, this.currentProjection), {
      basemapId,
    });

    this.currentBasemap = basemapId;
    this.rebuildControl();
    this.emitAppearance();
  }

  /**
   * Rebuild the control UI to reflect new basemap selection
   */
  private rebuildControl(): void {
    if (!this.container) {
      return;
    }
    this.container.remove();
    this.createControl();
  }

  /**
   * Change map projection (globe vs mercator)
   */
  private changeProjection(projection: Projection): void {
    this.currentProjection = projection;

    const currentStyle = this.map.getStyle() as unknown as Record<string, unknown> | undefined;
    if (!currentStyle) {
      return;
    }

    this.applyStyle(styleWithProjection(currentStyle, projection), { projection });
    this.emitAppearance();
  }

  /**
   * Get current basemap ID
   */
  public getCurrentBasemap(): string {
    return this.currentBasemap;
  }

  /**
   * Programmatically set basemap
   */
  public setBasemap(basemapId: string): void {
    this.changeBasemap(basemapId);
  }

  /**
   * Remove the control from the map
   */
  public destroy(): void {
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;
  }
}
