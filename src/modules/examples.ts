import { showModal } from './modal-utils';
import type { FeedSelection } from './feed-selection';

export interface ExampleFeed {
  name: string;
  description?: string;
  selection: FeedSelection;
}

/**
 * The music-student stack running on this machine, for working against a feed
 * before it is deployed.
 *
 * The realtime URLs are same-origin `/rt-local/**` paths that vite forwards to
 * `localhost:8000` (see `server.proxy` in `vite.config.js`), not direct
 * localhost URLs. cafe-car's `CORS_ALLOWED_ORIGINS` names a single fixed origin
 * and vite quietly moves to 8081+ when 8080 is already taken, so a direct fetch
 * fails CORS the moment the port shifts; going through the dev server never
 * does. `useCors` stays false throughout — the remote CORS proxy could not
 * reach a local stack anyway.
 *
 * The static halves stay on their public origins — only the realtime side is
 * served locally.
 */
const LOCAL_EXAMPLES: ExampleFeed[] = [
  {
    name: 'Amtrak (local)',
    description: 'Amtrak static, realtime from the local music-student stack',
    selection: {
      static: {
        kind: 'url',
        url: 'https://content.amtrak.com/content/gtfs/GTFS.zip',
        useCors: true,
        label: 'Amtrak',
      },
      realtime: {
        vehiclesUrl: '/rt-local/amtrak/vehicle_positions.pb',
        tripUpdatesUrl: '/rt-local/amtrak/trip_updates.pb',
        alertsUrl: '/rt-local/amtrak/service_alerts.pb',
        useCors: false,
        label: 'Amtrak RT (local)',
      },
    },
  },
  {
    name: 'Columbia County (local)',
    description: 'Columbia County static, realtime from the local music-student stack',
    selection: {
      static: {
        kind: 'url',
        url: 'https://raw.githubusercontent.com/columbia-county-ny-transit/gtfs-generator/refs/heads/main/columbia_county_gtfs.zip',
        useCors: false,
        label: 'Columbia County',
      },
      realtime: {
        vehiclesUrl: '/rt-local/columbia-county/vehicle_positions.pb',
        tripUpdatesUrl: '/rt-local/columbia-county/trip_updates.pb',
        alertsUrl: '/rt-local/columbia-county/service_alerts.pb',
        useCors: false,
        label: 'Columbia County RT (local)',
      },
    },
  },
];

/**
 * Curated, ready-to-load pairs. Every entry names both a static source and a
 * realtime source, so picking one satisfies the load requirement in one click.
 *
 * `useCors` is set per source from what the origin actually sends. Only
 * `raw.githubusercontent.com` sends `access-control-allow-origin: *`, so a
 * GitHub-hosted zip must point there directly and needs no proxy — a
 * `github.com/**\/raw/**` URL is never directly fetchable (it 301/302s through
 * hops that send no usable CORS header, which the browser aborts) and must be
 * rewritten to `raw.githubusercontent.com` or proxied. rt.gtfs.zone,
 * cdn.mbta.com and content.amtrak.com send no CORS headers, so they proxy.
 */
export const EXAMPLES: ExampleFeed[] = [
  {
    name: 'Amtrak',
    description: 'National rail — static from Amtrak, realtime via rt.gtfs.zone',
    selection: {
      static: {
        kind: 'url',
        url: 'https://content.amtrak.com/content/gtfs/GTFS.zip',
        useCors: true,
        label: 'Amtrak',
      },
      realtime: {
        vehiclesUrl: 'https://rt.gtfs.zone/amtrak/vehicle_positions.pb',
        tripUpdatesUrl: 'https://rt.gtfs.zone/amtrak/trip_updates.pb',
        alertsUrl: 'https://rt.gtfs.zone/amtrak/service_alerts.pb',
        useCors: true,
        label: 'Amtrak RT',
      },
    },
  },
  {
    name: 'Columbia County',
    description: 'Columbia County Public Transportation, NY — realtime via rt.gtfs.zone',
    selection: {
      static: {
        kind: 'url',
        url: 'https://raw.githubusercontent.com/columbia-county-ny-transit/gtfs-generator/refs/heads/main/columbia_county_gtfs.zip',
        useCors: false,
        label: 'Columbia County',
      },
      realtime: {
        vehiclesUrl: 'https://rt.gtfs.zone/columbia-county/vehicle_positions.pb',
        tripUpdatesUrl: 'https://rt.gtfs.zone/columbia-county/trip_updates.pb',
        alertsUrl: 'https://rt.gtfs.zone/columbia-county/service_alerts.pb',
        useCors: true,
        label: 'Columbia County RT',
      },
    },
  },
  {
    name: 'MBTA',
    description: 'Boston — three separate realtime .pb files straight from the agency',
    selection: {
      static: {
        kind: 'url',
        url: 'https://cdn.mbta.com/MBTA_GTFS.zip',
        useCors: true,
        label: 'MBTA',
      },
      realtime: {
        vehiclesUrl: 'https://cdn.mbta.com/realtime/VehiclePositions.pb',
        tripUpdatesUrl: 'https://cdn.mbta.com/realtime/TripUpdates.pb',
        alertsUrl: 'https://cdn.mbta.com/realtime/Alerts.pb',
        useCors: true,
        label: 'MBTA RT',
      },
    },
  },
  // Dev only — a localhost URL is dead weight in the built site.
  ...(import.meta.env.DEV ? LOCAL_EXAMPLES : []),
];

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderRows(examples: ExampleFeed[]): string {
  if (examples.length === 0) {
    return '<p class="text-sm opacity-40 text-center py-8">No examples configured yet.</p>';
  }
  return examples
    .map(
      (ex, i) => `
      <button class="w-full text-left px-3 py-2 hover:bg-base-200 rounded-lg flex items-start gap-2" data-example-idx="${i}">
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium truncate">${escHtml(ex.name)}</p>
          ${ex.description ? `<p class="text-xs opacity-60 truncate">${escHtml(ex.description)}</p>` : ''}
        </div>
        <div class="flex gap-1 shrink-0 pt-0.5">
          <span class="badge badge-xs badge-neutral">Static</span>
          <span class="badge badge-xs badge-primary">RT</span>
        </div>
      </button>`
    )
    .join('');
}

export async function showExamplesModal(): Promise<FeedSelection | null> {
  let selected: FeedSelection | null = null;

  const body = `<div class="space-y-0.5">${renderRows(EXAMPLES)}</div>`;

  await showModal({
    title: 'Examples',
    body,
    escapeAction: 0,
    actions: [{ label: 'Cancel', onClick: () => {} }],
    onMount: (close) => {
      document.querySelectorAll<HTMLButtonElement>('[data-example-idx]').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.dataset.exampleIdx);
          selected = EXAMPLES[idx].selection;
          close();
        });
      });
    },
  });

  return selected;
}
