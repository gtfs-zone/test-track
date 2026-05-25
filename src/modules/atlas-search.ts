import UFuzzy from '@leeoniya/ufuzzy';
import { showModal } from './modal-utils';

export interface FeedConfig {
  staticUrl?: string;
  staticFile?: File;
  vehiclesUrl?: string;
  tripUpdatesUrl?: string;
  alertsUrl?: string;
  useCors: boolean;
}

interface AtlasFeed {
  id: string;
  name: string;
  operator_name: string;
  location: string;
  staticUrl?: string;
  vehiclesUrl?: string;
  tripUpdatesUrl?: string;
  alertsUrl?: string;
}

let cachedFeeds: AtlasFeed[] | null = null;
let cachedHaystack: string[] | null = null;

async function loadAtlasFeeds(): Promise<AtlasFeed[]> {
  if (cachedFeeds) return cachedFeeds;
  const res = await fetch('/atlas-feeds.json');
  if (!res.ok) throw new Error(`Failed to fetch atlas-feeds.json: ${res.status}`);
  cachedFeeds = await res.json() as AtlasFeed[];
  cachedHaystack = cachedFeeds.map(f => `${f.name} ${f.operator_name} ${f.location}`);
  return cachedFeeds;
}

function renderBadges(feed: AtlasFeed): string {
  const badges: string[] = [];
  if (feed.staticUrl) badges.push('<span class="badge badge-xs badge-neutral">Static</span>');
  if (feed.vehiclesUrl || feed.tripUpdatesUrl || feed.alertsUrl) {
    badges.push('<span class="badge badge-xs badge-primary">RT</span>');
  }
  return badges.join(' ');
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderRows(feeds: AtlasFeed[]): string {
  if (feeds.length === 0) {
    return '<p class="text-sm opacity-40 text-center py-8">No results.</p>';
  }
  return feeds
    .map(
      (f, i) => `
      <button class="w-full text-left px-3 py-2 hover:bg-base-200 rounded-lg flex items-start gap-2" data-feed-idx="${i}">
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium truncate">${escHtml(f.name)}</p>
          <p class="text-xs opacity-60 truncate">${escHtml(f.operator_name)} · ${escHtml(f.location)}</p>
        </div>
        <div class="flex gap-1 shrink-0 pt-0.5">${renderBadges(f)}</div>
      </button>`
    )
    .join('');
}

export async function showAtlasSearchModal(): Promise<FeedConfig | null> {
  let feeds: AtlasFeed[];
  try {
    feeds = await loadAtlasFeeds();
  } catch (err) {
    alert(`Could not load atlas data: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }

  const uf = new UFuzzy();
  let visibleFeeds = feeds;
  let selected: FeedConfig | null = null;

  const actionBarContent = `
    <label class="flex items-center gap-2 text-sm cursor-pointer">
      <input type="checkbox" id="atlas-cors-checkbox" class="checkbox checkbox-sm" checked />
      CORS proxy
    </label>
    <div class="tooltip" data-tip="Routes requests through cors.gtfs.zone when the feed server doesn't send CORS headers.">
      <span class="cursor-help opacity-60 text-xs">?</span>
    </div>
  `;

  const body = `
    <input
      type="text"
      id="atlas-search-input"
      class="input input-bordered w-full mb-3"
      placeholder="Search by agency, city, or region…"
      autofocus
    />
    <div id="atlas-results" class="space-y-0.5 overflow-y-auto max-h-96">${renderRows(feeds)}</div>
  `;

  await showModal({
    title: 'Load from TransitLand Atlas',
    body,
    boxClassName: 'max-w-3xl',
    actionBarContent,
    escapeAction: 0,
    actions: [{ label: 'Cancel', onClick: () => {} }],
    onMount: (close) => {
      const searchInput = document.getElementById('atlas-search-input') as HTMLInputElement;
      const resultsEl = document.getElementById('atlas-results')!;

      const wireRowClicks = () => {
        resultsEl.querySelectorAll<HTMLButtonElement>('[data-feed-idx]').forEach(btn => {
          btn.addEventListener('click', () => {
            const idx = Number(btn.dataset.feedIdx);
            const feed = visibleFeeds[idx];
            const useCors = (document.getElementById('atlas-cors-checkbox') as HTMLInputElement).checked;
            selected = {
              staticUrl: feed.staticUrl,
              vehiclesUrl: feed.vehiclesUrl,
              tripUpdatesUrl: feed.tripUpdatesUrl,
              alertsUrl: feed.alertsUrl,
              useCors,
            };
            close();
          });
        });
      };

      const filterAndRender = () => {
        const query = searchInput.value.trim();
        if (!query) {
          visibleFeeds = feeds;
        } else {
          const idxs = uf.filter(cachedHaystack!, query);
          visibleFeeds = idxs ? idxs.map(i => feeds[i]) : [];
        }
        resultsEl.innerHTML = renderRows(visibleFeeds);
        wireRowClicks();
      };

      searchInput.addEventListener('input', filterAndRender);
      wireRowClicks();
    },
  });

  return selected;
}
