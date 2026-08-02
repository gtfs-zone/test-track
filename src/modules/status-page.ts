import type { EndpointStatus } from '../gtfs-rt';
import type { FeedSession } from './feed-session';
import type { MapDataIssues } from './layer-manager';
import type { RealtimeEndpointName } from './feed-selection';
import { REALTIME_ENDPOINTS, REALTIME_ENDPOINT_LABELS } from './feed-selection';
import { localClock } from './feed-time';
import { isReproducible } from './feed-url';
import { notify } from './notification-system';

/**
 * The right panel's "nothing focused" content: what is loaded, how much of it,
 * when each endpoint was last fetched, and an inline editor for every URL.
 */

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Poll times are facts about this browser, not about the railroad, so they stay
 * in the reader's zone — labelled, so they read as distinct from the feed clock
 * used on the object pages.
 */
function formatClock(ms: number | null): string {
  if (!ms) return '—';
  return localClock(ms);
}

/** "12s ago" / "3m ago" — rendered by the shared ticker, not per-row timers. */
function formatRelative(ms: number): string {
  const secs = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s ago`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m ago`;
}

function formatCountdown(target: number): string {
  const secs = Math.round((target - Date.now()) / 1000);
  return secs <= 0 ? 'now' : `${secs}s`;
}

function statTile(label: string, value: number | string): string {
  return `
    <div class="rounded-lg bg-base-200 px-3 py-2">
      <p class="text-xs opacity-60">${escHtml(label)}</p>
      <p class="text-lg font-semibold tabular-nums">${escHtml(String(value))}</p>
    </div>`;
}

function renderCounts(session: FeedSession): string {
  const s = session.staticFeed?.counts();
  const rt = session.rtCounts;
  return `
    <section class="space-y-2">
      <h3 class="font-semibold text-sm">Counts</h3>
      <div class="grid grid-cols-3 gap-2">
        ${statTile('Stops', s?.stops ?? 0)}
        ${statTile('Routes', s?.routes ?? 0)}
        ${statTile('Trips', s?.trips ?? 0)}
        ${statTile('Shapes', s?.shapes ?? 0)}
        ${statTile('Agencies', s?.agencies ?? 0)}
        ${statTile('Services', s?.services ?? 0)}
        ${statTile('Stop times', s?.stopTimes ?? 0)}
        ${statTile('Vehicles', rt.vehicles)}
        ${statTile('Trip updates', rt.tripUpdates)}
        ${statTile('Alerts', rt.alerts)}
      </div>
    </section>`;
}

/** `data-since` / `data-until` are driven by the single shared ticker below. */
function renderEndpoint(ep: EndpointStatus, nextPollAt: number | null): string {
  const label = REALTIME_ENDPOINT_LABELS[ep.name];

  const fetched = ep.lastFetchedAt
    ? `${formatClock(ep.lastFetchedAt)} <span class="opacity-60" data-since="${ep.lastFetchedAt}">${formatRelative(ep.lastFetchedAt)}</span>`
    : '<span class="opacity-40">never</span>';

  const dataAge = ep.feedTimestamp
    ? `${formatClock(ep.feedTimestamp * 1000)} <span class="opacity-60" data-since="${ep.feedTimestamp * 1000}">${formatRelative(ep.feedTimestamp * 1000)}</span>`
    : '<span class="opacity-40">not reported</span>';

  return `
    <div class="rounded-lg border border-base-300 p-3 space-y-2">
      <div class="flex items-center gap-2">
        <h4 class="font-medium text-sm flex-1">${escHtml(label)}</h4>
        ${ep.inFlight ? '<span class="loading loading-spinner loading-xs"></span>' : ''}
        ${ep.lastError ? '<span class="badge badge-error badge-xs">error</span>' : ''}
        ${!ep.url ? '<span class="badge badge-ghost badge-xs">not set</span>' : ''}
      </div>

      <dl class="text-xs space-y-1">
        <div class="flex justify-between gap-2">
          <dt class="opacity-60">Last fetched</dt><dd class="text-right">${fetched}</dd>
        </div>
        <div class="flex justify-between gap-2">
          <dt class="opacity-60">Feed timestamp <span class="opacity-50">(data age)</span></dt>
          <dd class="text-right">${dataAge}</dd>
        </div>
        <div class="flex justify-between gap-2">
          <dt class="opacity-60">Entities</dt>
          <dd class="text-right tabular-nums">${ep.entityCount ?? '—'}</dd>
        </div>
        <div class="flex justify-between gap-2">
          <dt class="opacity-60">Next refresh</dt>
          <dd class="text-right">${
            nextPollAt
              ? `<span data-until="${nextPollAt}">${formatCountdown(nextPollAt)}</span>`
              : '—'
          }</dd>
        </div>
      </dl>

      ${
        ep.lastError
          ? `<p class="text-xs text-error break-words">${escHtml(ep.lastError)} <span class="opacity-60">at ${formatClock(ep.lastErrorAt)}</span></p>`
          : ''
      }

      <div class="flex gap-1">
        <input
          type="text"
          class="input input-bordered input-xs flex-1 font-mono"
          data-rt-url="${ep.name}"
          value="${escHtml(ep.url)}"
          placeholder="https://…"
        />
        <button class="btn btn-xs" data-rt-apply="${ep.name}">Apply</button>
      </div>

      ${ep.header ? renderHeaderDump(ep) : ''}
      ${renderVehicleIdReport(ep)}
    </div>`;
}

const VEHICLE_ID_STRATEGY_NOTE: Record<string, string> = {
  trip: 'derived from vehicle.id + trip_id + start_date',
  entity: 'derived from vehicle.id + trip + entity.id',
  index: 'no usable identity — derived from the entity index',
};

/**
 * Report, don't absorb: when the vehicles feed's `vehicle.id` is not unique per
 * vehicle, state it plainly and name the offending ids (Plan 06 Root cause D).
 * A well-formed feed takes the `unique` no-op path and this renders nothing.
 */
function renderVehicleIdReport(ep: EndpointStatus): string {
  if (ep.name !== 'vehicles') return '';
  const strategy = ep.vehicleIdStrategy;
  if (!strategy || strategy === 'unique') return '';

  const dups = ep.vehiclesDuplicateIds;
  const list = dups.length
    ? `<ul class="mt-1 space-y-0.5">${dups
        .map(
          d =>
            `<li><span class="font-mono break-all">${escHtml(d.vehicleId || '(empty)')}</span> — ${d.count} vehicles</li>`,
        )
        .join('')}</ul>`
    : '';

  return `
    <div class="rounded-lg border border-warning/40 bg-warning/10 p-2 text-xs space-y-1">
      <p class="font-medium">vehicle.id is not unique per vehicle</p>
      <p class="opacity-70">
        GTFS-RT specifies <span class="font-mono">VehicleDescriptor.id</span> "should be
        unique per vehicle, and is used for tracking the vehicle as it proceeds through
        the system." This feed reuses it, so test-track derived an instance key
        (${escHtml(VEHICLE_ID_STRATEGY_NOTE[strategy] ?? strategy)}) to address vehicles.
      </p>
      ${list}
    </div>`;
}

function renderHeaderDump(ep: EndpointStatus): string {
  const h = ep.header!;
  return `
    <details class="text-xs">
      <summary class="cursor-pointer opacity-60">FeedHeader</summary>
      <table class="table table-xs mt-1">
        <tbody>
          <tr><td class="opacity-60">gtfs_realtime_version</td><td>${escHtml(h.gtfsRealtimeVersion || '—')}</td></tr>
          <tr><td class="opacity-60">incrementality</td><td>${escHtml(h.incrementality || '—')}</td></tr>
          <tr><td class="opacity-60">timestamp</td><td>${h.timestamp ?? '—'}</td></tr>
        </tbody>
      </table>
    </details>`;
}

function renderEndpoints(session: FeedSession): string {
  const status = session.status;
  if (!status) return '';
  return `
    <section class="space-y-2">
      <h3 class="font-semibold text-sm">Realtime endpoints</h3>
      ${REALTIME_ENDPOINTS.map(n => renderEndpoint(status.endpoints[n], status.nextPollAt)).join('')}
    </section>`;
}

function renderStaticSection(session: FeedSession): string {
  const src = session.selection?.static;
  if (!src) return '';

  const editor =
    src.kind === 'file'
      ? `<p class="text-xs opacity-60">Loaded from uploaded file <span class="font-mono">${escHtml(src.label)}</span> — not reproducible from a link.</p>`
      : `<div class="flex gap-1">
           <input type="text" id="status-static-url" class="input input-bordered input-xs flex-1 font-mono" value="${escHtml(src.url)}" />
           <button class="btn btn-xs" id="status-static-apply">Apply</button>
         </div>
         <label class="flex items-center gap-2 text-xs cursor-pointer">
           <input type="checkbox" id="status-static-cors" class="checkbox checkbox-xs" ${src.useCors ? 'checked' : ''} />
           CORS proxy
         </label>`;

  return `
    <section class="space-y-2">
      <h3 class="font-semibold text-sm">Static feed</h3>
      <div class="rounded-lg border border-base-300 p-3 space-y-2">
        <div class="flex items-center gap-2">
          <p class="text-sm flex-1">${escHtml(src.label)}</p>
          ${
            session.staticLoadedAt
              ? `<span class="text-xs opacity-60" data-since="${session.staticLoadedAt}">${formatRelative(session.staticLoadedAt)}</span>`
              : ''
          }
        </div>
        ${session.staticError ? `<p class="text-xs text-error break-words">${escHtml(session.staticError)}</p>` : ''}
        ${editor}
      </div>
    </section>`;
}

/**
 * What the map could not draw. Surfacing these is the point of the tool: a stop
 * with no id or a vehicle pointing at a route the static feed never declares is
 * a feed bug, not a rendering one.
 */
function renderMapIssues(issues: MapDataIssues | null): string {
  if (!issues) return '';
  const rows: Array<[string, number, string]> = [
    ['Stops dropped (no stop_id)', issues.stopsMissingId, 'Cannot be drawn or linked.'],
    [
      'Stops dropped (no coordinates)',
      issues.stopsMissingCoords,
      'stop_lat / stop_lon missing or unparseable.',
    ],
    [
      'Vehicles with no matching route',
      issues.vehiclesUnmatched,
      'Drawn in the neutral color instead of a route color.',
    ],
    [
      'Vehicles collapsed onto one map feature',
      issues.vehiclesDuplicateKeys,
      'Should be 0 — a non-zero count means the vehicle key derivation is broken.',
    ],
  ];
  if (rows.every(([, count]) => count === 0)) return '';

  return `
    <section class="space-y-2">
      <h3 class="font-semibold text-sm">Map data issues</h3>
      <div class="rounded-lg border border-warning/40 p-3 space-y-2">
        ${rows
          .filter(([, count]) => count > 0)
          .map(
            ([label, count, note]) => `
          <div>
            <div class="flex justify-between gap-2 text-xs">
              <span>${escHtml(label)}</span>
              <span class="tabular-nums font-semibold">${count}</span>
            </div>
            <p class="text-xs opacity-50">${escHtml(note)}</p>
          </div>`,
          )
          .join('')}
      </div>
    </section>`;
}

/**
 * Malformed `parent_station` links found while indexing the station hierarchy.
 * A station page aggregates over its children, so a mis-wired hierarchy is a
 * reportable feed defect (Plan 06 Phase 7).
 */
function renderStationIssues(session: FeedSession): string {
  const issues = session.staticFeed?.stationIssues;
  if (!issues) return '';
  const rows: Array<[string, number, string]> = [
    [
      'parent_station points at a missing stop',
      issues.danglingParent,
      'The referenced parent is not in stops.txt.',
    ],
    [
      'parent_station points at the wrong type',
      issues.nonStationParent,
      'A platform/entrance/node should reference a station; a boarding area a platform.',
    ],
    ['Stops caught in a parent_station cycle', issues.cyclicStops, 'Traversal is cut to avoid hanging.'],
  ];
  if (rows.every(([, count]) => count === 0)) return '';

  return `
    <section class="space-y-2">
      <h3 class="font-semibold text-sm">Station hierarchy issues</h3>
      <div class="rounded-lg border border-warning/40 p-3 space-y-2">
        ${rows
          .filter(([, count]) => count > 0)
          .map(
            ([label, count, note]) => `
          <div>
            <div class="flex justify-between gap-2 text-xs">
              <span>${escHtml(label)}</span>
              <span class="tabular-nums font-semibold">${count}</span>
            </div>
            <p class="text-xs opacity-50">${escHtml(note)}</p>
          </div>`,
          )
          .join('')}
      </div>
    </section>`;
}

/** feed_info.txt and agency.txt, verbatim. */
function renderRawTables(session: FeedSession): string {
  const feed = session.staticFeed;
  if (!feed) return '';
  const tables = [
    ...feed.feedInfo.map(info => ['feed_info.txt', info.raw] as const),
    ...feed.agencies.map(agency => ['agency.txt', agency.raw] as const),
  ];
  if (tables.length === 0) return '';

  return `
    <section class="space-y-2">
      <h3 class="font-semibold text-sm">Feed metadata</h3>
      ${tables
        .map(
          ([file, row]) => `
        <details class="text-xs rounded-lg border border-base-300 p-2">
          <summary class="cursor-pointer">${escHtml(file)}${
            row.agency_name ? ` — ${escHtml(row.agency_name)}` : ''
          }</summary>
          <table class="table table-xs mt-1">
            <tbody>
              ${Object.entries(row)
                .map(
                  ([k, v]) =>
                    `<tr><td class="opacity-60 align-top">${escHtml(k)}</td><td class="break-all">${escHtml(v ?? '')}</td></tr>`,
                )
                .join('')}
            </tbody>
          </table>
        </details>`,
        )
        .join('')}
    </section>`;
}

/**
 * The hash is long enough that reading it out of the address bar is unpleasant,
 * so copying is the primary path rather than an afterthought.
 */
function renderShare(session: FeedSession): string {
  if (!session.selection) return '';
  const reproducible = isReproducible(session.selection);
  return `
    <section class="space-y-2">
      <h3 class="font-semibold text-sm">Share</h3>
      <div class="rounded-lg border border-base-300 p-3 space-y-2">
        <button class="btn btn-xs btn-primary" id="status-copy-link" ${
          reproducible ? '' : 'disabled'
        }>Copy shareable link</button>
        <p class="text-xs opacity-60">
          ${
            reproducible
              ? 'The link carries both feed URLs and whatever is focused.'
              : 'This session loaded a static feed from an uploaded file, which a link cannot reproduce.'
          }
        </p>
      </div>
    </section>`;
}

function renderEmpty(): string {
  return `
    <div class="h-full flex flex-col items-center justify-center text-center gap-2 py-12">
      <p class="text-sm opacity-60">No feed loaded.</p>
      <p class="text-xs opacity-40 max-w-xs">
        Use the <span class="font-medium">Load</span> menu to pick a static GTFS feed
        and a realtime feed. Both are required.
      </p>
    </div>`;
}

export class StatusPage {
  private host: HTMLElement;
  private session: FeedSession;
  private tickerId: ReturnType<typeof setInterval> | null = null;
  private renderQueued = false;
  /** False while an object page owns the panel; polls must not paint over it. */
  private active = true;

  constructor(host: HTMLElement, session: FeedSession) {
    this.host = host;
    this.session = session;
  }

  private shareUrl: (() => string) | null = null;
  private mapIssues: (() => MapDataIssues) | null = null;

  /** Supplied by AppState, which is the only thing that knows the full hash. */
  setShareUrlProvider(fn: () => string): void {
    this.shareUrl = fn;
  }

  /** Supplied by MapController — only the layer stack knows what it dropped. */
  setMapIssuesProvider(fn: () => MapDataIssues): void {
    this.mapIssues = fn;
  }

  /** Called by AppState when focus moves to or away from home. */
  setActive(active: boolean): void {
    this.active = active;
    if (active) this.render();
  }

  initialize(): void {
    this.session.addEventListener('change', () => this.queueRender());
    this.render();
    // One shared ticker walks every relative timestamp; one interval per row
    // would leak on each re-render.
    this.tickerId = setInterval(() => this.tick(), 1000);
  }

  destroy(): void {
    if (this.tickerId !== null) clearInterval(this.tickerId);
    this.tickerId = null;
  }

  /** Coalesce the burst of statuschange events a single poll produces. */
  private queueRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    queueMicrotask(() => {
      this.renderQueued = false;
      this.render();
    });
  }

  private tick(): void {
    if (!this.active) return;
    this.host.querySelectorAll<HTMLElement>('[data-since]').forEach(el => {
      el.textContent = formatRelative(Number(el.dataset.since));
    });
    this.host.querySelectorAll<HTMLElement>('[data-until]').forEach(el => {
      el.textContent = formatCountdown(Number(el.dataset.until));
    });
  }

  private render(): void {
    if (!this.active) return;

    // Don't clobber a URL the user is mid-edit.
    const active = document.activeElement as HTMLElement | null;
    if (active && this.host.contains(active) && active.tagName === 'INPUT') return;

    if (!this.session.selection) {
      this.host.innerHTML = renderEmpty();
      return;
    }

    this.host.innerHTML = `
      <div class="space-y-4">
        ${renderCounts(this.session)}
        ${renderMapIssues(this.mapIssues?.() ?? null)}
        ${renderStationIssues(this.session)}
        ${renderStaticSection(this.session)}
        ${renderEndpoints(this.session)}
        ${renderShare(this.session)}
        ${renderRawTables(this.session)}
      </div>`;

    this.wire();
  }

  private wire(): void {
    this.host.querySelectorAll<HTMLButtonElement>('[data-rt-apply]').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.dataset.rtApply as RealtimeEndpointName;
        const input = this.host.querySelector<HTMLInputElement>(`[data-rt-url="${name}"]`)!;
        btn.disabled = true;
        void this.session
          .applyRealtimeUrl(name, input.value.trim())
          .finally(() => { btn.disabled = false; });
      });
    });

    const copyBtn = this.host.querySelector<HTMLButtonElement>('#status-copy-link');
    copyBtn?.addEventListener('click', () => {
      if (!this.shareUrl) return;
      void navigator.clipboard
        .writeText(this.shareUrl())
        .then(() => notify.success('Link copied'))
        .catch(() => notify.error('Could not copy to clipboard'));
    });

    const staticApply = this.host.querySelector<HTMLButtonElement>('#status-static-apply');
    staticApply?.addEventListener('click', () => {
      const input = this.host.querySelector<HTMLInputElement>('#status-static-url')!;
      const cors = this.host.querySelector<HTMLInputElement>('#status-static-cors')!;
      const url = input.value.trim();
      if (!url) return;
      staticApply.disabled = true;
      this.session
        .applyStaticUrl(url, cors.checked)
        .then(() => notify.success('Static feed reloaded'))
        .catch(err => notify.error(`Static reload failed: ${err instanceof Error ? err.message : String(err)}`))
        .finally(() => { staticApply.disabled = false; });
    });
  }
}
