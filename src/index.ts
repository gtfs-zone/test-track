import { CONFIG } from './config';
import { MapController } from './map-controller';
import type { VehiclePosition } from './map-controller';
import type { GTFSScheduled } from './gtfs-scheduled';
import type { AlertRecord } from './gtfs-rt';
import { showHelpModal, shouldShowHelpPage } from './modules/help-modal';
import { setHelpRuntimeData } from './modules/help-pages';
import { showLoadModal } from './modules/load-modal';
import { notify } from './modules/notification-system';
import { LoadCancelledError } from './modules/feed-download';
import { PanelResizer, restorePanelWidth } from './modules/panel-resizer';
import { BottomSheetController } from './modules/bottom-sheet';
import { ThemeController } from './modules/theme-controller';
import type { FeedSelection } from './modules/feed-selection';
import { describeSelection } from './modules/feed-selection';
import { FeedSession } from './modules/feed-session';
import { clearLastFeed, readLastFeed, writeLastFeed } from './modules/last-feed';
import { StatusPage } from './modules/status-page';
import { AppState } from './modules/app-state';
import { PanelRenderer } from './modules/panel-renderer';
import { pageTitle } from './modules/breadcrumb-trail';
import { alertLabel } from './modules/breadcrumbs';
import { SearchController } from './modules/search-controller';
import { buildSearchEntries } from './modules/search-entries';
import { ALERT_LEVEL_LABELS, alertLevel, isActiveNow, preferredText } from './modules/alerts';
import type { PageState } from './types/page-state';

// ─── Shell ────────────────────────────────────────────────────────────────────
const appContainer = document.querySelector<HTMLElement>('.app-container')!;
restorePanelWidth(appContainer);

notify.initialize();
const themeController = new ThemeController();
themeController.initialize();

const mapCtrl = new MapController();
mapCtrl.initialize('map');
// The map accent comes from the theme palette, so it has to be repainted
// whenever the theme switches.
themeController.onThemeChange(() => mapCtrl.refreshAccentColor());

new PanelResizer(appContainer, mapCtrl);

const rightPanel = document.getElementById('right-panel')!;
const bottomSheet = new BottomSheetController(rightPanel);
// On mobile the sheet sits over the map, so the camera has to hold the focused
// feature above it rather than centring it under the sheet.
bottomSheet.onSnapChange(covered => mapCtrl.setBottomPadding(covered));

// ─── Feed session ─────────────────────────────────────────────────────────────
const session = new FeedSession();

session.addEventListener('scheduleloaded', e => {
  const scheduled = (e as CustomEvent<GTFSScheduled>).detail;
  // `loadScheduledFeed` replaces the previous feed's data in place — no explicit
  // clear, which would only cost an extra empty repaint.
  mapCtrl.loadScheduledFeed(scheduled);
  // The one place that knows both a load succeeded and what it parsed, so the
  // selection and its counts are remembered in a single write.
  if (session.selection) {
    const counts = scheduled.counts();
    writeLastFeed(session.selection, {
      label: describeSelection(session.selection),
      routes: counts.routes,
      stops: counts.stops,
      trips: counts.trips,
    });
  }
  // Blank the vehicles layer for the new feed: `startPoller` resets the
  // session's vehicle map, but if the first poll on the new feed fails the old
  // feed's markers would otherwise linger on the map.
  mapCtrl.clearVehicles();
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
  hoverStop: stopId => mapCtrl.hoverStop(stopId),
});
panelRenderer.initialize();

/** The tab title, set on navigation only — the panel re-renders every poll. */
const DEFAULT_TITLE = document.title;
function setDocumentTitle(state: PageState): void {
  // The breadcrumb trail truncates its labels to keep crumbs compact, but an
  // alert's full header text is more useful in a tab title than a crumb, so
  // the title is built from the untruncated label instead of the trail.
  if (state.type === 'alert') {
    document.title = `Service alert ${alertLabel(session, state.alert_id)} | viz.rt.gtfs.zone`;
    return;
  }
  document.title =
    state.type === 'home' ? DEFAULT_TITLE : pageTitle(appState.breadcrumbs, 'viz.rt.gtfs.zone');
}

const appState = new AppState(session, {
  onFocusChange: state => {
    setDocumentTitle(state);
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

// ─── Map search ───────────────────────────────────────────────────────────────
// Selecting a result is the same event as clicking the object on the map.
new SearchController<PageState>({
  getEntries: () => buildSearchEntries(session),
  onSelect: state => appState.setFocus(state),
}).initialize();

statusPage.setShareUrlProvider(() => appState.shareableUrl());
statusPage.setMapIssuesProvider(() => mapCtrl.issues);
statusPage.setFeedGapsProvider(() => panelRenderer.rtIndex.gaps);
statusPage.setScheduleRelationshipsProvider(() => panelRenderer.rtIndex.relationships);
statusPage.initialize();

// Clicking a stop, route, or vehicle on the map focuses it in the panel; the
// reverse direction runs through onFocusChange above.
mapCtrl.onSelect = state => appState.setFocus(state);
// A click that hits no feature returns to home, clearing the spotlight, hiding
// the panel, and closing the bottom sheet — all wired through onFocusChange.
mapCtrl.onEmptySelect = () => appState.clearFocus();

// The reload button and the refresh-rate picker only mean anything once there
// is a feed to act on.
const reloadBtn = document.getElementById('reload-feed-btn') as HTMLButtonElement;
const intervalDropdown = document.getElementById('rt-interval-dropdown')!;
const editBtn = document.getElementById('edit-feed-btn') as HTMLAnchorElement;
function showFeedControls(): void {
  reloadBtn.classList.remove('hidden');
  intervalDropdown.classList.remove('hidden');
  // The editor link only works from a URL-backed scheduled feed — file uploads
  // have no URL to hand off — so it stays hidden otherwise. A
  // `…/outer.zip#inner.zip` URL is handed over whole and will fail there:
  // coloring-book does not understand the fragment. Left deliberately, because
  // an editor link that visibly fails is clearer than one that silently opens
  // the wrong dataset.
  const scheduledSrc = session.selection?.scheduled;
  if (scheduledSrc?.kind === 'url' && scheduledSrc.url) {
    editBtn.href = `${CONFIG.EDITOR_BASE}/#load=${encodeURIComponent(scheduledSrc.url)}`;
    editBtn.classList.remove('hidden');
  } else {
    editBtn.classList.add('hidden');
  }
}

/**
 * An empty hash opens the load modal rather than an empty status page, led by
 * the last feed this browser loaded. Dismissing it is allowed: the empty status
 * page is still the fallback.
 */
async function boot(): Promise<void> {
  if (await appState.boot()) {
    console.log('[boot] hash selection loaded');
    showFeedControls();
    return;
  }

  // A stored feed that no longer loads must not trap boot in a reopen loop, so
  // the record is forgotten and the modal is offered exactly once more.
  let retried = false;
  for (;;) {
    const last = readLastFeed();
    console.log(
      last ? '[boot] modal opened, stored feed available' : '[boot] modal opened, nothing stored',
    );
    const result = await showLoadModal(appState.bootSeed, {
      continueWith: last
        ? {
            name: last.summary.label,
            routes: last.summary.routes,
            stops: last.summary.stops,
            trips: last.summary.trips,
          }
        : undefined,
    });

    if (!result) {
      console.log('[boot] modal dismissed');
      return;
    }
    if (result.kind === 'selection') {
      await handleLoadResult(result.selection);
      return;
    }
    // `continue` is only reachable when the card was rendered, so `last` is set.
    if (!last || (await handleLoadResult(last.selection)) || retried) return;
    clearLastFeed();
    retried = true;
  }
}

async function start(): Promise<void> {
  if (shouldShowHelpPage('welcome')) {
    await showHelpModal('welcome');
  }
  await boot();
}
void start();

// ─── Help button ──────────────────────────────────────────────────────────────
document.getElementById('app-version')!.textContent = __APP_VERSION__;
setHelpRuntimeData({ version: __APP_VERSION__ });
document.getElementById('help-btn')!
  .addEventListener('click', () => void showHelpModal());


// ─── Load ─────────────────────────────────────────────────────────────────────
/** True when the feed is now loaded; false for a cancelled or failed load. */
async function handleLoadResult(selection: FeedSelection | null): Promise<boolean> {
  if (!selection) return false;
  const label = describeSelection(selection);
  try {
    await session.load(selection);
    showFeedControls();
    notify.success(`Loaded ${label}`);
    return true;
  } catch (err) {
    if (err instanceof LoadCancelledError) {
      notify.info('Load cancelled');
      return false;
    }
    console.error('Load failed:', err);
    notify.error(`Failed to load ${label}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

// Seeded from the current selection, which is what makes reopening the modal
// the way to edit a loaded feed — the right panel has no editors of its own.
document.getElementById('load-btn')!.addEventListener('click', async () => {
  // The modal can also return `{ kind: 'continue' }`, but only when it is given
  // a `continueWith` card, which this call site does not.
  const result = await showLoadModal(session.selection);
  await handleLoadResult(result?.kind === 'selection' ? result.selection : null);
});

// ─── Reload feed button ───────────────────────────────────────────────────────
// A full reload — the schedule is re-downloaded and the poller replaced —
// so it is disabled while one is in flight rather than stacking two loads.
reloadBtn.addEventListener('click', async () => {
  (document.activeElement as HTMLElement | null)?.blur();
  if (!session.selection) return;
  const label = describeSelection(session.selection);
  reloadBtn.disabled = true;
  try {
    await session.reload();
    notify.success(`Reloaded ${label}`);
  } catch (err) {
    if (err instanceof LoadCancelledError) {
      notify.info('Load cancelled');
      return;
    }
    console.error('Reload failed:', err);
    notify.error(`Failed to reload ${label}: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    reloadBtn.disabled = false;
  }
});

// ─── Realtime refresh rate ────────────────────────────────────────────────────
const intervalMenu = document.getElementById('rt-interval-menu')!;
const intervalLabel = document.getElementById('rt-interval-label')!;

function renderIntervalMenu(): void {
  const current = session.pollIntervalMs;
  intervalLabel.textContent = `${current / 1000}s`;
  intervalMenu.innerHTML = CONFIG.RT_INTERVAL_OPTIONS_MS.map(
    ms => `<li><a data-rt-interval="${ms}" class="${ms === current ? 'menu-active' : ''}">${ms / 1000}s</a></li>`,
  ).join('');
}

intervalMenu.addEventListener('click', e => {
  const item = (e.target as HTMLElement).closest<HTMLElement>('[data-rt-interval]');
  if (!item) return;
  (document.activeElement as HTMLElement | null)?.blur();
  session.setPollIntervalMs(Number(item.dataset.rtInterval));
  renderIntervalMenu();
});

renderIntervalMenu();

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
