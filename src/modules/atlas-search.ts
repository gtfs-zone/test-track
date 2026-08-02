import UFuzzy from '@leeoniya/ufuzzy';
import { showModal } from './modal-utils';
import type { FeedSelection } from './feed-selection';
import { describeMissing, isComplete } from './feed-selection';
import { notify } from './notification-system';

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

let cachedRows: AtlasRow[] | null = null;
let cachedById: Map<string, AtlasRow> | null = null;
let cachedHaystack: string[] | null = null;

async function loadAtlasRows(): Promise<AtlasRow[]> {
  if (cachedRows) return cachedRows;
  const res = await fetch('/atlas-feeds.json');
  if (!res.ok) throw new Error(`Failed to fetch atlas-feeds.json: ${res.status}`);
  const rows = await res.json() as AtlasRow[];
  cachedRows = rows;
  cachedById = new Map(rows.map(r => [r.rowId, r]));
  cachedHaystack = rows.map(r => `${r.name} ${r.operator_name} ${r.source}`);
  return rows;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function kindBadge(kind: AtlasRow['kind']): string {
  return kind === 'static'
    ? '<span class="badge badge-xs badge-neutral">Static</span>'
    : '<span class="badge badge-xs badge-primary">RT</span>';
}

/** Secondary line: operator and source, whichever of them we actually have. */
function subtitle(row: AtlasRow): string {
  return [row.operator_name, row.source].filter(Boolean).join(' · ');
}

function renderRow(row: AtlasRow, pinned: boolean): string {
  const pinnedClasses = pinned
    ? 'bg-primary/10 ring-1 ring-primary/40'
    : 'hover:bg-base-200';
  return `
    <button
      class="w-full text-left px-3 py-2 rounded-lg flex items-start gap-2 ${pinnedClasses}"
      data-row-id="${escHtml(row.rowId)}"
    >
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium truncate">${escHtml(row.name)}</p>
        <p class="text-xs opacity-60 truncate">${escHtml(subtitle(row))}</p>
      </div>
      <div class="flex gap-1 shrink-0 pt-0.5 items-center">
        ${pinned ? '<span class="text-xs opacity-60">pinned</span>' : ''}
        ${kindBadge(row.kind)}
      </div>
    </button>`;
}

function renderRows(rows: AtlasRow[], pinnedIds: Set<string>): string {
  if (rows.length === 0) {
    return '<p class="text-sm opacity-40 text-center py-8">No results.</p>';
  }
  return rows.map(r => renderRow(r, pinnedIds.has(r.rowId))).join('');
}

/** One slot of the pinned strip. Empty slots still render, as a prompt. */
function renderSlot(label: string, row: AtlasRow | null, corsId: string): string {
  if (!row) {
    return `
      <div class="flex-1 min-w-0 rounded-lg border border-dashed border-base-300 px-3 py-2">
        <p class="text-xs uppercase tracking-wide opacity-50">${label}</p>
        <p class="text-sm opacity-40 truncate">Not chosen — click a ${label} result</p>
      </div>`;
  }
  return `
    <div class="flex-1 min-w-0 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2">
      <p class="text-xs uppercase tracking-wide opacity-50">${label}</p>
      <p class="text-sm font-medium truncate">${escHtml(row.name)}</p>
      <p class="text-xs opacity-60 truncate">${escHtml(subtitle(row))}</p>
      <label class="flex items-center gap-2 text-xs cursor-pointer mt-1">
        <input type="checkbox" id="${corsId}" class="checkbox checkbox-xs" checked />
        CORS proxy
      </label>
    </div>`;
}

function toSelection(
  staticPin: AtlasRow | null,
  rtPin: AtlasRow | null,
  staticCors: boolean,
  rtCors: boolean,
): FeedSelection {
  return {
    static: staticPin?.staticUrl
      ? { kind: 'url', url: staticPin.staticUrl, useCors: staticCors, label: staticPin.name }
      : null,
    realtime: rtPin
      ? {
          vehiclesUrl: rtPin.vehiclesUrl,
          tripUpdatesUrl: rtPin.tripUpdatesUrl,
          alertsUrl: rtPin.alertsUrl,
          useCors: rtCors,
          label: rtPin.name,
        }
      : null,
  };
}

export async function showAtlasSearchModal(): Promise<FeedSelection | null> {
  let rows: AtlasRow[];
  try {
    rows = await loadAtlasRows();
  } catch (err) {
    notify.error(`Could not load atlas data: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }

  const uf = new UFuzzy();
  let visibleRows = rows.slice(0, 200);
  let staticPin: AtlasRow | null = null;
  let rtPin: AtlasRow | null = null;
  // CORS choices survive a pin being replaced, so the user sets them once.
  let staticCors = true;
  let rtCors = true;
  let result: FeedSelection | null = null;

  const body = `
    <div id="atlas-pins" class="flex gap-2 mb-3"></div>
    <input
      type="text"
      id="atlas-search-input"
      class="input input-bordered w-full mb-3"
      placeholder="Search by agency, operator, or source…"
      autofocus
    />
    <div id="atlas-results" class="space-y-0.5 overflow-y-auto max-h-96"></div>
    <p id="atlas-hint" class="text-xs opacity-50 mt-2"></p>
  `;

  await showModal({
    title: 'Load from TransitLand Atlas',
    body,
    boxClassName: 'max-w-3xl',
    escapeAction: 1,
    actions: [
      {
        label: 'Load',
        className: 'btn-primary',
        onClick: () => {
          const sel = toSelection(staticPin, rtPin, staticCors, rtCors);
          if (!isComplete(sel)) return true;
          result = sel;
          return;
        },
      },
      { label: 'Cancel', onClick: () => {} },
    ],
    onMount: () => {
      const searchInput = document.getElementById('atlas-search-input') as HTMLInputElement;
      const resultsEl = document.getElementById('atlas-results')!;
      const pinsEl = document.getElementById('atlas-pins')!;
      const hintEl = document.getElementById('atlas-hint')!;
      const loadBtn = resultsEl
        .closest('.modal')!
        .querySelector<HTMLButtonElement>('button[data-idx="0"]')!;

      const pinnedIds = () =>
        new Set([staticPin?.rowId, rtPin?.rowId].filter(Boolean) as string[]);

      const renderResults = () => {
        resultsEl.innerHTML = renderRows(visibleRows, pinnedIds());
      };

      const renderPins = () => {
        pinsEl.innerHTML =
          renderSlot('Static', staticPin, 'atlas-static-cors') +
          renderSlot('Realtime', rtPin, 'atlas-rt-cors');

        const staticBox = document.getElementById('atlas-static-cors') as HTMLInputElement | null;
        if (staticBox) {
          staticBox.checked = staticCors;
          staticBox.addEventListener('change', () => { staticCors = staticBox.checked; });
        }
        const rtBox = document.getElementById('atlas-rt-cors') as HTMLInputElement | null;
        if (rtBox) {
          rtBox.checked = rtCors;
          rtBox.addEventListener('change', () => { rtCors = rtBox.checked; });
        }

        const missing = describeMissing(toSelection(staticPin, rtPin, staticCors, rtCors));
        loadBtn.disabled = missing !== '';
        hintEl.textContent = missing;
      };

      /** Click a row: pin it, replace the pin of its kind, or unpin it. */
      const togglePin = (rowId: string) => {
        const row = cachedById!.get(rowId);
        if (!row) return;
        if (row.kind === 'static') {
          staticPin = staticPin?.rowId === rowId ? null : row;
        } else {
          rtPin = rtPin?.rowId === rowId ? null : row;
        }
        renderPins();
        renderResults();
      };

      const filterAndRender = () => {
        const query = searchInput.value.trim();
        if (!query) {
          // The full list is ~4k rows; cap the unfiltered view so the first
          // paint stays cheap.
          visibleRows = rows.slice(0, 200);
        } else {
          const idxs = uf.filter(cachedHaystack!, query);
          visibleRows = idxs ? idxs.slice(0, 200).map(i => rows[i]) : [];
        }
        renderResults();
      };

      // Delegated so re-rendering the list never re-wires handlers, and so a
      // pinned row stays clickable wherever it appears.
      resultsEl.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-row-id]');
        if (btn?.dataset.rowId) togglePin(btn.dataset.rowId);
      });

      searchInput.addEventListener('input', filterAndRender);
      renderPins();
      renderResults();
    },
  });

  return result;
}
