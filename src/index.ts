import { MapController } from './map-controller';
import type { VehiclePosition } from './map-controller';
import type { GTFSStatic } from './gtfs-static';
import type { AlertRecord } from './gtfs-rt';
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
import { PanelRenderer } from './modules/panel-renderer';
import { ALERT_LEVEL_LABELS, alertLevel, isActiveNow, preferredText } from './modules/alerts';
import type { PageState } from './types/page-state';

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
// On mobile the sheet sits over the map, so the camera has to hold the focused
// feature above it rather than centring it under the sheet.
bottomSheet.onSnapChange(covered => mapCtrl.setBottomPadding(covered));

// ─── Feed session ─────────────────────────────────────────────────────────────
const session = new FeedSession();

session.addEventListener('staticloaded', e => {
  // `loadStaticFeed` replaces the previous feed's data in place — no explicit
  // clear, which would only cost an extra empty repaint.
  mapCtrl.loadStaticFeed((e as CustomEvent<GTFSStatic>).detail);
});
session.addEventListener('vehicles', e => {
  mapCtrl.showVehicles((e as CustomEvent<VehiclePosition[]>).detail);
});
// Trip updates are collected by the state store in a later plan; the panel
// has no consumer for them yet.
session.addEventListener('alerts', e => {
  renderAlertsModal((e as CustomEvent<AlertRecord[]>).detail);
});

// ─── Focus state ──────────────────────────────────────────────────────────────
const panelContent = document.getElementById('panel-content')!;
const statusPage = new StatusPage(panelContent, session);
const panelRenderer = new PanelRenderer(panelContent, session, {
  navigate: state => appState.setFocus(state),
  href: state => appState.hrefFor(state),
});
panelRenderer.initialize();

const appState = new AppState(session, {
  onFocusChange: state => {
    const atHome = state.type === 'home';
    // The status page is the panel's home content; anything else takes it over.
    // Exactly one of the two owns `#panel-content` at a time, so neither can
    // paint over the other on a poll.
    statusPage.setActive(atHome);
    if (atHome) {
      panelRenderer.hide();
      bottomSheet.close();
    } else {
      panelRenderer.show(state, appState.breadcrumbs);
      bottomSheet.open('half');
    }
    // After the sheet moves, so the camera knows how much of the map is covered.
    mapCtrl.focus(state);
  },
});

statusPage.setShareUrlProvider(() => appState.shareableUrl());
statusPage.setMapIssuesProvider(() => mapCtrl.issues);
statusPage.initialize();

// Clicking a stop, route, or vehicle on the map focuses it in the panel; the
// reverse direction runs through onFocusChange above.
mapCtrl.onSelect = state => appState.setFocus(state);

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
const alertsList = document.getElementById('alerts-list')!;

/**
 * The modal is now an index into the alert pages rather than a place where the
 * alert text is finally rendered — a row links to the page that shows every
 * translation, active period, and informed entity.
 *
 * The navbar badge counts only alerts that are active *now*. A feed routinely
 * carries alerts for next month's shutdown, and counting them as if they were
 * happening makes the badge useless; the total is stated next to it instead.
 */
function renderAlertsModal(records: AlertRecord[]): void {
  const badge = document.getElementById('alerts-badge')!;
  const active = records.filter(r => isActiveNow(r.alert));

  if (records.length === 0) {
    alertsList.innerHTML = '<p class="text-sm opacity-40 text-center py-8">No service alerts.</p>';
    badge.classList.add('hidden');
    badge.textContent = '';
    return;
  }

  // Active first — the rest are scheduled or expired and can wait.
  const ordered = [...active, ...records.filter(r => !isActiveNow(r.alert))];
  alertsList.innerHTML = `
    <p class="text-xs opacity-60">${active.length} active of ${records.length} in the feed.</p>
    ${ordered.map(renderAlertRow).join('')}`;

  badge.textContent = String(active.length);
  badge.classList.toggle('hidden', active.length === 0);
}

function renderAlertRow(record: AlertRecord): string {
  const header = preferredText(record.alert.headerText) || `Alert ${record.id}`;
  const desc = preferredText(record.alert.descriptionText);
  const state: PageState = { type: 'alert', alert_id: record.id };
  return `<a
      href="${escHtml(appState.hrefFor(state))}"
      data-alert-id="${escHtml(record.id)}"
      class="block card card-bordered bg-base-200 p-3 space-y-1 hover:bg-base-300"
    >
    <div class="flex items-center gap-2">
      ${
        isActiveNow(record.alert)
          ? '<span class="badge badge-warning badge-xs">active</span>'
          : '<span class="badge badge-ghost badge-xs">not active</span>'
      }
      <span class="text-xs opacity-50">${escHtml(ALERT_LEVEL_LABELS[alertLevel(record)])}</span>
    </div>
    <p class="font-semibold text-sm">${escHtml(header)}</p>
    ${desc ? `<p class="text-xs opacity-70 line-clamp-3">${escHtml(desc)}</p>` : ''}
  </a>`;
}

alertsList.addEventListener('click', e => {
  const row = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-alert-id]');
  if (!row) return;
  const mouse = e as MouseEvent;
  if (mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.button !== 0) return;
  e.preventDefault();
  (document.getElementById('alerts-modal') as HTMLDialogElement).close();
  appState.setFocus({ type: 'alert', alert_id: row.dataset.alertId! });
});

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
