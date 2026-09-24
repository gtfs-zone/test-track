/**
 * The right panel's object pages: one dispatcher over `PageState`.
 *
 * The host, meaning the breadcrumb header, the `data-nav` links, and the scroll
 * and `<details>` restore around each re-render, is `interlocking`'s
 * `PanelHost`. The panel re-renders on every realtime poll, which is every 15
 * seconds; what this adds is that trigger, the realtime index the pages read,
 * the live relative times, and the route-strip hover.
 */

import type { PageState } from '../types/page-state';
import type { BreadcrumbItem } from 'interlocking/ui/breadcrumb-trail';
import { PanelHost } from 'interlocking/ui/panel-host';
import type { FeedSession } from './feed-session';
import { RtIndex } from 'interlocking/gtfs/rt-index';
import type { RenderContext } from './render-context';
import { formatRelative } from 'interlocking/gtfs/entity-render';
import { renderAlertPage } from './pages/alert-page';
import { renderRoutePage } from './pages/route-page';
import { renderStopPage } from './pages/stop-page';
import { renderVehiclePage } from './pages/vehicle-page';

export interface PanelRendererHooks {
  /** Navigate to a page, as if the user had clicked it on the map. */
  navigate: (state: PageState) => void;
  /** The full hash for a page, so links are real links. */
  href: (state: PageState) => string;
  /** Light a stop on the map while its route-strip row is hovered. */
  hoverStop: (stop_id: string | null) => void;
}

export class PanelRenderer {
  private host: HTMLElement;
  private session: FeedSession;
  private hooks: PanelRendererHooks;
  private panel: PanelHost<PageState>;

  private hoveredStopId: string | null = null;

  /** Invalidated on every payload event; rebuilt lazily on the next render. */
  private index: RtIndex | null = null;

  constructor(host: HTMLElement, session: FeedSession, hooks: PanelRendererHooks) {
    this.host = host;
    this.session = session;
    this.hooks = hooks;
    this.panel = new PanelHost<PageState>(host, {
      navigate: hooks.navigate,
      href: hooks.href,
      renderPage: state => this.renderPage(state),
      tick: el => {
        el.querySelectorAll<HTMLElement>('[data-since]').forEach(since => {
          since.textContent = formatRelative(Number(since.dataset.since));
        });
      },
    });
  }

  initialize(): void {
    for (const event of ['vehicles', 'tripUpdates', 'alerts'] as const) {
      this.session.addEventListener(event, () => {
        this.index = null;
        this.panel.queueRender();
      });
    }

    this.panel.initialize();
    // pointerover/out bubble, unlike pointerenter/leave, so they can be
    // delegated to the panel host and survive every re-render.
    this.host.addEventListener('pointerover', e => this.onPointerOver(e));
    this.host.addEventListener('pointerout', e => this.onPointerOut(e));
  }

  destroy(): void {
    this.panel.destroy();
  }

  /** Take over the panel and render `state`. */
  show(state: PageState, breadcrumbs: BreadcrumbItem<PageState>[]): void {
    this.clearHoveredStop();
    this.panel.show(state, breadcrumbs);
  }

  /** Hand the panel back to the status page. */
  hide(): void {
    this.clearHoveredStop();
    this.panel.hide();
  }

  /**
   * Drop the hover light. A page change replaces the rows under the pointer,
   * so the `pointerout` that would normally clear it never arrives.
   */
  private clearHoveredStop(): void {
    if (this.hoveredStopId === null) return;
    this.hoveredStopId = null;
    this.hooks.hoverStop(null);
  }

  /** The stop_id of the strip row an event happened inside, if any. */
  private rowStopId(e: Event): string | null {
    const row = (e.target as HTMLElement | null)?.closest<HTMLElement>('.strip-stop-row');
    return row?.dataset.stopId ?? null;
  }

  private onPointerOver(e: Event): void {
    const stopId = this.rowStopId(e);
    if (!stopId || stopId === this.hoveredStopId) return;
    this.hoveredStopId = stopId;
    this.hooks.hoverStop(stopId);
  }

  private onPointerOut(e: Event): void {
    const stopId = this.rowStopId(e);
    if (!stopId || stopId !== this.hoveredStopId) return;
    // Moving between two children of the same row fires an out/over pair for
    // that row; only a pointer that actually left every row clears the light.
    const next = (e as PointerEvent).relatedTarget;
    if (next instanceof Element && next.closest('.strip-stop-row')) return;
    this.hoveredStopId = null;
    this.hooks.hoverStop(null);
  }

  /**
   * The realtime read-model for the current payloads, built on demand.
   *
   * Public because the status page reports feed-quality counters the index
   * computes, and it renders while this panel is inactive.
   */
  get rtIndex(): RtIndex {
    return (this.index ??= new RtIndex(this.session));
  }

  private renderPage(state: PageState): string {
    const ctx: RenderContext = { session: this.session, href: this.hooks.href };
    const index = this.rtIndex;
    switch (state.type) {
      case 'home':
        return '';
      case 'route':
        return renderRoutePage(ctx, index, state);
      case 'stop':
        return renderStopPage(ctx, index, state);
      case 'vehicle':
        return renderVehiclePage(ctx, index, state);
      case 'alert':
        return renderAlertPage(ctx, state);
    }
  }
}
