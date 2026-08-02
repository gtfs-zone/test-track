/**
 * TEMPORARY. Plan 05 replaces this entire file with `panel-renderer.ts`.
 *
 * Just enough to prove the focus loop end-to-end: pick something, see the
 * breadcrumb trail and the object's raw GTFS columns. No route strip, no live
 * RT regions, no entity links — all of that is Plan 05's job.
 */

import type { RawRow } from '../gtfs-static';
import type { BreadcrumbItem, PageState } from '../types/page-state';
import { alertLabel, routeLabel, stopLabel, vehicleLabel } from './breadcrumbs';
import type { FeedSession } from './feed-session';

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderBreadcrumbs(items: BreadcrumbItem[]): string {
  if (items.length === 0) return '';
  return `
    <nav class="text-xs breadcrumbs opacity-70">
      <ul>${items.map(i => `<li>${escHtml(i.label)}</li>`).join('')}</ul>
    </nav>`;
}

/** Every column of the source row, verbatim, empty values marked explicitly. */
function renderRawFields(title: string, raw: RawRow): string {
  const rows = Object.entries(raw)
    .map(
      ([k, v]) =>
        `<tr><td class="opacity-60 align-top">${escHtml(k)}</td><td class="break-all">${
          v ? escHtml(v) : '<span class="opacity-30">(empty)</span>'
        }</td></tr>`,
    )
    .join('');
  return `
    <section class="space-y-2">
      <h3 class="font-semibold text-sm">${escHtml(title)}</h3>
      <table class="table table-xs"><tbody>${rows}</tbody></table>
    </section>`;
}

function renderMissing(what: string): string {
  return `<p class="text-sm opacity-60">${escHtml(what)} is no longer in the feed.</p>`;
}

function renderBody(session: FeedSession, state: PageState): string {
  switch (state.type) {
    case 'home':
      return '';

    case 'route': {
      const route = session.staticFeed?.routes.get(state.route_id);
      if (!route) return renderMissing(`Route ${state.route_id}`);
      return renderRawFields('routes.txt', route.raw);
    }

    case 'stop': {
      const stop = session.staticFeed?.stops.get(state.stop_id);
      if (!stop) return renderMissing(`Stop ${state.stop_id}`);
      return renderRawFields('stops.txt', stop.raw);
    }

    case 'vehicle': {
      const vehicle = session.vehicles.get(state.vehicle_id);
      if (!vehicle) return renderMissing(`Vehicle ${state.vehicle_id}`);
      return renderRawFields('VehiclePosition', {
        id: vehicle.id,
        entity_id: vehicle.entityId,
        label: vehicle.label ?? '',
        latitude: String(vehicle.lat),
        longitude: String(vehicle.lon),
        bearing: vehicle.bearing === undefined ? '' : String(vehicle.bearing),
        trip_id: vehicle.tripId ?? '',
        route_id: vehicle.routeId ?? '',
      });
    }

    case 'alert': {
      const record = session.alerts.get(state.alert_id);
      if (!record) return renderMissing(`Alert ${state.alert_id}`);
      return `
        <section class="space-y-2">
          <h3 class="font-semibold text-sm">Alert</h3>
          <pre class="text-xs bg-base-200 rounded p-2 overflow-x-auto">${escHtml(
            JSON.stringify(record.alert, null, 2),
          )}</pre>
        </section>`;
    }
  }
}

function headerLabel(session: FeedSession, state: PageState): string {
  switch (state.type) {
    case 'home':
      return '';
    case 'route':
      return routeLabel(session, state.route_id);
    case 'stop':
      return stopLabel(session, state.stop_id);
    case 'vehicle':
      return vehicleLabel(session, state.vehicle_id);
    case 'alert':
      return alertLabel(session, state.alert_id);
  }
}

export function renderPlaceholderPage(
  session: FeedSession,
  state: PageState,
  breadcrumbs: BreadcrumbItem[],
): string {
  return `
    <div class="space-y-4">
      ${renderBreadcrumbs(breadcrumbs)}
      <div>
        <p class="text-xs uppercase tracking-wide opacity-50">${escHtml(state.type)}</p>
        <h2 class="text-lg font-semibold">${escHtml(headerLabel(session, state))}</h2>
      </div>
      ${renderBody(session, state)}
    </div>`;
}
