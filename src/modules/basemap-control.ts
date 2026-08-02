/* @vendored-from coloring-book:src/modules/basemap-control.ts
   @sha f9c718c
   @status modified
   @changes
   - Constructor takes an options object (initial basemap / projection / shape
     mode plus an `onAppearanceChange` callback) so the caller can restore and
     persist appearance; upstream hardcodes `standard` + `globe` and persists
     nothing.
   - The projection/sky block was duplicated three times upstream; it is now one
     `styleWithProjection()` helper.
   - `rebuildControl()` no longer leaks a `<style>` element per rebuild — the
     stylesheet is injected once, keyed by id.
   - `ShapeToggleControl` gained an initial mode and `setMode()`, needed to
     restore the persisted mode at boot.
   - Dropped the dead `parent` lookup in `rebuildControl` and the no-op keydown
     handler on the main FAB. */

/**
 * Basemap control UI component using DaisyUI FAB and speed dial
 */

import { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import { basemapStyles, getBasemapStyle } from './basemap-styles';

export type ShapeMode = 'shapes' | 'stops';
export type Projection = 'mercator' | 'globe';

export interface MapAppearance {
  basemap: string;
  projection: Projection;
  shapeMode: ShapeMode;
}

export interface BasemapControlOptions {
  initial?: Partial<MapAppearance>;
  onRenderModeChange?: (mode: ShapeMode) => void;
  /** Fired whenever any of basemap / projection / shape mode changes. */
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

/**
 * Toggle control for switching route render mode between GTFS shapes and
 * straight stop-to-stop lines. Owned by BasemapControl so it survives
 * basemap rebuilds with its state intact.
 */
export class ShapeToggleControl {
  private currentMode: ShapeMode;
  private readonly onModeChange: (mode: ShapeMode) => void;

  constructor(onModeChange: (mode: ShapeMode) => void, initialMode: ShapeMode = 'shapes') {
    this.onModeChange = onModeChange;
    this.currentMode = initialMode;
  }

  public getMode(): ShapeMode {
    return this.currentMode;
  }

  public setMode(mode: ShapeMode): void {
    this.currentMode = mode;
  }

  /** Returns the HTML string to inject into the BasemapControl container. */
  public render(): string {
    const checked = this.currentMode === 'shapes' ? 'checked' : '';
    return `
      <label class="swap swap-rotate btn btn-lg btn-circle btn-neutral shape-toggle-swap" title="Toggle route geometry (shapes / straight lines)">
        <input type="checkbox" class="shape-toggle-input" ${checked} />
        <!-- Shapes icon: wavy line (shown when checked = shapes mode) -->
        <svg class="swap-on w-6 h-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3 12c1.5-6 3-6 4.5 0s3 6 4.5 0 3-6 4.5 0 3 6 4.5 0"/>
        </svg>
        <!-- Stops icon: straight polyline with nodes (shown when unchecked = stops mode) -->
        <svg class="swap-off w-6 h-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 17l8-10 8 5"/>
          <circle cx="4" cy="17" r="1.5" fill="currentColor" stroke="none"/>
          <circle cx="12" cy="7" r="1.5" fill="currentColor" stroke="none"/>
          <circle cx="20" cy="12" r="1.5" fill="currentColor" stroke="none"/>
        </svg>
      </label>
    `;
  }

  /** Wire up the change listener after render() HTML has been inserted into the DOM. */
  public attachListener(container: HTMLElement): void {
    const input = container.querySelector('.shape-toggle-input') as HTMLInputElement | null;
    if (!input) {
      return;
    }
    input.addEventListener('change', e => {
      this.currentMode = (e.target as HTMLInputElement).checked ? 'shapes' : 'stops';
      this.onModeChange(this.currentMode);
    });
  }
}

export class BasemapControl {
  private map: MapLibreMap;
  private container: HTMLElement | null = null;
  private currentBasemap: string;
  private currentProjection: Projection;
  private shapeToggleControl: ShapeToggleControl | null = null;
  private onAppearanceChange: ((appearance: MapAppearance) => void) | null;

  constructor(map: MapLibreMap, options: BasemapControlOptions = {}) {
    this.map = map;
    this.currentBasemap = options.initial?.basemap ?? 'standard';
    this.currentProjection = options.initial?.projection ?? 'globe';
    this.onAppearanceChange = options.onAppearanceChange ?? null;

    if (options.onRenderModeChange) {
      const onChange = options.onRenderModeChange;
      this.shapeToggleControl = new ShapeToggleControl(mode => {
        onChange(mode);
        this.emitAppearance();
      }, options.initial?.shapeMode ?? 'shapes');
    }

    this.createControl();
    this.applyInitialProjection();
  }

  public getAppearance(): MapAppearance {
    return {
      basemap: this.currentBasemap,
      projection: this.currentProjection,
      shapeMode: this.shapeToggleControl?.getMode() ?? 'shapes',
    };
  }

  public getShapeMode(): ShapeMode {
    return this.shapeToggleControl?.getMode() ?? 'shapes';
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

      <!-- Globe/Mercator projection toggle -->
      <label class="swap swap-rotate btn btn-lg btn-circle btn-neutral projection-swap" title="Toggle projection">
        <input type="checkbox" class="projection-toggle" ${this.currentProjection === 'globe' ? 'checked' : ''} />
        <!-- Globe icon (when checked) -->
        <svg class="swap-on w-6 h-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
        </svg>
        <!-- Mercator/Map icon (when unchecked) -->
        <svg class="swap-off w-6 h-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
        </svg>
      </label>

      <!-- Shapes/Stops render mode toggle -->
      ${this.shapeToggleControl ? this.shapeToggleControl.render() : ''}
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

      .basemap-control .shape-toggle-swap {
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

    // Shape/stops render mode toggle
    if (this.shapeToggleControl) {
      this.shapeToggleControl.attachListener(this.container);
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
