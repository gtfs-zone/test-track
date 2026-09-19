/**
 * The right panel's object pages: one dispatcher over `PageState`, plus the
 * furniture every page shares.
 *
 * The panel re-renders on every realtime poll, which is every 15 seconds. A
 * naive `innerHTML =` would bounce the reader to the top of a 60-stop route
 * strip and slam shut every raw-column table they had opened, so scroll
 * position is captured and restored around each render and open `<details>` are
 * tracked by key in a set that outlives the DOM.
 */

import type { PageState } from '../types/page-state';
import type { BreadcrumbItem } from 'interlocking/ui/breadcrumb-trail';
import { renderBreadcrumbTrail } from 'interlocking/ui/breadcrumb-trail';
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

  private state: PageState = { type: 'home' };
  private breadcrumbs: BreadcrumbItem<PageState>[] = [];
  private active = false;
  private hoveredStopId: string | null = null;

  /** Invalidated on every payload event; rebuilt lazily on the next render. */
  private index: RtIndex | null = null;
  private openDetails = new Set<string>();
  private tickerId: ReturnType<typeof setInterval> | null = null;
  private renderQueued = false;

  constructor(host: HTMLElement, session: FeedSession, hooks: PanelRendererHooks) {
    this.host = host;
    this.session = session;
    this.hooks = hooks;
  }

  initialize(): void {
    for (const event of ['vehicles', 'tripUpdates', 'alerts'] as const) {
      this.session.addEventListener(event, () => {
        this.index = null;
        this.queueRender();
      });
    }

    // Delegated so the handlers survive every re-render.
    this.host.addEventListener('click', e => this.onClick(e));
    this.host.addEventListener('toggle', e => this.onToggle(e), true);
    // pointerover/out bubble, unlike pointerenter/leave, so they can be
    // delegated to the panel host the same way.
    this.host.addEventListener('pointerover', e => this.onPointerOver(e));
    this.host.addEventListener('pointerout', e => this.onPointerOut(e));

    this.tickerId = setInterval(() => this.tick(), 1000);
  }

  destroy(): void {
    if (this.tickerId !== null) clearInterval(this.tickerId);
    this.tickerId = null;
  }

  /** Take over the panel and render `state`. */
  show(state: PageState, breadcrumbs: BreadcrumbItem<PageState>[]): void {
    this.clearHoveredStop();
    this.state = state;
    this.breadcrumbs = breadcrumbs;
    this.active = true;
    // A different object is a different page: start it at the top rather than
    // inheriting the previous page's scroll offset.
    this.render(true);
  }

  /** Hand the panel back to the status page. */
  hide(): void {
    this.clearHoveredStop();
    this.active = false;
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

  private onClick(e: Event): void {
    const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-nav]');
    if (!target) return;
    // Let modified clicks do what the browser would do with a normal link.
    const mouse = e as MouseEvent;
    if (mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.button !== 0) return;
    e.preventDefault();
    this.hooks.navigate(JSON.parse(target.dataset.nav!) as PageState);
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

  private onToggle(e: Event): void {
    const el = e.target as HTMLDetailsElement;
    const key = el.dataset?.detail;
    if (!key) return;
    if (el.open) this.openDetails.add(key);
    else this.openDetails.delete(key);
  }

  private queueRender(): void {
    if (!this.active || this.renderQueued) return;
    this.renderQueued = true;
    queueMicrotask(() => {
      this.renderQueued = false;
      this.render(false);
    });
  }

  private tick(): void {
    if (!this.active) return;
    this.host.querySelectorAll<HTMLElement>('[data-since]').forEach(el => {
      el.textContent = formatRelative(Number(el.dataset.since));
    });
  }

  private render(resetScroll: boolean): void {
    if (!this.active) return;

    const scroll = this.host.scrollTop;
    const ctx: RenderContext = { session: this.session, href: this.hooks.href };

    this.host.innerHTML = `
      <div class="space-y-4">
        ${renderBreadcrumbTrail(this.breadcrumbs, this.hooks.href)}
        ${this.renderPage(ctx)}
      </div>`;

    // Re-open whatever the reader had opened, then put them back where they
    // were — in that order, since opening a table changes the scroll height.
    this.host.querySelectorAll<HTMLDetailsElement>('[data-detail]').forEach(el => {
      if (this.openDetails.has(el.dataset.detail!)) el.open = true;
    });
    this.host.scrollTop = resetScroll ? 0 : scroll;
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

  private renderPage(ctx: RenderContext): string {
    const index = this.rtIndex;
    switch (this.state.type) {
      case 'home':
        return '';
      case 'route':
        return renderRoutePage(ctx, index, this.state);
      case 'stop':
        return renderStopPage(ctx, index, this.state);
      case 'vehicle':
        return renderVehiclePage(ctx, index, this.state);
      case 'alert':
        return renderAlertPage(ctx, this.state);
    }
  }
}
