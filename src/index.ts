import { GTFSStatic } from './gtfs-static';
import { MapController } from './map-controller';
import type { VehiclePosition } from './map-controller';
import { GTFSRealtime } from './gtfs-rt';
import type { TripUpdate, ServiceAlert } from './gtfs-rt';

const mapCtrl = new MapController();
mapCtrl.initialize('map');

let staticFeed: GTFSStatic | null = null;
let latestTripUpdates: TripUpdate[] = [];
let latestAlerts: ServiceAlert[] = [];
let rtPoller: GTFSRealtime | null = null;

// ─── Theme toggle ─────────────────────────────────────────────────────────────
const themeInput = document.querySelector<HTMLInputElement>('.theme-controller')!;
if (localStorage.getItem('theme') === 'light') themeInput.checked = true;
themeInput.addEventListener('change', () =>
  localStorage.setItem('theme', themeInput.checked ? 'light' : 'dark')
);

// ─── File upload ──────────────────────────────────────────────────────────────
const fileInput = document.getElementById('static-gtfs-file') as HTMLInputElement;
document.getElementById('static-gtfs-upload-btn')!
  .addEventListener('click', () => fileInput.click());

// ─── Load button ──────────────────────────────────────────────────────────────
const loadBtn = document.getElementById('load-btn') as HTMLButtonElement;
loadBtn.addEventListener('click', async () => {
  loadBtn.classList.add('loading');
  loadBtn.disabled = true;
  try {
    await loadFeeds();
    (document.getElementById('feed-config') as HTMLDetailsElement).open = false;
  } catch (err) {
    console.error('Load failed:', err);
    alert(`Failed to load feeds: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    loadBtn.classList.remove('loading');
    loadBtn.disabled = false;
  }
});

function maybeProxy(url: string): string {
  const useCors = (document.getElementById('cors-proxy-checkbox') as HTMLInputElement).checked;
  if (!useCors || !url || url.startsWith('https://cors.gtfs.zone/')) return url;
  return 'https://cors.gtfs.zone/' + url;
}

async function loadFeeds(): Promise<void> {
  const staticUrl = (document.getElementById('static-gtfs-url') as HTMLInputElement).value.trim();
  const file = fileInput.files?.[0];

  if (file || staticUrl) {
    const feed = new GTFSStatic();
    if (file) {
      await feed.loadFromFile(file);
    } else {
      await feed.loadFromUrl(maybeProxy(staticUrl));
    }
    staticFeed = feed;
    mapCtrl.clearStaticFeed();
    mapCtrl.loadStaticFeed(feed);
  }

  const vehiclesUrl = maybeProxy((document.getElementById('rt-vehicles-url') as HTMLInputElement).value.trim());
  const tripUpdatesUrl = maybeProxy((document.getElementById('rt-trip-updates-url') as HTMLInputElement).value.trim());
  const alertsUrl = maybeProxy((document.getElementById('rt-alerts-url') as HTMLInputElement).value.trim());

  if (vehiclesUrl || tripUpdatesUrl || alertsUrl) {
    rtPoller?.stop();
    rtPoller = new GTFSRealtime(vehiclesUrl, tripUpdatesUrl, alertsUrl);
    rtPoller.addEventListener('vehicles', e => {
      mapCtrl.showVehicles((e as CustomEvent<VehiclePosition[]>).detail);
    });
    rtPoller.addEventListener('tripUpdates', e => {
      latestTripUpdates = (e as CustomEvent<TripUpdate[]>).detail;
    });
    rtPoller.addEventListener('alerts', e => {
      latestAlerts = (e as CustomEvent<ServiceAlert[]>).detail;
      renderAlertsModal(latestAlerts);
    });
    rtPoller.start();
  }
}

// ─── Stop sheet ───────────────────────────────────────────────────────────────
mapCtrl.onStopClick(stopId => {
  const stop = staticFeed?.stops.get(stopId);
  const sheet = document.getElementById('stop-sheet')!;

  document.getElementById('stop-sheet-name')!.textContent = stop?.name ?? stopId;
  document.getElementById('stop-sheet-id')!.textContent = stopId;

  const tripIds = new Set(staticFeed?.stopTrips.get(stopId) ?? []);
  const matchingUpdates = latestTripUpdates.filter(tu => tripIds.has(tu.trip?.tripId ?? ''));
  const tripsEl = document.getElementById('stop-sheet-trips')!;
  tripsEl.innerHTML = matchingUpdates.length > 0
    ? matchingUpdates.map(tu => renderTripRow(tu, stopId)).join('')
    : '<p class="text-xs opacity-40">No upcoming trip data.</p>';

  const stopAlerts = latestAlerts.filter(a =>
    a.informedEntity?.some(e => !e.stopId || e.stopId === stopId)
  );
  const alertsSection = document.getElementById('stop-sheet-alerts-section')!;
  if (stopAlerts.length > 0) {
    document.getElementById('stop-sheet-alerts')!.innerHTML = stopAlerts.map(renderAlertCard).join('');
    alertsSection.classList.remove('hidden');
  } else {
    alertsSection.classList.add('hidden');
  }

  sheet.classList.remove('translate-y-full');
});

function renderTripRow(tu: TripUpdate, stopId: string): string {
  const tripId = tu.trip?.tripId ?? '';
  const trip = staticFeed?.trips.get(tripId);
  const route = trip ? staticFeed?.routes.get(trip.route_id) : null;
  const headsign = trip?.headsign ?? '';

  const stu = tu.stopTimeUpdate?.find(u => u.stopId === stopId);
  const rawDelay = stu?.departure?.delay ?? stu?.arrival?.delay ?? null;
  const delaySecs = rawDelay != null ? Number(rawDelay) : null;

  const color = route?.color ?? '#0066ff';
  const textColor = route?.text_color ?? '#ffffff';
  const name = route?.short_name ?? tripId;

  const delayClass = delaySecs != null && delaySecs > 60 ? 'text-error'
    : delaySecs != null && delaySecs < -30 ? 'text-success' : '';
  const delayLabel = delaySecs != null ? formatDelay(delaySecs) : '';

  return `<div class="flex items-center gap-2 text-xs py-1">
    <span class="badge badge-sm font-mono shrink-0" style="background:${escHtml(color)};color:${escHtml(textColor)}">${escHtml(name)}</span>
    <span class="flex-1 truncate opacity-80">${escHtml(headsign)}</span>
    ${delayLabel ? `<span class="font-mono shrink-0 ${delayClass}">${escHtml(delayLabel)}</span>` : ''}
  </div>`;
}

function formatDelay(secs: number): string {
  if (Math.abs(secs) < 30) return 'On time';
  const mins = Math.round(secs / 60);
  return mins > 0 ? `+${mins}m` : `${mins}m`;
}

// ─── Alerts modal ─────────────────────────────────────────────────────────────
function renderAlertsModal(alerts: ServiceAlert[]): void {
  const listEl = document.getElementById('alerts-list')!;
  const badge = document.getElementById('alerts-badge')!;
  if (alerts.length === 0) {
    listEl.innerHTML = '<p class="text-sm opacity-40 text-center py-8">No service alerts.</p>';
    badge.classList.add('hidden');
    badge.textContent = '';
  } else {
    listEl.innerHTML = alerts.map(renderAlertCard).join('');
    badge.textContent = String(alerts.length);
    badge.classList.remove('hidden');
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const CAUSE_LABELS: Record<number, string> = {
  2: 'Other', 3: 'Technical Problem', 4: 'Strike', 5: 'Demonstration',
  6: 'Accident', 7: 'Holiday', 8: 'Weather', 9: 'Maintenance',
  10: 'Construction', 11: 'Police Activity', 12: 'Medical Emergency',
};
const EFFECT_LABELS: Record<number, string> = {
  1: 'No Service', 2: 'Reduced Service', 3: 'Significant Delays', 4: 'Detour',
  5: 'Additional Service', 6: 'Modified Service', 7: 'Other Effect',
  9: 'Stop Moved', 10: 'No Effect', 11: 'Accessibility Issue',
};

type TranslatedString = NonNullable<ServiceAlert['headerText']>;

function getTranslatedText(ts: TranslatedString | null | undefined): string {
  if (!ts?.translation?.length) return '';
  const en = ts.translation.find(t => t.language === 'en');
  return String((en ?? ts.translation[0]).text ?? '');
}

function renderAlertCard(alert: ServiceAlert): string {
  const header = getTranslatedText(alert.headerText);
  const desc = getTranslatedText(alert.descriptionText);
  const cause = CAUSE_LABELS[alert.cause as number] ?? '';
  const effect = EFFECT_LABELS[alert.effect as number] ?? '';
  return `<div class="card card-bordered bg-base-200 p-3 space-y-1">
    ${header ? `<p class="font-semibold text-sm">${escHtml(header)}</p>` : ''}
    ${desc ? `<p class="text-xs opacity-70">${escHtml(desc)}</p>` : ''}
    <div class="flex flex-wrap gap-1 pt-1">
      ${cause ? `<span class="badge badge-ghost badge-xs">${escHtml(cause)}</span>` : ''}
      ${effect ? `<span class="badge badge-warning badge-xs">${escHtml(effect)}</span>` : ''}
    </div>
  </div>`;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
