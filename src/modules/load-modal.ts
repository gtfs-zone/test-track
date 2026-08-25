/* @vendored-from coloring-book:src/modules/load-modal.ts
   @sha 6a20621
   @status verbatim */
/**
 * The one way into a feed.
 *
 * Everything that used to be several modals behind a dropdown — curated
 * examples, TransitLand search, hand-typed URLs, file upload — is one screen
 * here, because they were never really different tasks: you are always choosing
 * a feed source, and the only thing that varies is where the URLs come from.
 *
 * So the slots at the top are plain URL fields, and every result row is a
 * shortcut that fills them in. That single change is what makes the rest work:
 * "load an example and then fix one of its URLs" needs no separate mode, and
 * neither does "come back and edit what is loaded" — the modal opens seeded
 * from the current selection, which is why the right panel needs no editors of
 * its own.
 *
 * Rows carry their URLs on the face of them. Two agencies with the same name
 * are otherwise indistinguishable, and it is worth knowing what you are about
 * to fetch before you fetch it.
 *
 * `options.realtime` is the one axis the two apps sharing this file disagree
 * on. With it off the realtime section, its URL fields, and every realtime-only
 * atlas row are simply not emitted, and a scheduled source alone is a complete
 * selection. Everything else — the search, the grouping, upload, CORS, seeding
 * — is identical, which is the whole reason this is one file.
 */

import UFuzzy from '@leeoniya/ufuzzy';
import { EXAMPLES } from './examples';
import type { CatalogFeed } from './feed-catalog';
import { describeLiveness, loadCatalog, realtimePaths } from './feed-catalog';
import type { FeedSelection } from './feed-selection';
import { describeMissing, isComplete } from './feed-selection';
import {
  isLocalUrl,
  normalizeFeedUrl,
  RT_BASE,
  validateFeedUrl,
} from './feed-url-resolve';
import type { ModalAction } from './modal-utils';
import { renderUploadIcon, showModal } from './modal-utils';

/**
 * Where a row came from, in the order the groups are shown. Feeds this stack
 * serves are first because they are the ones we can vouch for; the atlas is
 * last because it is thousands of rows of unverified metadata.
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
  provides: 'pair' | 'scheduled' | 'rt';
  name: string;
  subtitle: string;
  scheduledUrl?: string;
  vehiclesUrl?: string;
  tripUpdatesUrl?: string;
  alertsUrl?: string;
  scheduledCors: boolean;
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
  scheduledUrl?: string;
  vehiclesUrl?: string;
  tripUpdatesUrl?: string;
  alertsUrl?: string;
}

/** What the stored feed is, for the boot screen's continue card. */
export interface ContinueOffer {
  name: string;
  routes: number;
  stops: number;
  trips: number;
  /** Omitted by apps that do not edit; the card drops the count entirely. */
  edits?: number;
}

/**
 * What the modal closed with. `continue` means the user picked the continue
 * card, so the caller restores the feed already in IndexedDB rather than
 * loading anything; `selection` carries what the form was filled with. A
 * discriminated union rather than a sentinel selection, so no caller has to
 * distinguish the two by identity.
 */
export type LoadModalResult =
  | { kind: 'continue' }
  | { kind: 'selection'; selection: FeedSelection }
  | null;

export interface LoadModalOptions {
  /** Show the realtime section and require an RT endpoint. Default true. */
  realtime?: boolean;
  /** Extra buttons in the action bar, e.g. "New Empty Feed". */
  extraActions?: ModalAction[];
  /**
   * Offer the stored feed as the first card. Only boot passes this: reopening
   * the modal from inside a feed is how that feed's URL is edited, and
   * "continue with what is already open" means nothing there.
   */
  continueWith?: ContinueOffer;
}

/** The unfiltered list is thousands of rows; cap what is painted. */
const DISPLAY_CAP = 200;

let cachedAtlas: Promise<AtlasRow[]> | null = null;

function loadAtlasRows(): Promise<AtlasRow[]> {
  cachedAtlas ??= fetch('/atlas-feeds.json').then((res) => {
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
    }
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

function catalogRow(feed: CatalogFeed, realtime: boolean): FeedRow {
  const live = realtime ? describeLiveness(feed) : '';
  return {
    rowId: `verified:${feed.feed_name}`,
    group: 'verified',
    provides: realtime ? 'pair' : 'scheduled',
    name: feed.feed_name,
    subtitle: realtime
      ? live
        ? `serving ${live}`
        : 'no live data right now'
      : '',
    // `static_url` is cafe-car's field name and stays that way on the wire;
    // it is the scheduled feed from here inward.
    scheduledUrl: feed.static_url || undefined,
    ...(realtime ? realtimePaths(feed) : {}),
    // The scheduled half is somebody else's CDN, so it needs the proxy. The
    // realtime half does not: this list only exists because rt.gtfs.zone
    // answered a cross-origin request from here, which is the same permission
    // the .pb endpoints need. Skipping the proxy hop is free accuracy.
    scheduledCors: true,
    rtCors: false,
  };
}

function exampleRows(realtime: boolean): FeedRow[] {
  return EXAMPLES.map((ex, i) => {
    const rt = realtime ? ex.selection.realtime : null;
    const src = ex.selection.scheduled;
    return {
      rowId: `example:${i}`,
      group: 'example' as const,
      provides: (src && rt
        ? 'pair'
        : src
          ? 'scheduled'
          : 'rt') as FeedRow['provides'],
      name: ex.name,
      subtitle: ex.description ?? '',
      scheduledUrl: src?.kind === 'url' ? src.url : undefined,
      vehiclesUrl: rt?.vehiclesUrl,
      tripUpdatesUrl: rt?.tripUpdatesUrl,
      alertsUrl: rt?.alertsUrl,
      scheduledCors: src?.kind === 'url' ? src.useCors : true,
      rtCors: rt?.useCors ?? true,
    };
  });
}

function atlasRow(row: AtlasRow): FeedRow {
  return {
    rowId: `atlas:${row.rowId}`,
    group: 'atlas',
    // The atlas keeps the DMFR corpus's word for it; we do not.
    provides: row.kind === 'static' ? 'scheduled' : 'rt',
    name: row.name,
    subtitle: [row.operator_name, row.source].filter(Boolean).join(' · '),
    scheduledUrl: row.scheduledUrl,
    vehiclesUrl: row.vehiclesUrl,
    tripUpdatesUrl: row.tripUpdatesUrl,
    alertsUrl: row.alertsUrl,
    // Unknown origins, so assume the proxy is needed; the checkbox is there for
    // the ones that turn out not to.
    scheduledCors: true,
    rtCors: true,
  };
}

/**
 * Every row, plus a note for each source that could not be reached.
 *
 * Neither remote source is allowed to keep the modal shut: the examples are
 * compiled in, so there is always something to load even with no network.
 */
async function loadRows(
  realtime: boolean
): Promise<{ rows: FeedRow[]; notes: string[] }> {
  const [catalog, atlas] = await Promise.allSettled([
    loadCatalog(),
    loadAtlasRows(),
  ]);

  const notes: string[] = [];
  const rows: FeedRow[] = [];

  if (catalog.status === 'fulfilled') {
    rows.push(
      ...catalog.value
        .filter((f) => hasUsableData(f, realtime))
        .map((f) => catalogRow(f, realtime))
    );
  } else if (isLocalUrl(RT_BASE)) {
    // A dev machine with no feed server running is the overwhelmingly common
    // reason this fails locally, and it is not something the user can act on.
    // It is not an outage, so it does not get an outage banner.
    console.warn(
      '[LoadModal] feed catalog unreachable at',
      RT_BASE,
      catalog.reason
    );
  } else {
    notes.push(`Feed catalog unavailable — ${reason(catalog.reason)}`);
  }

  rows.push(...exampleRows(realtime));

  if (atlas.status === 'fulfilled') {
    const usable = realtime
      ? atlas.value
      : atlas.value.filter((r) => r.kind === 'static');
    rows.push(...usable.map(atlasRow));
  } else {
    notes.push(`TransitLand atlas unavailable — ${reason(atlas.reason)}`);
  }

  return { rows, notes };
}

/**
 * A feed with nothing in any endpoint is a feed with nothing to show — but only
 * when realtime is what you came for. Without it, a scheduled URL is the whole
 * point and the liveness flags are irrelevant.
 */
function hasUsableData(feed: CatalogFeed, realtime: boolean): boolean {
  if (!realtime) {
    return Boolean(feed.static_url);
  }
  return feed.has_vehicles || feed.has_trip_updates || feed.has_alerts;
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function urlLine(label: string, url: string | undefined): string {
  if (!url) {
    return '';
  }
  return `<p class="text-[11px] font-mono opacity-50 truncate" title="${escHtml(url)}">
    <span class="opacity-70">${label}</span> ${escHtml(url)}
  </p>`;
}

function badges(row: FeedRow, realtime: boolean): string {
  // With one kind of source there is nothing to tell apart, so the badges are
  // pure noise.
  if (!realtime) {
    return '';
  }
  const parts: string[] = [];
  if (row.provides !== 'rt') {
    parts.push('<span class="badge badge-xs badge-neutral">Scheduled</span>');
  }
  if (row.provides !== 'scheduled') {
    parts.push('<span class="badge badge-xs badge-primary">RT</span>');
  }
  return parts.join('');
}

function renderRow(row: FeedRow, inUse: boolean, realtime: boolean): string {
  const classes = inUse
    ? 'bg-primary/10 ring-1 ring-primary/40'
    : 'hover:bg-base-200';
  return `
    <button type="button" class="w-full text-left px-3 py-2 rounded-lg flex items-start gap-2 ${classes}" data-row-id="${escHtml(row.rowId)}">
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium truncate">${escHtml(row.name)}</p>
        ${row.subtitle ? `<p class="text-xs opacity-60 truncate">${escHtml(row.subtitle)}</p>` : ''}
        ${urlLine(realtime ? 'scheduled' : '', row.scheduledUrl)}
        ${realtime ? urlLine('vp', row.vehiclesUrl) : ''}
        ${realtime ? urlLine('tu', row.tripUpdatesUrl) : ''}
        ${realtime ? urlLine('al', row.alertsUrl) : ''}
      </div>
      <div class="flex gap-1 shrink-0 pt-0.5 items-center">
        ${inUse ? '<span class="text-xs opacity-60">in use</span>' : ''}
        ${badges(row, realtime)}
      </div>
    </button>`;
}

/** The visible rows, with a heading wherever the group changes. */
function renderRows(
  rows: FeedRow[],
  inUse: Set<string>,
  realtime: boolean
): string {
  if (rows.length === 0) {
    return '<p class="text-sm opacity-40 text-center py-8">No results.</p>';
  }
  let group: Group | null = null;
  const out: string[] = [];
  for (const row of rows) {
    if (row.group !== group) {
      group = row.group;
      out.push(
        `<p class="text-xs uppercase tracking-wide opacity-50 px-3 pt-3 pb-1">${GROUP_LABELS[group]}</p>`
      );
    }
    out.push(renderRow(row, inUse.has(row.rowId), realtime));
  }
  return out.join('');
}

const CORS_TOOLTIP =
  "Routes requests through cors.kcfam.us when the feed server doesn't send CORS headers.";

function corsToggle(id: string): string {
  return `
    <label class="flex items-center gap-2 text-xs cursor-pointer font-normal shrink-0">
      <input type="checkbox" id="${id}" class="checkbox checkbox-xs" checked />
      CORS proxy
      <span class="tooltip tooltip-left" data-tip="${CORS_TOOLTIP}">
        <span class="cursor-help opacity-60">?</span>
      </span>
    </label>`;
}

function rtField(id: string, label: string, placeholder: string): string {
  return `
    <label class="flex items-center gap-2">
      <span class="text-xs opacity-60 w-28 shrink-0">${label}</span>
      <input type="text" id="${id}" class="input input-bordered input-xs flex-1 min-w-0 font-mono" placeholder="${placeholder}" spellcheck="false" autocomplete="off" />
    </label>`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** The stored feed, as the first thing on the boot screen. */
function continueCard(offer: ContinueOffer): string {
  const counts = [
    plural(offer.routes, 'route'),
    plural(offer.stops, 'stop'),
    plural(offer.trips, 'trip'),
    ...(offer.edits === undefined ? [] : [plural(offer.edits, 'edit')]),
  ].join(', ');
  return `
      <button type="button" id="load-continue" class="shrink-0 w-full text-left rounded-lg border border-primary/40 bg-primary/10 hover:bg-primary/20 p-3">
        <p class="text-sm font-medium truncate">Continue with ${escHtml(offer.name)}</p>
        <p class="text-xs opacity-60 truncate">${escHtml(counts)}</p>
      </button>`;
}

// ─── The modal ────────────────────────────────────────────────────────────────

/** A URL field, its label, and the proxy checkbox that governs it. */
const SCHEDULED_FIELD: [id: string, label: string, corsId: string] = [
  'load-scheduled-url',
  'Scheduled GTFS',
  'load-scheduled-cors',
];

const RT_FIELDS: Array<[id: string, label: string, corsId: string]> = [
  ['load-vehicles-url', 'Vehicle Positions', 'load-rt-cors'],
  ['load-trip-updates-url', 'Trip Updates', 'load-rt-cors'],
  ['load-alerts-url', 'Service Alerts', 'load-rt-cors'],
];

const RT_FIELD_IDS = RT_FIELDS.map(([id]) => id);

function input(id: string): HTMLInputElement {
  return document.getElementById(id) as HTMLInputElement;
}

const CUSTOM_SCHEDULED = 'Custom scheduled feed';
const CUSTOM_RT = 'Custom realtime feed';

export async function showLoadModal(
  current: FeedSelection | null,
  options: LoadModalOptions = {}
): Promise<LoadModalResult> {
  const realtime = options.realtime ?? true;

  /** Every URL field on screen, so validation can name the one that is wrong. */
  const urlFields = realtime
    ? [SCHEDULED_FIELD, ...RT_FIELDS]
    : [SCHEDULED_FIELD];

  /**
   * The first URL problem in the form, or '' when there is none. Reported
   * through the same hint line as the missing-feed message, so the Load button
   * is never enabled on a URL that cannot be fetched.
   */
  const describeBadUrl = (): string => {
    for (const [id, label, corsId] of urlFields) {
      const raw = input(id).value.trim();
      if (!raw) {
        continue;
      }
      const problem = validateFeedUrl(raw, input(corsId).checked);
      if (problem) {
        return `${label}: ${problem}`;
      }
    }
    return '';
  };

  const { rows, notes } = await loadRows(realtime);

  const uf = new UFuzzy();
  // Rows are already in group order, so a filtered view only has to keep that
  // order stable rather than re-derive it.
  const haystack = rows.map((r) =>
    [
      r.name,
      r.subtitle,
      r.scheduledUrl,
      r.vehiclesUrl,
      r.tripUpdatesUrl,
      r.alertsUrl,
    ]
      .filter(Boolean)
      .join(' ')
  );
  const groupRank = new Map(GROUP_ORDER.map((g, i) => [g, i]));

  let visible = rows.slice(0, DISPLAY_CAP);
  let result: LoadModalResult = null;

  // Slot state that is not held in the DOM: the labels a row click supplies,
  // which row each slot came from, and an uploaded file (which cannot be put
  // back into a file input).
  let scheduledLabel = current?.scheduled?.label ?? CUSTOM_SCHEDULED;
  let rtLabel = current?.realtime?.label ?? CUSTOM_RT;
  let scheduledRowId: string | null = null;
  let rtRowId: string | null = null;
  let scheduledFile: File | undefined =
    current?.scheduled?.kind === 'file' ? current.scheduled.file : undefined;

  const rtSection = `
      <section id="load-rt-section" class="shrink-0 rounded-lg border border-base-300 p-3 space-y-2 transition-colors">
        <div class="flex items-center justify-between gap-2">
          <h4 class="font-medium text-sm truncate">
            Realtime GTFS-RT <span id="load-rt-label" class="font-normal opacity-60"></span>
          </h4>
          ${corsToggle('load-rt-cors')}
        </div>
        ${rtField('load-vehicles-url', 'Vehicle Positions', 'https://…/vehicle_positions.pb')}
        ${rtField('load-trip-updates-url', 'Trip Updates', 'https://…/trip_updates.pb')}
        ${rtField('load-alerts-url', 'Service Alerts', 'https://…/alerts.pb')}
      </section>`;

  const scheduledSection = `
      <section id="load-scheduled-section" class="shrink-0 rounded-lg border border-base-300 p-3 space-y-2 transition-colors">
        <div class="flex items-center justify-between gap-2">
          <h4 class="font-medium text-sm truncate">
            Scheduled GTFS <span id="load-scheduled-label" class="font-normal opacity-60"></span>
          </h4>
          ${corsToggle('load-scheduled-cors')}
        </div>
        <div class="flex gap-2">
          <input type="text" id="load-scheduled-url" class="input input-bordered input-xs flex-1 min-w-0 font-mono" placeholder="https://…/gtfs.zip  (append #inner.zip for a nested feed)" spellcheck="false" autocomplete="off" />
          <button type="button" id="load-upload-btn" class="btn btn-xs btn-outline gap-1 shrink-0">
            ${renderUploadIcon('h-3.5 w-3.5')} Upload ZIP
          </button>
          <input type="file" id="load-file-input" accept=".zip" class="hidden" />
        </div>
        <div id="load-file-row" class="hidden items-center gap-2">
          <p id="load-file-name" class="text-xs opacity-60 truncate"></p>
          <button type="button" id="load-file-clear" class="btn btn-ghost btn-xs shrink-0">Clear</button>
        </div>
      </section>`;

  // A fixed-height column, not a stack that grows with its contents. The slots
  // are as tall as they are — the realtime app has four URL fields where the
  // editor has one — so a content-sized modal is a different height in each
  // app, and tall enough in the realtime one to make the modal body scroll
  // *behind* the result list's own scrollbar. Pinning the height and letting
  // the results absorb the slack means there is exactly one scrollbar on the
  // screen, always the same one, in both apps.
  //
  // Search first: the catalog is how most feeds are loaded, so it and its
  // results lead, and the URL/upload block sits below as the escape hatch.
  const body = `
    <div class="flex h-full min-h-0 min-w-0 flex-col gap-3">
      ${options.continueWith ? continueCard(options.continueWith) : ''}

      <input type="text" id="load-search" class="input input-bordered input-sm w-full shrink-0" placeholder="Search by agency, operator, source, or URL…" autofocus />
      <div id="load-results" class="min-h-0 flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden"></div>

      ${notes.map((n) => `<p class="shrink-0 text-xs text-warning">${escHtml(n)}</p>`).join('')}

      ${scheduledSection}

      ${realtime ? rtSection : ''}
    </div>
  `;

  /** The current form state as a selection. */
  const readForm = (): FeedSelection => {
    const val = (id: string) => normalizeFeedUrl(input(id).value);
    const checked = (id: string) => input(id).checked;

    const scheduledUrl = val('load-scheduled-url');

    let scheduledSource: FeedSelection['scheduled'] = null;
    if (scheduledFile) {
      scheduledSource = {
        kind: 'file',
        file: scheduledFile,
        label: scheduledFile.name,
      };
    } else if (scheduledUrl) {
      scheduledSource = {
        kind: 'url',
        url: scheduledUrl,
        useCors: checked('load-scheduled-cors'),
        label: scheduledLabel,
      };
    }

    if (!realtime) {
      return { scheduled: scheduledSource, realtime: null };
    }

    const vehiclesUrl = val('load-vehicles-url');
    const tripUpdatesUrl = val('load-trip-updates-url');
    const alertsUrl = val('load-alerts-url');
    const hasRt = Boolean(vehiclesUrl || tripUpdatesUrl || alertsUrl);
    return {
      scheduled: scheduledSource,
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
    title: options.continueWith ? 'Open a Feed' : 'Load Feed',
    body,
    // An explicit height, not just a cap: `h-full` on the body only resolves
    // against a definite one, and that is what lets the result list flex. Width
    // is deliberately not set here, so both apps take it from their own
    // `showModal` default and the modal is the same size in each.
    boxClassName: 'h-[80vh]',
    actionBarContent:
      '<p id="load-hint" class="text-xs opacity-60 min-w-0 truncate"></p>',
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
          if (describeBadUrl() || !isComplete(sel, realtime)) {
            return true;
          }
          result = { kind: 'selection', selection: sel };
          return;
        },
      },
      { label: 'Cancel', onClick: () => {} },
      ...(options.extraActions ?? []),
    ],
    onMount: (close) => {
      // The continue card is its own action: it neither reads nor validates the
      // form, so it closes the modal directly rather than going through one of
      // the action-bar buttons.
      document
        .getElementById('load-continue')
        ?.addEventListener('click', () => {
          result = { kind: 'continue' };
          close();
        });

      const searchInput = input('load-search');
      const resultsEl = document.getElementById('load-results')!;
      const scheduledLabelEl = document.getElementById('load-scheduled-label')!;
      const rtLabelEl = document.getElementById('load-rt-label');
      const fileInput = input('load-file-input');
      const fileRow = document.getElementById('load-file-row')!;
      const fileNameEl = document.getElementById('load-file-name')!;
      const hintEl = document.getElementById('load-hint')!;
      const loadBtn = resultsEl
        .closest('.modal')!
        .querySelector<HTMLButtonElement>('button[data-idx="0"]')!;

      const renderResults = () => {
        const inUse = new Set(
          [scheduledRowId, rtRowId].filter(Boolean) as string[]
        );
        resultsEl.innerHTML = renderRows(visible, inUse, realtime);
      };

      /**
       * A file source has no URL, so the URL field and its proxy checkbox stop
       * meaning anything while one is attached.
       */
      const showFile = () => {
        fileNameEl.textContent = scheduledFile?.name ?? '';
        fileRow.classList.toggle('hidden', !scheduledFile);
        fileRow.classList.toggle('flex', Boolean(scheduledFile));
        input('load-scheduled-url').disabled = Boolean(scheduledFile);
        input('load-scheduled-cors').disabled = Boolean(scheduledFile);
        if (scheduledFile) {
          input('load-scheduled-url').value = '';
        }
      };

      const revalidate = () => {
        scheduledLabelEl.textContent = scheduledFile
          ? `— ${scheduledFile.name}`
          : `— ${scheduledLabel}`;
        if (rtLabelEl) {
          rtLabelEl.textContent = `— ${rtLabel}`;
        }
        const problem =
          describeBadUrl() || describeMissing(readForm(), realtime);
        loadBtn.disabled = problem !== '';
        hintEl.textContent = problem;
      };

      /**
       * The URL block sits below the result list, so a row click fills a
       * section the eye is not on. Flash its border to say the click landed.
       */
      const flashSection = (id: string) => {
        const el = document.getElementById(id);
        if (!el) {
          return;
        }
        el.classList.add('border-primary', 'bg-primary/5');
        window.setTimeout(() => {
          el.classList.remove('border-primary', 'bg-primary/5');
        }, 600);
      };

      /** Fill whichever slots a row supplies, and leave the other one alone. */
      const applyRow = (rowId: string) => {
        const row = rows.find((r) => r.rowId === rowId);
        if (!row) {
          return;
        }

        if (row.provides !== 'rt') {
          scheduledFile = undefined;
          fileInput.value = '';
          showFile();
          input('load-scheduled-url').value = row.scheduledUrl ?? '';
          input('load-scheduled-cors').checked = row.scheduledCors;
          scheduledLabel = row.name;
          scheduledRowId = row.rowId;
          flashSection('load-scheduled-section');
        }
        if (realtime && row.provides !== 'scheduled') {
          input('load-vehicles-url').value = row.vehiclesUrl ?? '';
          input('load-trip-updates-url').value = row.tripUpdatesUrl ?? '';
          input('load-alerts-url').value = row.alertsUrl ?? '';
          input('load-rt-cors').checked = row.rtCors;
          rtLabel = row.name;
          rtRowId = row.rowId;
          flashSection('load-rt-section');
        }
        renderResults();
        revalidate();
      };

      /**
       * Typing detaches the slot from the row it came from: the URLs are no
       * longer that agency's, so neither is the name.
       */
      const detachScheduled = () => {
        if (scheduledRowId === null) {
          return;
        }
        scheduledRowId = null;
        scheduledLabel = CUSTOM_SCHEDULED;
        renderResults();
      };
      const detachRt = () => {
        if (rtRowId === null) {
          return;
        }
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
            .map((i) => rows[i])
            .sort((a, b) => groupRank.get(a.group)! - groupRank.get(b.group)!)
            .slice(0, DISPLAY_CAP);
        }
        renderResults();
      };

      // Delegated, so re-rendering the list never re-wires handlers.
      resultsEl.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLElement>(
          '[data-row-id]'
        );
        if (btn?.dataset.rowId) {
          applyRow(btn.dataset.rowId);
        }
      });

      input('load-scheduled-url').addEventListener('input', () => {
        detachScheduled();
        revalidate();
      });
      if (realtime) {
        RT_FIELD_IDS.forEach((id) => {
          input(id).addEventListener('input', () => {
            detachRt();
            revalidate();
          });
        });
      }

      // The proxy checkbox is an input to URL validation, not just to the
      // result, so an http URL flips between fine and blocked as it is toggled.
      input('load-scheduled-cors').addEventListener('change', revalidate);
      if (realtime) {
        input('load-rt-cors').addEventListener('change', revalidate);
      }

      document
        .getElementById('load-upload-btn')!
        .addEventListener('click', () => {
          fileInput.click();
        });
      fileInput.addEventListener('change', () => {
        scheduledFile = fileInput.files?.[0];
        detachScheduled();
        showFile();
        revalidate();
      });
      document
        .getElementById('load-file-clear')!
        .addEventListener('click', () => {
          scheduledFile = undefined;
          fileInput.value = '';
          showFile();
          revalidate();
        });

      searchInput.addEventListener('input', filterAndRender);

      // Seed from what is loaded, so reopening the modal is how a feed is edited.
      if (current?.scheduled?.kind === 'url') {
        input('load-scheduled-url').value = current.scheduled.url;
        input('load-scheduled-cors').checked = current.scheduled.useCors;
      }
      if (realtime && current?.realtime) {
        input('load-vehicles-url').value = current.realtime.vehiclesUrl ?? '';
        input('load-trip-updates-url').value =
          current.realtime.tripUpdatesUrl ?? '';
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
