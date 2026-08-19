/* @vendored-from coloring-book:src/modules/search-controller.ts
   @sha a4b5ee1
   @status verbatim */
/**
 * The map search box.
 *
 * Deliberately knows nothing about GTFS, the database, or page state: the app
 * supplies entries through `getEntries()` and receives an opaque payload back
 * through `onSelect()`. That is what lets the same file be vendored verbatim
 * into sibling apps whose data layer and `PageState` union differ.
 *
 * Entries are rebuilt on every (debounced) query, always fresh, no cache to
 * invalidate against the patch system. If typing ever feels laggy on a large
 * feed, the fix is to cache the entry list in the adapter and invalidate it on
 * feed load/reset and on patch writes; nothing in here has to change.
 */

import uFuzzy from '@leeoniya/ufuzzy';

export interface SearchEntry<T> {
  /** Handed back to `onSelect` untouched, the app's own focus descriptor. */
  payload: T;
  /** Marker HTML, from the helpers below. */
  icon: string;
  primary: string;
  secondary?: string;
  /** Everything worth matching against, joined with spaces. */
  haystack: string;
  /** Lower sorts first. Entries without one are treated as 0. */
  priority?: number;
}

export interface SearchControllerOptions<T> {
  getEntries: () => SearchEntry<T>[] | Promise<SearchEntry<T>[]>;
  onSelect: (payload: T) => void;
  limit?: number;
  minQueryLength?: number;
}

// `intraIns: 1` tolerates one inserted character inside a term; terms
// themselves are already allowed to be far apart, so "Charles MGH" finds
// "Charles/MGH" without any special casing.
const uf = new uFuzzy({ intraIns: 1 });

const DEBOUNCE_MS = 200;

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Markers ──────────────────────────────────────────────────────────────────
//
// These mirror how the map paints the same objects, see the `circle-color`
// expressions in `layer-manager.ts`, which is the source of truth for the
// palette. Change one, change the other. Every marker carries a hairline ring
// because feed colors (and the white station fill) routinely collide with the
// page background.

const RING = 'box-shadow:0 0 0 1px rgba(128,128,128,0.45)';

/** Stop circle, colored by `location_type` exactly as the map does. */
export function stopMarker(location_type?: string | number): string {
  const type = Number(location_type ?? 0);
  if (type === 1) {
    // Station: white circle with the black inner dot from `stops-station-dot`.
    return `<span class="inline-flex items-center justify-center shrink-0 rounded-full" style="width:11px;height:11px;background:#ffffff;${RING}"><span style="width:4px;height:4px;border-radius:9999px;background:#111111"></span></span>`;
  }
  const fill =
    type === 2
      ? '#f59e0b' // entrance
      : type === 3
        ? '#8b5cf6' // generic node
        : type === 4
          ? '#10b981' // boarding area
          : '#ffffff'; // plain stop / platform
  return dotMarker(fill);
}

/** A plain filled circle: plain stops, and realtime vehicles in route color. */
export function dotMarker(color: string): string {
  return `<span class="inline-block shrink-0 rounded-full" style="width:11px;height:11px;background:${esc(color)};${RING}"></span>`;
}

/** Route bar, in `route_color`, echoing the route line on the map. */
export function routeMarker(color?: string): string {
  const fill = color
    ? color.startsWith('#')
      ? color
      : `#${color}`
    : '#3b82f6';
  return `<span class="inline-block shrink-0 rounded-sm" style="width:14px;height:5px;background:${esc(fill)};${RING}"></span>`;
}

/** For objects with no map counterpart (agencies): a neutral outlined circle. */
export function neutralMarker(): string {
  return `<span class="inline-block shrink-0 rounded-full" style="width:11px;height:11px;background:transparent;${RING}"></span>`;
}

// ─── Controller ───────────────────────────────────────────────────────────────

export class SearchController<T> {
  private opts: SearchControllerOptions<T>;
  private input: HTMLInputElement | null = null;
  private dropdown: HTMLElement | null = null;
  private matches: SearchEntry<T>[] = [];
  private activeIndex = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  /** Guards against a slow `getEntries()` overwriting a newer query. */
  private requestId = 0;

  constructor(opts: SearchControllerOptions<T>) {
    this.opts = opts;
  }

  initialize(): void {
    const input = document.getElementById(
      'map-search'
    ) as HTMLInputElement | null;
    const card = document.getElementById('map-search-card');
    if (!input || !card) {
      console.warn('[Search] #map-search or #map-search-card missing');
      return;
    }

    this.input = input;
    this.dropdown = document.createElement('div');
    this.dropdown.id = 'search-results';
    this.dropdown.className =
      'hidden absolute top-full left-0 right-0 mt-1 bg-base-100 border border-base-300 rounded-lg shadow-lg max-h-80 overflow-y-auto z-50';
    card.appendChild(this.dropdown);

    input.addEventListener('input', () => this.queueSearch());
    input.addEventListener('focus', () => this.queueSearch());
    input.addEventListener('keydown', (e) => this.onKeyDown(e));

    document.addEventListener('click', (e) => {
      if (!(e.target as Element | null)?.closest('#map-search-card')) {
        this.hide();
      }
    });
  }

  clearSearch(): void {
    if (this.input) {
      this.input.value = '';
    }
    this.hide();
  }

  private queueSearch(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.search(this.input?.value.trim() ?? '');
    }, DEBOUNCE_MS);
  }

  private async search(query: string): Promise<void> {
    if (query.length < (this.opts.minQueryLength ?? 2)) {
      this.hide();
      return;
    }

    const id = ++this.requestId;
    let entries: SearchEntry<T>[];
    try {
      entries = await this.opts.getEntries();
    } catch (error) {
      console.error('[Search] Failed to build entries:', error);
      this.renderMessage('Search failed, see the console');
      return;
    }
    if (id !== this.requestId) {
      return; // a newer query is already in flight
    }

    const [idxs, info, order] = uf.search(
      entries.map((e) => e.haystack),
      query
    );
    // `info.idx` maps an info slot back to its haystack index, and `order` is
    // those slots in rank order, so `info.idx[order[i]]` is the entry index.
    const ranked = info && order ? order.map((o) => info.idx[o]) : (idxs ?? []);

    // Stable sort: entries with equal priority keep uFuzzy's quality order.
    const matches = ranked.map((i) => entries[i]);
    matches.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
    this.matches = matches.slice(0, this.opts.limit ?? 20);
    this.activeIndex = 0;
    this.render(query);
  }

  private render(query: string): void {
    if (!this.dropdown) {
      return;
    }
    if (this.matches.length === 0) {
      this.renderMessage(`No results for "${esc(query)}"`);
      return;
    }

    this.dropdown.innerHTML = '';
    this.matches.forEach((entry, i) => {
      const row = document.createElement('div');
      row.className =
        'flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-base-200 border-b border-base-200 last:border-0';
      row.innerHTML = `
        ${entry.icon}
        <span class="min-w-0 flex-1 truncate text-sm">${esc(entry.primary)}</span>
        ${entry.secondary ? `<span class="shrink-0 text-xs opacity-60">${esc(entry.secondary)}</span>` : ''}
      `;
      row.addEventListener('mouseenter', () => this.setActive(i));
      row.addEventListener('click', () => this.select(i));
      this.dropdown!.appendChild(row);
    });

    this.show();
    this.setActive(0);
  }

  private renderMessage(html: string): void {
    if (!this.dropdown) {
      return;
    }
    this.matches = [];
    this.dropdown.innerHTML = `<div class="px-3 py-4 text-center text-sm opacity-60">${html}</div>`;
    this.show();
  }

  private setActive(index: number): void {
    this.activeIndex = index;
    const rows = this.dropdown?.children;
    if (!rows) {
      return;
    }
    for (let i = 0; i < rows.length; i++) {
      rows[i].classList.toggle('bg-base-200', i === index);
    }
    rows[index]?.scrollIntoView({ block: 'nearest' });
  }

  private select(index: number): void {
    const entry = this.matches[index];
    if (!entry) {
      return;
    }
    this.hide();
    this.input?.blur();
    this.opts.onSelect(entry.payload);
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.hide();
      this.input?.blur();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.select(this.activeIndex);
    } else if (e.key === 'ArrowDown' && this.matches.length > 0) {
      e.preventDefault();
      this.setActive((this.activeIndex + 1) % this.matches.length);
    } else if (e.key === 'ArrowUp' && this.matches.length > 0) {
      e.preventDefault();
      this.setActive(
        (this.activeIndex - 1 + this.matches.length) % this.matches.length
      );
    }
  }

  private show(): void {
    this.dropdown?.classList.remove('hidden');
  }

  private hide(): void {
    this.dropdown?.classList.add('hidden');
  }
}
