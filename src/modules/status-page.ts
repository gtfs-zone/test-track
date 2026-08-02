import type { EndpointStatus } from '../gtfs-rt';
import type { FeedSession } from './feed-session';
import type { MapDataIssues } from './layer-manager';
import type { FeedGaps } from './rt-index';
import type { RealtimeEndpointName } from './feed-selection';
import { REALTIME_ENDPOINTS, REALTIME_ENDPOINT_LABELS } from './feed-selection';
import { localClock } from './feed-time';
import { isReproducible } from './feed-url';
import { isLocalUrl, normalizeFeedUrl, resolveRealtimeUrl, validateFeedUrl } from './feed-url-resolve';
import { notify } from './notification-system';

/**
 * The right panel's "nothing focused" content: what is loaded, how much of it,
 * when each endpoint was last fetched, and an inline editor for every URL.
 *
 * The URL editors are draft-based. Nothing you type is ever sent anywhere, or
 * overwritten by anything, until you press Apply: a poll landing mid-edit
 * repaints the counts and timers around your text without touching it, and a
 * rejected URL stays in the box with the reason underneath so it can be
 * corrected instead of retyped. `StatusPage.drafts` is what makes that true —
 * the panel is rebuilt wholesale on every status change, so the value in the
 * markup has to come from the draft rather than from the session.
 */

/** A URL editor's state for one render pass. */
interface FieldView {
  key: string;
  value: string;
  dirty: boolean;
  busy: boolean;
  error: string | null;
  /** The CORS checkbox is on, but this URL is local so the proxy is bypassed. */
  proxyBypassed: boolean;
  placeholder: string;
}

/** Renders `FieldView`s; supplied by the StatusPage instance to the render tree. */
type FieldRenderer = (key: string, committed: string, placeholder: string) => string;

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

/**
 * One URL editor: the field, and — only once it differs from what is loaded —
 * the controls to commit or discard the change. Apply/Revert stay hidden while
 * the field is clean so the panel is not three rows of buttons at rest.
 */
function renderField(f: FieldView): string {
  const controls = f.dirty
    ? `
      <div class="flex items-center gap-1">
        <button class="btn btn-xs btn-primary" data-apply="${escHtml(f.key)}" ${f.busy ? 'disabled' : ''}>
          ${f.busy ? '<span class="loading loading-spinner loading-xs"></span>' : 'Apply'}
        </button>
        <button class="btn btn-xs btn-ghost" data-revert="${escHtml(f.key)}" ${f.busy ? 'disabled' : ''}>Revert</button>
        <span class="badge badge-warning badge-xs">edited</span>
      </div>`
    : '';

  return `
    <div class="space-y-1">
      <input
        type="text"
        class="input input-bordered input-xs w-full font-mono${f.error ? ' input-error' : ''}"
        data-field="${escHtml(f.key)}"
        value="${escHtml(f.value)}"
        placeholder="${escHtml(f.placeholder)}"
        spellcheck="false"
        autocomplete="off"
      />
      ${controls}
      ${f.error ? `<p class="text-xs text-error break-words">✗ ${escHtml(f.error)}</p>` : ''}
      ${
        f.proxyBypassed
          ? '<p class="text-xs opacity-50">local URL — CORS proxy not applied (it cannot reach this machine)</p>'
          : ''
      }
    </div>`;
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
function renderEndpoint(
  ep: EndpointStatus,
  rawUrl: string,
  nextPollAt: number | null,
  field: FieldRenderer,
): string {
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

      ${field(`rt:${ep.name}`, rawUrl, 'https://… or /feed/vehicle_positions.pb')}

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

function renderEndpoints(session: FeedSession, field: FieldRenderer): string {
  const status = session.status;
  if (!status) return '';
  const rt = session.selection?.realtime;
  const rawUrls: Record<RealtimeEndpointName, string> = {
    vehicles: rt?.vehiclesUrl ?? '',
    tripUpdates: rt?.tripUpdatesUrl ?? '',
    alerts: rt?.alertsUrl ?? '',
  };
  const corsToggle = rt
    ? `<label class="flex items-center gap-2 text-xs cursor-pointer font-normal">
         <input type="checkbox" id="status-rt-cors" class="checkbox checkbox-xs" ${rt.useCors ? 'checked' : ''} />
         CORS proxy
       </label>`
    : '';
  return `
    <section class="space-y-2">
      <div class="flex items-center gap-2">
        <h3 class="font-semibold text-sm flex-1">Realtime endpoints</h3>
        ${corsToggle}
      </div>
      ${REALTIME_ENDPOINTS.map(n =>
        renderEndpoint(status.endpoints[n], rawUrls[n], status.nextPollAt, field),
      ).join('')}
    </section>`;
}

function renderStaticSection(session: FeedSession, field: FieldRenderer): string {
  const src = session.selection?.static;
  if (!src) return '';

  // Mirror the realtime section: the CORS toggle rides in the section header,
  // not down inside the editor. File sources aren't fetched, so no toggle.
  const corsToggle =
    src.kind === 'url'
      ? `<label class="flex items-center gap-2 text-xs cursor-pointer font-normal">
           <input type="checkbox" id="status-static-cors" class="checkbox checkbox-xs" ${src.useCors ? 'checked' : ''} />
           CORS proxy
         </label>`
      : '';

  const editor =
    src.kind === 'file'
      ? `<p class="text-xs opacity-60">Loaded from uploaded file <span class="font-mono">${escHtml(src.label)}</span> — not reproducible from a link.</p>`
      : field('static', src.url, 'https://…/gtfs.zip');

  return `
    <section class="space-y-2">
      <div class="flex items-center gap-2">
        <h3 class="font-semibold text-sm flex-1">Static feed</h3>
        ${corsToggle}
      </div>
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
 * How the feed names each vehicle's current stop.
 *
 * `current_stop_sequence` is optional in GTFS-RT, and `stop_id` is an equally
 * legitimate way to say the same thing — plenty of feeds use only the latter.
 * That is worth stating but is not a defect, so it renders neutral. The border
 * turns to a warning only when test-track had to infer a position from
 * predictions, or could not place a vehicle at all: those are the cases where
 * what is on screen is not simply what the feed said.
 *
 * A feed that reports the sequence renders nothing.
 */
function renderFeedGaps(gaps: FeedGaps | null): string {
  if (!gaps || gaps.missingStopSequence === 0) return '';
  const unplaced = gaps.missingStopSequence - gaps.resolvedFromStopId - gaps.stopSequenceDerived;
  const inferred = gaps.stopSequenceDerived > 0 || unplaced > 0;

  const notes = [
    `GTFS-RT makes the field optional, so ${gaps.missingStopSequence} of ${gaps.vehicles} vehicles do not report it.`,
  ];
  if (gaps.resolvedFromStopId > 0) {
    notes.push(
      `${gaps.resolvedFromStopId} named the stop with <span class="font-mono">stop_id</span> instead, which the spec equally allows; their positions come from that.`,
    );
  }
  if (gaps.stopSequenceDerived > 0) {
    notes.push(
      `${gaps.stopSequenceDerived} named no stop at all, so test-track took the soonest still-future <span class="font-mono">stop_time_update</span> on the same trip; those are marked "derived" wherever they appear.`,
    );
  }
  if (unplaced > 0) {
    notes.push(
      `${unplaced} could not be placed by any of these and stay in the route strip's unplaced list.`,
    );
  }

  return `
    <section class="space-y-2">
      <h3 class="font-semibold text-sm">${inferred ? 'Feed data gaps' : 'How this feed reports position'}</h3>
      <div class="rounded-lg border ${inferred ? 'border-warning/40' : 'border-base-300'} p-3 space-y-2">
        <div class="flex justify-between gap-2 text-xs">
          <span>Vehicles with no <span class="font-mono">current_stop_sequence</span></span>
          <span class="tabular-nums font-semibold">${gaps.missingStopSequence}</span>
        </div>
        <p class="text-xs opacity-50">${notes.join(' ')}</p>
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

/**
 * CSV columns that arrived with leading/trailing whitespace and were trimmed at
 * parse time (see `parseCSV` in gtfs-static.ts). The GTFS reference forbids the
 * padding, and it is silently fatal: a padded static `stop_id` matches no clean
 * realtime `stop_id`, so absorbing it without saying so would hide the defect.
 *
 * Rows are counted, not distinct values — "3544 rows" is a fact; "3544 stops"
 * would invite the reader to wonder whether any were merged. A clean feed (which
 * is nearly all of them) renders nothing, so this never becomes furniture.
 */
function renderPaddedColumns(session: FeedSession): string {
  const padded = session.staticFeed?.paddedColumns;
  if (!padded || padded.length === 0) return '';

  return `
    <section class="space-y-2">
      <h3 class="font-semibold text-sm">Whitespace-padded columns</h3>
      <div class="rounded-lg border border-warning/40 p-3 space-y-2">
        ${padded
          .map(
            ({ file, column, rows }) => `
          <div>
            <div class="flex justify-between gap-2 text-xs">
              <span><span class="font-mono">${escHtml(file)}</span> <span class="font-mono">${escHtml(column)}</span></span>
              <span class="tabular-nums font-semibold">${rows}</span>
            </div>
            <p class="text-xs opacity-50">
              ${rows} rows had leading or trailing whitespace. The GTFS reference forbids this;
              test-track trimmed them. Untrimmed, no realtime
              <span class="font-mono">${escHtml(column)}</span> would match this feed.
            </p>
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
  /**
   * Uncommitted URL text, keyed `rt:vehicles` / `rt:tripUpdates` / `rt:alerts` /
   * `static`. A key is present only while the field is being edited; the entry
   * is dropped once Apply succeeds or Revert is pressed. Everything that renders
   * a URL reads here first, which is what makes a mid-edit repaint harmless.
   */
  private drafts = new Map<string, string>();
  /** Why the last Apply for a field was rejected, shown under that field. */
  private fieldErrors = new Map<string, string>();
  /** Fields with an Apply in flight, so the button can show it. */
  private applying = new Set<string>();
  /** False while an object page owns the panel; polls must not paint over it. */
  private active = true;

  constructor(host: HTMLElement, session: FeedSession) {
    this.host = host;
    this.session = session;
  }

  private shareUrl: (() => string) | null = null;
  private mapIssues: (() => MapDataIssues) | null = null;
  private feedGaps: (() => FeedGaps) | null = null;

  /** Supplied by AppState, which is the only thing that knows the full hash. */
  setShareUrlProvider(fn: () => string): void {
    this.shareUrl = fn;
  }

  /** Supplied by MapController — only the layer stack knows what it dropped. */
  setMapIssuesProvider(fn: () => MapDataIssues): void {
    this.mapIssues = fn;
  }

  /** Supplied by PanelRenderer, which owns the realtime read-model. */
  setFeedGapsProvider(fn: () => FeedGaps): void {
    this.feedGaps = fn;
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
    this.drafts.clear();
    this.fieldErrors.clear();
    this.applying.clear();
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

  /** The committed value for a field — what the session actually loaded. */
  private committed(key: string): string {
    const sel = this.session.selection;
    if (key === 'static') return sel?.static?.kind === 'url' ? sel.static.url : '';
    const name = key.slice(3) as RealtimeEndpointName;
    const rt = sel?.realtime;
    if (name === 'vehicles') return rt?.vehiclesUrl ?? '';
    if (name === 'tripUpdates') return rt?.tripUpdatesUrl ?? '';
    return rt?.alertsUrl ?? '';
  }

  /** Whether the CORS proxy is switched on for whichever half this field belongs to. */
  private corsFor(key: string): boolean {
    const sel = this.session.selection;
    if (key === 'static') return sel?.static?.kind === 'url' ? sel.static.useCors : false;
    return sel?.realtime?.useCors ?? false;
  }

  /**
   * Everything about a field's appearance that an `input` event can change.
   * Compared before and after a keystroke so the panel is rebuilt when the
   * controls need to appear or an error needs to clear, and left alone — caret
   * and all — for ordinary typing.
   */
  private rowSignature(key: string): string {
    const draft = this.drafts.get(key);
    const dirty = draft !== undefined && draft !== this.committed(key);
    return `${dirty}|${this.fieldErrors.get(key) ?? ''}`;
  }

  private buildField: FieldRenderer = (key, committed, placeholder) => {
    const draft = this.drafts.get(key);
    const value = draft ?? committed;
    // A local URL ignores the proxy setting (see `maybeProxy`); say so, but only
    // when the checkbox is actually on and therefore looks like it is doing
    // something.
    const resolved = key === 'static' ? value : resolveRealtimeUrl(value);
    return renderField({
      key,
      value,
      dirty: draft !== undefined && draft !== committed,
      busy: this.applying.has(key),
      error: this.fieldErrors.get(key) ?? null,
      proxyBypassed: Boolean(value) && this.corsFor(key) && isLocalUrl(resolved),
      placeholder,
    });
  };

  private render(): void {
    if (!this.active) return;

    if (!this.session.selection) {
      this.host.innerHTML = renderEmpty();
      return;
    }

    // Drafts keep the *value* safe across the rebuild below; focus and caret are
    // DOM state that only this can carry over.
    const focused = document.activeElement as HTMLInputElement | null;
    const restore =
      focused && this.host.contains(focused) && focused.dataset.field
        ? {
            key: focused.dataset.field,
            start: focused.selectionStart,
            end: focused.selectionEnd,
          }
        : null;

    this.host.innerHTML = `
      <div class="space-y-4">
        ${renderCounts(this.session)}
        ${renderFeedGaps(this.feedGaps?.() ?? null)}
        ${renderMapIssues(this.mapIssues?.() ?? null)}
        ${renderStationIssues(this.session)}
        ${renderPaddedColumns(this.session)}
        ${renderStaticSection(this.session, this.buildField)}
        ${renderEndpoints(this.session, this.buildField)}
        ${renderShare(this.session)}
        ${renderRawTables(this.session)}
      </div>`;

    this.wire();

    if (restore) {
      const el = this.host.querySelector<HTMLInputElement>(
        `[data-field="${CSS.escape(restore.key)}"]`,
      );
      if (el) {
        el.focus();
        if (restore.start !== null) el.setSelectionRange(restore.start, restore.end);
      }
    }
  }

  /**
   * Commit a field. Validation happens here rather than at fetch time so a typo
   * is reported against the field immediately instead of coming back as an
   * opaque network error.
   *
   * On failure the draft survives — that is the whole point — and holds the
   * *normalized* text, so what the field shows is what was actually attempted.
   */
  private async applyField(key: string): Promise<void> {
    const raw = this.drafts.get(key);
    if (raw === undefined || this.applying.has(key)) return;

    const url = normalizeFeedUrl(raw);
    this.drafts.set(key, url);

    // An empty realtime URL is meaningful — it switches that endpoint off. An
    // empty static URL is not: there would be no feed left to render.
    const invalid =
      key === 'static' && !url ? 'A static feed URL is required.' : validateFeedUrl(url);
    if (invalid) {
      this.fieldErrors.set(key, invalid);
      this.render();
      return;
    }

    // Read the checkbox before the await: the panel is rebuilt underneath us.
    const useCors = this.corsFor(key);

    this.applying.add(key);
    this.fieldErrors.delete(key);
    this.render();

    const result =
      key === 'static'
        ? await this.session.applyStaticUrl(url, useCors)
        : await this.session.applyRealtimeUrl(key.slice(3) as RealtimeEndpointName, url);

    this.applying.delete(key);
    if (result.ok) {
      this.drafts.delete(key);
      this.fieldErrors.delete(key);
      notify.success(
        key === 'static' ? 'Static feed reloaded' : `${REALTIME_ENDPOINT_LABELS[key.slice(3) as RealtimeEndpointName]} updated`,
      );
    } else {
      this.fieldErrors.set(key, result.error);
    }
    this.render();
  }

  private revertField(key: string): void {
    this.drafts.delete(key);
    this.fieldErrors.delete(key);
    this.render();
  }

  private wire(): void {
    // Typing only ever touches the draft. Nothing is fetched, and nothing in the
    // session changes, until Apply (or Enter) — so a poll landing mid-edit is a
    // non-event and a rejected URL stays on screen to be corrected.
    this.host.querySelectorAll<HTMLInputElement>('[data-field]').forEach(input => {
      const key = input.dataset.field!;

      input.addEventListener('input', () => {
        const before = this.rowSignature(key);
        this.drafts.set(key, input.value);
        this.fieldErrors.delete(key);
        // Only rebuild when the controls or the error state actually change;
        // every keystroke doing a full repaint would be wasteful even with the
        // caret restore above.
        if (this.rowSignature(key) !== before) this.render();
      });

      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void this.applyField(key);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          this.revertField(key);
        }
      });
    });

    this.host.querySelectorAll<HTMLButtonElement>('[data-apply]').forEach(btn => {
      btn.addEventListener('click', () => void this.applyField(btn.dataset.apply!));
    });
    this.host.querySelectorAll<HTMLButtonElement>('[data-revert]').forEach(btn => {
      btn.addEventListener('click', () => this.revertField(btn.dataset.revert!));
    });

    // Checkboxes have no draft to keep — there is nothing to mistype, so they
    // apply on the spot.
    const rtCors = this.host.querySelector<HTMLInputElement>('#status-rt-cors');
    rtCors?.addEventListener('change', () => {
      void this.session
        .applyRealtimeCors(rtCors.checked)
        .then(() => notify.success('Realtime feed reloaded'))
        .catch(err =>
          notify.error(`Realtime reload failed: ${err instanceof Error ? err.message : String(err)}`),
        );
    });

    const staticCors = this.host.querySelector<HTMLInputElement>('#status-static-cors');
    staticCors?.addEventListener('change', () => {
      const url = this.committed('static');
      if (!url) return;
      void this.session.applyStaticUrl(url, staticCors.checked).then(result => {
        if (result.ok) {
          notify.success('Static feed reloaded');
        } else {
          this.fieldErrors.set('static', result.error);
          this.render();
        }
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
  }
}
