import { MapController } from './map-controller';
import type { VehiclePosition } from './map-controller';
import type { GTFSStatic } from './gtfs-static';
import type { AlertRecord, ServiceAlert } from './gtfs-rt';
import { showAboutModal } from './modules/about-modal';
import { showAtlasSearchModal } from './modules/atlas-search';
import { showExamplesModal } from './modules/examples';
import { showManualLoadModal } from './modules/manual-load-modal';
import { notify } from './modules/notification-system';
import { PanelResizer, restorePanelWidth } from './modules/panel-resizer';
import { BottomSheetController } from './modules/bottom-sheet';
import { ThemeController } from './modules/theme-controller';
import type { FeedSelection } from './modules/feed-selection';
import { describeSelection } from './modules/feed-selection';
import { FeedSession } from './modules/feed-session';
import { StatusPage } from './modules/status-page';
import { AppState } from './modules/app-state';
import { renderPlaceholderPage } from './modules/panel-placeholder';

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

// ─── Feed session ─────────────────────────────────────────────────────────────
const session = new FeedSession();

session.addEventListener('staticloaded', e => {
  mapCtrl.clearStaticFeed();
  mapCtrl.loadStaticFeed((e as CustomEvent<GTFSStatic>).detail);
});
session.addEventListener('vehicles', e => {
  mapCtrl.showVehicles((e as CustomEvent<VehiclePosition[]>).detail);
});
// Trip updates are collected by the state store in a later plan; the panel
// has no consumer for them yet.
session.addEventListener('alerts', e => {
  renderAlertsModal((e as CustomEvent<AlertRecord[]>).detail.map(r => r.alert));
});

// ─── Focus state ──────────────────────────────────────────────────────────────
const panelContent = document.getElementById('panel-content')!;
const statusPage = new StatusPage(panelContent, session);

const appState = new AppState(session, {
  onFocusChange: state => {
    const atHome = state.type === 'home';
    // The status page is the panel's home content; anything else takes it over.
    statusPage.setActive(atHome);
    if (!atHome) {
      panelContent.innerHTML = renderPlaceholderPage(session, state, appState.breadcrumbs);
      bottomSheet.open('half');
    } else {
      bottomSheet.close();
    }
  },
});

statusPage.setShareUrlProvider(() => appState.shareableUrl());
statusPage.initialize();

// Plan 04 owns the rest of the map's click surfaces; this is the one handler
// that already existed, wired to the new focus path.
mapCtrl.onStopClick(stopId => appState.setFocus({ type: 'stop', stop_id: stopId }));

void appState.boot().then(loaded => {
  if (loaded) document.getElementById('refresh-rt-btn')!.classList.remove('hidden');
});

// ─── About button ─────────────────────────────────────────────────────────────
document.getElementById('app-version')!.textContent = __APP_VERSION__;
document.getElementById('about-btn')!
  .addEventListener('click', () => showAboutModal(__APP_VERSION__));


// ─── Load dropdown ────────────────────────────────────────────────────────────
async function handleLoadResult(selection: FeedSelection | null): Promise<void> {
  if (!selection) return;
  // Close dropdown by blurring the tabindex element
  (document.activeElement as HTMLElement | null)?.blur();
  const label = describeSelection(selection);
  try {
    await session.load(selection);
    document.getElementById('refresh-rt-btn')!.classList.remove('hidden');
    notify.success(`Loaded ${label}`);
  } catch (err) {
    console.error('Load failed:', err);
    notify.error(`Failed to load ${label}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

document.getElementById('load-examples-btn')!.addEventListener('click', async () => {
  await handleLoadResult(await showExamplesModal());
});

document.getElementById('load-atlas-btn')!.addEventListener('click', async () => {
  await handleLoadResult(await showAtlasSearchModal());
});

document.getElementById('load-manual-btn')!.addEventListener('click', async () => {
  await handleLoadResult(await showManualLoadModal());
});

// ─── Refresh RT button ────────────────────────────────────────────────────────
document.getElementById('refresh-rt-btn')!.addEventListener('click', async () => {
  (document.activeElement as HTMLElement | null)?.blur();
  await session.refreshAll();
});

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
