/**
 * The one way into a feed.
 *
 * Everything that used to be three modals behind a dropdown — curated
 * examples, TransitLand search, hand-typed URLs — is one screen here, because
 * they were never really different tasks: you are always choosing a static
 * source and a realtime source, and the only thing that varies is where the
 * URLs come from.
 *
 * So the two slots at the top are plain URL fields, and every result row is a
 * shortcut that fills them in. That single change is what makes the rest work:
 * "load an example and then fix one of its URLs" needs no separate mode, and
 * neither does "come back and edit what is loaded" — the modal opens seeded
 * from the current selection, which is why the right panel needs no editors of
 * its own.
 *
 * Rows carry their URLs on the face of them. Two agencies with the same name
 * are otherwise indistinguishable, and it is worth knowing what you are about
 * to fetch before you fetch it.
 */

import UFuzzy from '@leeoniya/ufuzzy';
import { EXAMPLES } from './examples';
import type { CatalogFeed } from './feed-catalog';
import { describeLiveness, loadCatalog, realtimePaths } from './feed-catalog';
import type { FeedSelection } from './feed-selection';
import { describeMissing, isComplete } from './feed-selection';
import { normalizeFeedUrl, validateFeedUrl } from './feed-url-resolve';
import { renderUploadIcon, showModal } from './modal-utils';

/**
 * Where a row came from, in the order the groups are shown. Feeds this stack
 * serves are first because they are the ones we can vouch for; the atlas is
 * last because it is four thousand rows of unverified metadata.
 */
type Group = 'verified' | 'example' | 'atlas';

const GROUP_ORDER: readonly Group[] = ['verified', 'example', 'atlas'];

const GROUP_LABELS: Record<Group, string> = {
  verified: 'Feeds on rt.gtfs.zone',
  example: 'Examples',
  atlas: 'TransitLand Atlas',
};

/** One offer in the result list, whichever source it came from. */
interface FeedRow {
  rowId: string;
  group: Group;
  /** Which slots a click fills. Atlas rows describe one half of a feed. */
  provides: 'pair' | 'static' | 'rt';
  name: string;
  subtitle: string;
  staticUrl?: string;
  vehiclesUrl?: string;
  tripUpdatesUrl?: string;
  alertsUrl?: string;
  staticCors: boolean;
  rtCors: boolean;
}

/** A row in public/atlas-feeds.json — one per feed *source kind*. */
interface AtlasRow {
  rowId: string;
  kind: 'static' | 'rt';
  feedId: string;
  name: string;
  operator_name: string;
  source: string;
  staticUrl?: string;
  vehiclesUrl?: string;
  tripUpdatesUrl?: string;
  alertsUrl?: string;
}

/** The unfiltered list is thousands of rows; cap what is painted. */
const DISPLAY_CAP = 200;

let cachedAtlas: Promise<AtlasRow[]> | null = null;

function loadAtlasRows(): Promise<AtlasRow[]> {
  cachedAtlas ??= fetch('/atlas-feeds.json').then(res => {
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
    return res.json() as Promise<AtlasRow[]>;
  });
  return cachedAtlas;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ─── Sources ──────────────────────────────────────────────────────────────────

function catalogRow(feed: CatalogFeed): FeedRow {
  const live = describeLiveness(feed);
  return {
    rowId: `verified:${feed.feed_name}`,
    group: 'verified',
    provides: 'pair',
    name: feed.feed_name,
    subtitle: live ? `serving ${live}` : 'no live data right now',
    staticUrl: feed.static_url || undefined,
    ...realtimePaths(feed),
    // The static half is somebody else's CDN, so it needs the proxy. The
    // realtime half does not: this list only exists because rt.gtfs.zone
    // answered a cross-origin request from here, which is the same permission
    // the .pb endpoints need. Skipping the proxy hop is free accuracy.
    staticCors: true,
    rtCors: false,
  };
}

function exampleRows(): FeedRow[] {
  return EXAMPLES.map((ex, i) => {
    const rt = ex.selection.realtime;
    const src = ex.selection.static;
    return {
      rowId: `example:${i}`,
      group: 'example' as const,
      provides: 'pair' as const,
      name: ex.name,
      subtitle: ex.description ?? '',
      staticUrl: src?.kind === 'url' ? src.url : undefined,
      vehiclesUrl: rt?.vehiclesUrl,
      tripUpdatesUrl: rt?.tripUpdatesUrl,
      alertsUrl: rt?.alertsUrl,
      staticCors: src?.kind === 'url' ? src.useCors : true,
      rtCors: rt?.useCors ?? true,
    };
  });
}

function atlasRow(row: AtlasRow): FeedRow {
  return {
    rowId: `atlas:${row.rowId}`,
    group: 'atlas',
    provides: row.kind,
    name: row.name,
    subtitle: [row.operator_name, row.source].filter(Boolean).join(' · '),
    staticUrl: row.staticUrl,
    vehiclesUrl: row.vehiclesUrl,
    tripUpdatesUrl: row.tripUpdatesUrl,
    alertsUrl: row.alertsUrl,
    // Unknown origins, so assume the proxy is needed; the checkbox is there for
    // the ones that turn out not to.
    staticCors: true,
    rtCors: true,
  };
}

/**
 * Every row, plus a note for each source that could not be reached.
 *
 * Neither remote source is allowed to keep the modal shut: the examples are
 * compiled in, so there is always something to load even with no network.
 */
async function loadRows(): Promise<{ rows: FeedRow[]; notes: string[] }> {
  const [catalog, atlas] = await Promise.allSettled([loadCatalog(), loadAtlasRows()]);

  const notes: string[] = [];
  const rows: FeedRow[] = [];

  if (catalog.status === 'fulfilled') {
    // A feed with nothing in any endpoint is a feed with nothing to show.
    rows.push(...catalog.value.filter(hasLiveData).map(catalogRow));
  } else {
    notes.push(`Feed catalog unavailable — ${reason(catalog.reason)}`);
  }

  rows.push(...exampleRows());

  if (atlas.status === 'fulfilled') {
    rows.push(...atlas.value.map(atlasRow));
  } else {
    notes.push(`TransitLand atlas unavailable — ${reason(atlas.reason)}`);
  }

  return { rows, notes };
}

function hasLiveData(feed: CatalogFeed): boolean {
  return feed.has_vehicles || feed.has_trip_updates || feed.has_alerts;
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function urlLine(label: string, url: string | undefined): string {
  if (!url) return '';
  return `<p class="text-[11px] font-mono opacity-50 truncate" title="${escHtml(url)}">
    <span class="opacity-70">${label}</span> ${escHtml(url)}
  </p>`;
}

function badges(row: FeedRow): string {
  const parts: string[] = [];
  if (row.provides !== 'rt') parts.push('<span class="badge badge-xs badge-neutral">Static</span>');
  if (row.provides !== 'static') parts.push('<span class="badge badge-xs badge-primary">RT</span>');
  return parts.join('');
}

function renderRow(row: FeedRow, inUse: boolean): string {
  const classes = inUse ? 'bg-primary/10 ring-1 ring-primary/40' : 'hover:bg-base-200';
  return `
    <button type="button" class="w-full text-left px-3 py-2 rounded-lg flex items-start gap-2 ${classes}" data-row-id="${escHtml(row.rowId)}">
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium truncate">${escHtml(row.name)}</p>
        ${row.subtitle ? `<p class="text-xs opacity-60 truncate">${escHtml(row.subtitle)}</p>` : ''}
        ${urlLine('static', row.staticUrl)}
        ${urlLine('vp', row.vehiclesUrl)}
        ${urlLine('tu', row.tripUpdatesUrl)}
        ${urlLine('al', row.alertsUrl)}
      </div>
      <div class="flex gap-1 shrink-0 pt-0.5 items-center">
        ${inUse ? '<span class="text-xs opacity-60">in use</span>' : ''}
        ${badges(row)}
      </div>
    </button>`;
}

/** The visible rows, with a heading wherever the group changes. */
function renderRows(rows: FeedRow[], inUse: Set<string>): string {
  if (rows.length === 0) {
    return '<p class="text-sm opacity-40 text-center py-8">No results.</p>';
  }
  let group: Group | null = null;
  const out: string[] = [];
  for (const row of rows) {
    if (row.group !== group) {
      group = row.group;
      out.push(
        `<p class="text-xs uppercase tracking-wide opacity-50 px-3 pt-3 pb-1">${GROUP_LABELS[group]}</p>`,
      );
    }
    out.push(renderRow(row, inUse.has(row.rowId)));
  }
  return out.join('');
}

const CORS_TOOLTIP =
  "Routes requests through cors.gtfs.zone when the feed server doesn't send CORS headers.";

function corsToggle(id: string): string {
  return `
    <label class="flex items-center gap-2 text-xs cursor-pointer font-normal">
      <input type="checkbox" id="${id}" class="checkbox checkbox-xs" checked />
      CORS proxy
      <span class="tooltip" data-tip="${CORS_TOOLTIP}">
        <span class="cursor-help opacity-60">?</span>
      </span>
    </label>`;
}

function rtField(id: string, label: string, placeholder: string): string {
  return `
    <label class="flex items-center gap-2">
      <span class="text-xs opacity-60 w-28 shrink-0">${label}</span>
      <input type="text" id="${id}" class="input input-bordered input-xs flex-1 font-mono" placeholder="${placeholder}" spellcheck="false" autocomplete="off" />
    </label>`;
}

// ─── The modal ────────────────────────────────────────────────────────────────

/** Every URL field, so validation can name the one that is wrong. */
const URL_FIELDS: Array<[id: string, label: string]> = [
  ['load-static-url', 'Static GTFS'],
  ['load-vehicles-url', 'Vehicle Positions'],
  ['load-trip-updates-url', 'Trip Updates'],
  ['load-alerts-url', 'Service Alerts'],
];

function input(id: string): HTMLInputElement {
  return document.getElementById(id) as HTMLInputElement;
}

/**
 * The first URL problem in the form, or '' when there is none. Reported through
 * the same hint line as the missing-feed message, so the Load button is never
 * enabled on a URL that cannot be fetched.
 */
function describeBadUrl(): string {
  for (const [id, label] of URL_FIELDS) {
    const raw = input(id).value.trim();
    if (!raw) continue;
    const problem = validateFeedUrl(raw);
    if (problem) return `${label}: ${problem}`;
  }
  return '';
}

const CUSTOM_STATIC = 'Custom static feed';
const CUSTOM_RT = 'Custom realtime feed';

export async function showLoadModal(
  current: FeedSelection | null,
): Promise<FeedSelection | null> {
  const { rows, notes } = await loadRows();

  const uf = new UFuzzy();
  // Rows are already in group order, so a filtered view only has to keep that
  // order stable rather than re-derive it.
  const haystack = rows.map(r =>
    [r.name, r.subtitle, r.staticUrl, r.vehiclesUrl, r.tripUpdatesUrl, r.alertsUrl]
      .filter(Boolean)
      .join(' '),
  );
  const groupRank = new Map(GROUP_ORDER.map((g, i) => [g, i]));

  let visible = rows.slice(0, DISPLAY_CAP);
  let result: FeedSelection | null = null;

  // Slot state that is not held in the DOM: the labels a row click supplies,
  // which row each slot came from, and an uploaded file (which cannot be put
  // back into a file input).
  let staticLabel = current?.static?.label ?? CUSTOM_STATIC;
  let rtLabel = current?.realtime?.label ?? CUSTOM_RT;
  let staticRowId: string | null = null;
  let rtRowId: string | null = null;
  let staticFile: File | undefined =
    current?.static?.kind === 'file' ? current.static.file : undefined;

  const body = `
    <div class="space-y-3">
      <section class="rounded-lg border border-base-300 p-3 space-y-2">
        <div class="flex items-center justify-between gap-2">
          <h4 class="font-medium text-sm truncate">
            Static GTFS <span id="load-static-label" class="font-normal opacity-60"></span>
          </h4>
          ${corsToggle('load-static-cors')}
        </div>
        <div class="flex gap-2">
          <input type="text" id="load-static-url" class="input input-bordered input-xs flex-1 font-mono" placeholder="https://…/gtfs.zip  (append #inner.zip for a nested feed)" spellcheck="false" autocomplete="off" />
          <button type="button" id="load-upload-btn" class="btn btn-xs btn-outline gap-1">
            ${renderUploadIcon('h-3.5 w-3.5')} Upload ZIP
          </button>
          <input type="file" id="load-file-input" accept=".zip" class="hidden" />
        </div>
        <div id="load-file-row" class="hidden items-center gap-2">
          <p id="load-file-name" class="text-xs opacity-60"></p>
          <button type="button" id="load-file-clear" class="btn btn-ghost btn-xs">Clear</button>
        </div>
      </section>

      <section class="rounded-lg border border-base-300 p-3 space-y-2">
        <div class="flex items-center justify-between gap-2">
          <h4 class="font-medium text-sm truncate">
            Realtime GTFS-RT <span id="load-rt-label" class="font-normal opacity-60"></span>
          </h4>
          ${corsToggle('load-rt-cors')}
        </div>
        ${rtField('load-vehicles-url', 'Vehicle Positions', 'https://…/vehicle_positions.pb')}
        ${rtField('load-trip-updates-url', 'Trip Updates', 'https://…/trip_updates.pb')}
        ${rtField('load-alerts-url', 'Service Alerts', 'https://…/alerts.pb')}
      </section>

      ${notes
        .map(n => `<p class="text-xs text-warning">${escHtml(n)}</p>`)
        .join('')}

      <input type="text" id="load-search" class="input input-bordered input-sm w-full" placeholder="Search by agency, operator, source, or URL…" autofocus />
      <div id="load-results" class="space-y-0.5 overflow-y-auto max-h-96"></div>
    </div>
  `;

  /** The current form state as a selection. */
  const readForm = (): FeedSelection => {
    const val = (id: string) => normalizeFeedUrl(input(id).value);
    const checked = (id: string) => input(id).checked;

    const staticUrl = val('load-static-url');
    const vehiclesUrl = val('load-vehicles-url');
    const tripUpdatesUrl = val('load-trip-updates-url');
    const alertsUrl = val('load-alerts-url');

    let staticSource: FeedSelection['static'] = null;
    if (staticFile) {
      staticSource = { kind: 'file', file: staticFile, label: staticFile.name };
    } else if (staticUrl) {
      staticSource = {
        kind: 'url',
        url: staticUrl,
        useCors: checked('load-static-cors'),
        label: staticLabel,
      };
    }

    const hasRt = Boolean(vehiclesUrl || tripUpdatesUrl || alertsUrl);
    return {
      static: staticSource,
      realtime: hasRt
        ? {
            vehiclesUrl: vehiclesUrl || undefined,
            tripUpdatesUrl: tripUpdatesUrl || undefined,
            alertsUrl: alertsUrl || undefined,
            useCors: checked('load-rt-cors'),
            label: rtLabel,
          }
        : null,
    };
  };

  await showModal({
    title: 'Load Feed',
    body,
    boxClassName: 'max-w-3xl',
    actionBarContent: '<p id="load-hint" class="text-xs opacity-60"></p>',
    escapeAction: 1,
    // Deliberately no `enterAction`: the search box is the field most likely to
    // have focus, and Enter there meaning "load" would fire on a half-typed
    // query. Loading is a click.
    actions: [
      {
        label: 'Load',
        className: 'btn-primary',
        onClick: () => {
          const sel = readForm();
          if (describeBadUrl() || !isComplete(sel)) return true;
          result = sel;
          return;
        },
      },
      { label: 'Cancel', onClick: () => {} },
    ],
    onMount: () => {
      const searchInput = input('load-search');
      const resultsEl = document.getElementById('load-results')!;
      const staticLabelEl = document.getElementById('load-static-label')!;
      const rtLabelEl = document.getElementById('load-rt-label')!;
      const fileInput = input('load-file-input');
      const fileRow = document.getElementById('load-file-row')!;
      const fileNameEl = document.getElementById('load-file-name')!;
      const hintEl = document.getElementById('load-hint')!;
      const loadBtn = resultsEl
        .closest('.modal')!
        .querySelector<HTMLButtonElement>('button[data-idx="0"]')!;

      const renderResults = () => {
        const inUse = new Set([staticRowId, rtRowId].filter(Boolean) as string[]);
        resultsEl.innerHTML = renderRows(visible, inUse);
      };

      /**
       * A file source has no URL, so the URL field and its proxy checkbox stop
       * meaning anything while one is attached.
       */
      const showFile = () => {
        fileNameEl.textContent = staticFile?.name ?? '';
        fileRow.classList.toggle('hidden', !staticFile);
        fileRow.classList.toggle('flex', Boolean(staticFile));
        input('load-static-url').disabled = Boolean(staticFile);
        input('load-static-cors').disabled = Boolean(staticFile);
        if (staticFile) input('load-static-url').value = '';
      };

      const revalidate = () => {
        staticLabelEl.textContent = staticFile ? `— ${staticFile.name}` : `— ${staticLabel}`;
        rtLabelEl.textContent = `— ${rtLabel}`;
        const problem = describeBadUrl() || describeMissing(readForm());
        loadBtn.disabled = problem !== '';
        hintEl.textContent = problem;
      };

      /** Fill whichever slots a row supplies, and leave the other one alone. */
      const applyRow = (rowId: string) => {
        const row = rows.find(r => r.rowId === rowId);
        if (!row) return;

        if (row.provides !== 'rt') {
          staticFile = undefined;
          fileInput.value = '';
          showFile();
          input('load-static-url').value = row.staticUrl ?? '';
          input('load-static-cors').checked = row.staticCors;
          staticLabel = row.name;
          staticRowId = row.rowId;
        }
        if (row.provides !== 'static') {
          input('load-vehicles-url').value = row.vehiclesUrl ?? '';
          input('load-trip-updates-url').value = row.tripUpdatesUrl ?? '';
          input('load-alerts-url').value = row.alertsUrl ?? '';
          input('load-rt-cors').checked = row.rtCors;
          rtLabel = row.name;
          rtRowId = row.rowId;
        }
        renderResults();
        revalidate();
      };

      /**
       * Typing detaches the slot from the row it came from: the URLs are no
       * longer that agency's, so neither is the name.
       */
      const detachStatic = () => {
        if (staticRowId === null) return;
        staticRowId = null;
        staticLabel = CUSTOM_STATIC;
        renderResults();
      };
      const detachRt = () => {
        if (rtRowId === null) return;
        rtRowId = null;
        rtLabel = CUSTOM_RT;
        renderResults();
      };

      const filterAndRender = () => {
        const query = searchInput.value.trim();
        if (!query) {
          visible = rows.slice(0, DISPLAY_CAP);
        } else {
          const idxs = uf.filter(haystack, query) ?? [];
          // uFuzzy ranks by match quality; re-sorting by group keeps the feeds
          // we can vouch for at the top of any query. Stable, so match order
          // still decides within a group.
          visible = idxs
            .map(i => rows[i])
            .sort((a, b) => groupRank.get(a.group)! - groupRank.get(b.group)!)
            .slice(0, DISPLAY_CAP);
        }
        renderResults();
      };

      // Delegated, so re-rendering the list never re-wires handlers.
      resultsEl.addEventListener('click', e => {
        const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-row-id]');
        if (btn?.dataset.rowId) applyRow(btn.dataset.rowId);
      });

      input('load-static-url').addEventListener('input', () => {
        detachStatic();
        revalidate();
      });
      ['load-vehicles-url', 'load-trip-updates-url', 'load-alerts-url'].forEach(id => {
        input(id).addEventListener('input', () => {
          detachRt();
          revalidate();
        });
      });

      document.getElementById('load-upload-btn')!.addEventListener('click', () => {
        fileInput.click();
      });
      fileInput.addEventListener('change', () => {
        staticFile = fileInput.files?.[0];
        detachStatic();
        showFile();
        revalidate();
      });
      document.getElementById('load-file-clear')!.addEventListener('click', () => {
        staticFile = undefined;
        fileInput.value = '';
        showFile();
        revalidate();
      });

      searchInput.addEventListener('input', filterAndRender);

      // Seed from what is loaded, so reopening the modal is how a feed is edited.
      if (current?.static?.kind === 'url') {
        input('load-static-url').value = current.static.url;
        input('load-static-cors').checked = current.static.useCors;
      }
      if (current?.realtime) {
        input('load-vehicles-url').value = current.realtime.vehiclesUrl ?? '';
        input('load-trip-updates-url').value = current.realtime.tripUpdatesUrl ?? '';
        input('load-alerts-url').value = current.realtime.alertsUrl ?? '';
        input('load-rt-cors').checked = current.realtime.useCors;
      }
      showFile();
      revalidate();
      renderResults();
    },
  });

  return result;
}
