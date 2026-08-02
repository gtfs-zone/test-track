import { GTFSStatic } from './gtfs-static';
import { MapController } from './map-controller';
import type { VehiclePosition } from './map-controller';
import { GTFSRealtime } from './gtfs-rt';
import type { ServiceAlert } from './gtfs-rt';
import { showAboutModal } from './modules/about-modal';
import type { FeedConfig } from './modules/atlas-search';
import { showAtlasSearchModal } from './modules/atlas-search';
import { showExamplesModal } from './modules/examples';
import { showManualLoadModal } from './modules/manual-load-modal';
import { notify } from './modules/notification-system';
import { feedProgressIndicator } from './modules/feed-progress-indicator';
import { PanelResizer, restorePanelWidth } from './modules/panel-resizer';
import { BottomSheetController } from './modules/bottom-sheet';
import { ThemeController } from './modules/theme-controller';

// ─── Shell ────────────────────────────────────────────────────────────────────
const appContainer = document.querySelector<HTMLElement>('.app-container')!;
restorePanelWidth(appContainer);

notify.initialize();
new ThemeController().initialize();

const mapCtrl = new MapController();
mapCtrl.initialize('map');

new PanelResizer(appContainer, mapCtrl);

const rightPanel = document.getElementById('right-panel')!;
const bottomSheet = new BottomSheetController(rightPanel);
void bottomSheet;

let latestAlerts: ServiceAlert[] = [];
let rtPoller: GTFSRealtime | null = null;
let lastConfig: FeedConfig | null = null;

// ─── About button ─────────────────────────────────────────────────────────────
document.getElementById('app-version')!.textContent = __APP_VERSION__;
document.getElementById('about-btn')!
  .addEventListener('click', () => showAboutModal(__APP_VERSION__));


// ─── Load dropdown ────────────────────────────────────────────────────────────
async function handleLoadResult(config: FeedConfig | null, label: string): Promise<void> {
  if (!config) return;
  // Close dropdown by blurring the tabindex element
  (document.activeElement as HTMLElement | null)?.blur();
  feedProgressIndicator.startLoading('feed-load', `Loading ${label}…`);
  try {
    await loadFeeds(config);
    document.getElementById('refresh-rt-btn')!.classList.remove('hidden');
    notify.success(`Loaded ${label}`);
  } catch (err) {
    console.error('Load failed:', err);
    notify.error(`Failed to load feeds: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    feedProgressIndicator.finishLoading('feed-load');
  }
}

document.getElementById('load-examples-btn')!.addEventListener('click', async () => {
  const config = await showExamplesModal();
  await handleLoadResult(config, config ? 'Example feed' : '');
});

document.getElementById('load-atlas-btn')!.addEventListener('click', async () => {
  const config = await showAtlasSearchModal();
  await handleLoadResult(config, 'Atlas feed');
});

document.getElementById('load-manual-btn')!.addEventListener('click', async () => {
  const config = await showManualLoadModal();
  await handleLoadResult(config, 'Custom feed');
});

// ─── Refresh RT button ────────────────────────────────────────────────────────
document.getElementById('refresh-rt-btn')!.addEventListener('click', async () => {
  if (!lastConfig) return;
  try {
    await startRtPoller(lastConfig);
  } catch (err) {
    console.error('RT refresh failed:', err);
    notify.error(`Failed to refresh RT feeds: ${err instanceof Error ? err.message : String(err)}`);
  }
});

function maybeProxy(url: string, useCors: boolean): string {
  if (!useCors || !url || url.startsWith('https://cors.gtfs.zone/')) return url;
  return 'https://cors.gtfs.zone/' + url;
}

function startRtPoller(config: FeedConfig): void {
  const vehiclesUrl = maybeProxy(config.vehiclesUrl ?? '', config.useCors);
  const tripUpdatesUrl = maybeProxy(config.tripUpdatesUrl ?? '', config.useCors);
  const alertsUrl = maybeProxy(config.alertsUrl ?? '', config.useCors);

  if (!vehiclesUrl && !tripUpdatesUrl && !alertsUrl) return;

  rtPoller?.stop();
  rtPoller = new GTFSRealtime(vehiclesUrl, tripUpdatesUrl, alertsUrl);
  rtPoller.addEventListener('vehicles', e => {
    mapCtrl.showVehicles((e as CustomEvent<VehiclePosition[]>).detail);
  });
  // Trip updates are collected by the state store in a later plan; the panel
  // has no consumer for them yet.
  rtPoller.addEventListener('alerts', e => {
    latestAlerts = (e as CustomEvent<ServiceAlert[]>).detail;
    renderAlertsModal(latestAlerts);
  });
  rtPoller.start();
}

async function loadFeeds(config: FeedConfig): Promise<void> {
  lastConfig = config;

  if (config.staticFile || config.staticUrl) {
    const feed = new GTFSStatic();
    if (config.staticFile) {
      await feed.loadFromFile(config.staticFile);
    } else {
      await feed.loadFromUrl(maybeProxy(config.staticUrl!, config.useCors));
    }
    mapCtrl.clearStaticFeed();
    mapCtrl.loadStaticFeed(feed);
  }

  startRtPoller(config);
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
