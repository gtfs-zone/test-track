import { showModal } from './modal-utils';
import type { FeedSelection } from './feed-selection';

export interface ExampleFeed {
  name: string;
  description?: string;
  selection: FeedSelection;
}

/**
 * Curated, ready-to-load pairs. Every entry names both a static source and a
 * realtime source, so picking one satisfies the load requirement in one click.
 *
 * `useCors` is set per source from what the origin actually sends: the
 * Columbia County zip is served from GitHub with `access-control-allow-origin: *`
 * and needs no proxy; rt.gtfs.zone, cdn.mbta.com and content.amtrak.com send no
 * CORS headers, so they do.
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
        url: 'https://github.com/maxtkc/columbia-county-gtfs/raw/refs/heads/main/columbia_county_gtfs.zip',
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
