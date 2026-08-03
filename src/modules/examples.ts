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
 * Feeds served by our own stack use **path-only** realtime URLs. Those resolve
 * against `RT_BASE` at fetch time (`feed-url-resolve.ts`): the local cafe-car in
 * dev, rt.gtfs.zone in the built site. So there is no separate set of "local"
 * examples to keep in sync, and a link someone shares works wherever it is
 * opened. `useCors: true` is correct for both halves of that — the proxy is what
 * rt.gtfs.zone needs in prod, and `maybeProxy` bypasses it for the local host in
 * dev. Feeds hosted by an agency stay absolute, since there is no single origin
 * to resolve them against.
 *
 * `useCors` is otherwise set per source from what the origin actually sends.
 * Only `raw.githubusercontent.com` sends `access-control-allow-origin: *`, so a
 * GitHub-hosted zip must point there directly and needs no proxy — a
 * `github.com/**\/raw/**` URL is never directly fetchable (it 301/302s through
 * hops that send no usable CORS header, which the browser aborts) and must be
 * rewritten to `raw.githubusercontent.com` or proxied. rt.gtfs.zone,
 * cdn.mbta.com and content.amtrak.com send no CORS headers, so they proxy.
 *
 * Several agency feeds below are plain `http://`, which an https page blocks as
 * mixed content. They are only usable *because* they proxy: `maybeProxy`
 * produces `https://cors.gtfs.zone/http://…`, and the plain-http hop happens
 * server-side. An http entry must therefore never ship with `useCors: false`.
 *
 * Two of these hosts (ripta.com, opendata.burlington.ca) refuse a bare request
 * outright but answer the proxy, so "it 403s in curl" is not evidence that an
 * entry is dead — check it the way the app fetches it.
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
        vehiclesUrl: '/amtrak/vehicle_positions.pb',
        tripUpdatesUrl: '/amtrak/trip_updates.pb',
        alertsUrl: '/amtrak/service_alerts.pb',
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
        vehiclesUrl: '/columbia-county/vehicle_positions.pb',
        tripUpdatesUrl: '/columbia-county/trip_updates.pb',
        alertsUrl: '/columbia-county/service_alerts.pb',
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
  {
    name: 'SEPTA',
    // The one entry that exercises the nested-zip syntax: SEPTA ships
    // google_bus.zip and google_rail.zip inside a single release asset, so the
    // outer URL alone does not say which feed is meant. No alerts endpoint —
    // SEPTA publishes Vehicle and Trip only.
    description: 'Philadelphia — bus feed nested inside the public GTFS release zip',
    selection: {
      static: {
        kind: 'url',
        url: 'https://github.com/septadev/GTFS/releases/latest/download/gtfs_public.zip#google_bus.zip',
        useCors: true,
        label: 'SEPTA',
      },
      realtime: {
        vehiclesUrl: 'https://www3.septa.org/gtfsrt/septa-pa-us/Vehicle/rtVehiclePosition.pb',
        tripUpdatesUrl: 'https://www3.septa.org/gtfsrt/septa-pa-us/Trip/rtTripUpdates.pb',
        useCors: true,
        label: 'SEPTA RT',
      },
    },
  },
  {
    name: 'Grand Poitiers',
    description: 'Poitiers, France — Cadavl-hosted static and realtime',
    selection: {
      static: {
        kind: 'url',
        url: 'https://gtfs.gptd.cadavl.com/GPTD/GTFS/GTFS_GPTD.zip',
        useCors: true,
        label: 'Grand Poitiers',
      },
      realtime: {
        vehiclesUrl: 'https://gtfsrt.gptd.cadavl.com/ProfilGtfsRt2_0RSProducer-GPTD/VehiclePosition.pb',
        tripUpdatesUrl: 'https://gtfsrt.gptd.cadavl.com/ProfilGtfsRt2_0RSProducer-GPTD/TripUpdate.pb',
        alertsUrl: 'https://gtfsrt.gptd.cadavl.com/ProfilGtfsRt2_0RSProducer-GPTD/Alert.pb',
        useCors: true,
        label: 'Grand Poitiers RT',
      },
    },
  },
  {
    name: 'Divia',
    // The static half is a data.gouv.fr resource id, so the URL names no file
    // and has no .zip extension — it is one all the same.
    description: 'Dijon, France — static via data.gouv.fr, realtime via transport.data.gouv.fr',
    selection: {
      static: {
        kind: 'url',
        url: 'https://www.data.gouv.fr/fr/datasets/r/e0dbd217-15cd-4e28-9459-211a27511a34',
        useCors: true,
        label: 'Divia',
      },
      realtime: {
        vehiclesUrl: 'https://proxy.transport.data.gouv.fr/resource/divia-dijon-gtfs-rt-vehicle-position',
        tripUpdatesUrl: 'https://proxy.transport.data.gouv.fr/resource/divia-dijon-gtfs-rt-trip-update',
        useCors: true,
        label: 'Divia RT',
      },
    },
  },
  {
    name: 'RIPTA',
    // ripta.com 403s a bare request and the realtime host is http on a
    // non-standard port; both are fine through the proxy.
    description: 'Rhode Island — realtime on port 81',
    selection: {
      static: {
        kind: 'url',
        url: 'https://ripta.com/RIPTA-GTFS.zip',
        useCors: true,
        label: 'RIPTA',
      },
      realtime: {
        vehiclesUrl: 'http://realtime.ripta.com:81/api/vehiclepositions?format=gtfs.proto',
        tripUpdatesUrl: 'http://realtime.ripta.com:81/api/tripupdates?format=gtfs.proto',
        alertsUrl: 'http://realtime.ripta.com:81/api/servicealerts?format=gtfs.proto',
        useCors: true,
        label: 'RIPTA RT',
      },
    },
  },
  {
    name: 'WCTA',
    description: 'Whatcom County, WA — an Avail InfoPoint deployment',
    selection: {
      static: {
        kind: 'url',
        url: 'https://wcta.rideralerts.com/InfoPoint/gtfs-zip.ashx',
        useCors: true,
        label: 'WCTA',
      },
      realtime: {
        vehiclesUrl: 'https://wcta.rideralerts.com/InfoPoint/gtfs-realtime.ashx?type=vehicleposition',
        tripUpdatesUrl: 'https://wcta.rideralerts.com/InfoPoint/gtfs-realtime.ashx?type=tripupdate',
        alertsUrl: 'https://wcta.rideralerts.com/InfoPoint/gtfs-realtime.ashx?type=alert',
        useCors: true,
        label: 'WCTA RT',
      },
    },
  },
  {
    name: 'LCTA',
    description: 'Luzerne County, PA — another Avail InfoPoint deployment',
    selection: {
      static: {
        kind: 'url',
        url: 'https://realtimelctabus.availtec.com/InfoPoint/gtfs-zip.ashx',
        useCors: true,
        label: 'LCTA',
      },
      realtime: {
        vehiclesUrl: 'https://realtimelctabus.availtec.com/InfoPoint/GTFS-Realtime.ashx?Type=VehiclePosition',
        tripUpdatesUrl: 'https://realtimelctabus.availtec.com/InfoPoint/GTFS-Realtime.ashx?Type=TripUpdate',
        alertsUrl: 'https://realtimelctabus.availtec.com/InfoPoint/GTFS-Realtime.ashx?Type=Alert',
        useCors: true,
        label: 'LCTA RT',
      },
    },
  },
  {
    name: 'Burlington Transit',
    // opendata.burlington.ca refuses connections from some networks outright
    // but answers the proxy; do not read a curl timeout as a dead feed.
    description: 'Burlington, Ontario — city open-data portal',
    selection: {
      static: {
        kind: 'url',
        url: 'https://opendata.burlington.ca/gtfs-rt/GTFS_Data.zip',
        useCors: true,
        label: 'Burlington Transit',
      },
      realtime: {
        vehiclesUrl: 'https://opendata.burlington.ca/gtfs-rt/GTFS_VehiclePositions.pb',
        tripUpdatesUrl: 'https://opendata.burlington.ca/gtfs-rt/GTFS_TripUpdates.pb',
        alertsUrl: 'https://opendata.burlington.ca/gtfs-rt/GTFS_ServiceAlerts.pb',
        useCors: true,
        label: 'Burlington Transit RT',
      },
    },
  },
  {
    name: 'Big Blue Bus',
    description: 'Santa Monica, CA — realtime served as .bin, over plain http',
    selection: {
      static: {
        kind: 'url',
        url: 'http://gtfs.bigbluebus.com/current.zip',
        useCors: true,
        label: 'Big Blue Bus',
      },
      realtime: {
        vehiclesUrl: 'http://gtfs.bigbluebus.com/vehiclepositions.bin',
        tripUpdatesUrl: 'http://gtfs.bigbluebus.com/tripupdates.bin',
        alertsUrl: 'http://gtfs.bigbluebus.com/alerts.bin',
        useCors: true,
        label: 'Big Blue Bus RT',
      },
    },
  },
  {
    name: 'London Transit',
    description: 'London, Ontario — static and realtime on separate http hosts',
    selection: {
      static: {
        kind: 'url',
        url: 'http://www.londontransit.ca/gtfsfeed/google_transit.zip',
        useCors: true,
        label: 'London Transit',
      },
      realtime: {
        vehiclesUrl: 'http://gtfs.ltconline.ca/Vehicle/VehiclePositions.pb',
        tripUpdatesUrl: 'http://gtfs.ltconline.ca/TripUpdate/TripUpdates.pb',
        alertsUrl: 'http://gtfs.ltconline.ca/Alert/Alerts.pb',
        useCors: true,
        label: 'London Transit RT',
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
