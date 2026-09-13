/* @vendored-from coloring-book:src/modules/help-pages.ts
   @sha dca23b3
   @status modified
   @changes
   - Editor-only pages dropped (Getting Started/Shapes/Fares/On-Demand/
     Publishing); HELP_PAGES is [welcomePage, aboutPage, mapKeyPage,
     shortcutsPage]
   - welcomePage copy rewritten for viz.rt.gtfs.zone (live vehicle map, not
     the GTFS editor)
   - ABOUT_APP replaced with test-track's existing AboutApp config, moved
     here from the old about-modal.ts
   - The Keyboard Shortcuts page is back as of Phase 12, once
     `keyboard-shortcuts.ts` was parameterized over an app-supplied command
     list: `buildShortcutsTable` and the `shortcuts` half of
     `setHelpRuntimeData` are upstream's, fed from this app's own list
   - mapKeyPage rewritten for this app's own symbology (routes, vehicles,
     stops) instead of coloring-book's pathways/stops
   - mapKeyPage gained a direction-of-travel row in Phase 8, when the
     spotlighted route got its chevrons */
/**
 * The help page registry: what pages exist, their grouping, and their copy.
 *
 * Rendering lives in `help-modal.ts`. This module is data only, following
 * landing-zone's `src/content/copy.ts` convention of keeping copy separate
 * from the code that draws it.
 */

import { eyebrow, lede, glyphList } from './help-modal';
import {
  renderBlurb,
  renderVersionAndSource,
  renderProjectSection,
  renderResourcesSection,
  renderFeedbackSection,
  type AboutApp,
} from './about-links';

export type HelpGroup = 'Getting Started' | 'Reference';

export interface HelpPage {
  id: string;
  label: string;
  group: HelpGroup;
  title: string;
  render(): string;
  /**
   * Marks a page that is auto-shown once at its trigger and afterwards only
   * reachable from the Guide menu. Pages without it are reference-only.
   */
  showOnce?: boolean;
}

function icon(paths: string): string {
  return `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

const ICON_LOAD = icon(
  '<path d="M16 4v16M9 13l7 7 7-7"/><path d="M6 24v3a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3"/>'
);
const ICON_MAP = icon(
  '<path d="M16 5c-4.4 0-8 3.4-8 7.6C8 18.4 16 27 16 27s8-8.6 8-14.4C24 8.4 20.4 5 16 5z"/><circle cx="16" cy="12.5" r="2.5"/>'
);
const ICON_CHECK = icon(
  '<path d="M16 4l9 4v7c0 6.6-4 11.4-9 13-5-1.6-9-6.4-9-13v-7z"/><path d="M12 16l3 3 5-6"/>'
);
const ICON_LEG = icon(
  '<circle cx="6" cy="26" r="2"/><circle cx="24" cy="8" r="2"/><path d="M6.5 24c5.5-9 8-11 8-16 0 5 2.5 7 8 16"/>'
);

const welcomePage: HelpPage = {
  id: 'welcome',
  label: 'Welcome',
  group: 'Getting Started',
  title: 'Welcome to viz.rt.gtfs.zone',
  showOnce: true,
  render: () =>
    [
      eyebrow('GTFS.zone'),
      lede(
        'viz.rt.gtfs.zone shows a GTFS Realtime feed on a live map. Every feed is fetched and decoded in your browser. Nothing you load is uploaded anywhere.'
      ),
      glyphList([
        {
          icon: ICON_LOAD,
          term: 'Load a feed',
          description:
            'Point it at a scheduled GTFS feed plus its realtime feeds.',
        },
        {
          icon: ICON_MAP,
          term: 'Watch vehicles move',
          description: 'Positions update every few seconds on the map.',
        },
        {
          icon: ICON_LEG,
          term: 'Check predictions',
          description: 'Arrival predictions and how late each trip is running.',
        },
        {
          icon: ICON_CHECK,
          term: 'Spot disruptions',
          description: 'Active service alerts show up alongside the routes.',
        },
      ]),
    ].join(''),
};

// ─── Reference: About, merged in from the old standalone About modal ──────

const ABOUT_APP: AboutApp = {
  name: 'viz.rt.gtfs.zone',
  blurb: [
    'viz.rt.gtfs.zone shows a GTFS Realtime feed on a live map.',
    'GTFS Realtime is what an agency publishes alongside its schedule to say where its vehicles are right now, how late each trip is running, and what is disrupted. Point this at a scheduled GTFS feed plus its realtime feeds and the map draws the rest:',
  ],
  highlights: [
    'Routes and stops from the schedule',
    'Vehicles moving along them, updated every few seconds',
    'Arrival predictions at any stop',
    'Active service alerts',
  ],
  blurbFooter:
    'Every feed is fetched and decoded in your browser. Nothing you load is uploaded anywhere.',
  contactSubject: 'viz.rt.gtfs.zone feedback',
  repo: 'test-track',
  sibling: {
    name: 'edit.gtfs.zone',
    href: 'https://edit.gtfs.zone',
    note: 'build and edit a GTFS schedule feed in the browser',
  },
};

/**
 * Version and keyboard-shortcuts data aren't known when this module loads
 * (they come from `__APP_VERSION__` and the app's own command list), so
 * `index.ts` pushes them in once during boot.
 */
let helpRuntimeData: {
  version: string;
  shortcuts: Array<{ key: string; description: string }>;
} = { version: '', shortcuts: [] };

export function setHelpRuntimeData(data: {
  version: string;
  shortcuts: Array<{ key: string; description: string }>;
}): void {
  helpRuntimeData = data;
}

function buildShortcutsTable(
  shortcuts: Array<{ key: string; description: string }>
): string {
  const rows = shortcuts
    .map((s) => {
      const keyHtml = s.key
        .split('+')
        .map((token) => `<kbd class="kbd kbd-xs">${token}</kbd>`)
        .join('+');
      return `<tr><td class="whitespace-nowrap">${keyHtml}</td><td>${s.description}</td></tr>`;
    })
    .join('');
  return `
    <table class="table table-xs w-full">
      <thead><tr><th>Key</th><th>Action</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

const aboutPage: HelpPage = {
  id: 'about',
  label: 'About',
  group: 'Reference',
  title: 'About viz.rt.gtfs.zone',
  render: () =>
    [
      renderBlurb(ABOUT_APP),
      renderVersionAndSource(ABOUT_APP, helpRuntimeData.version),
      renderProjectSection(ABOUT_APP),
      renderResourcesSection(),
      renderFeedbackSection(ABOUT_APP),
    ].join('\n'),
};

// ─── Reference: Map Key ────────────────────────────────────────────────────

function circle(fill: string, stroke: string, dot?: boolean): string {
  const inner = dot ? `<circle cx="7" cy="7" r="2.5" fill="#000000"/>` : '';
  return `<svg width="14" height="14" viewBox="0 0 14 14" style="flex-shrink:0"><circle cx="7" cy="7" r="5" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>${inner}</svg>`;
}

function swatchLine(color: string): string {
  return `<svg width="20" height="14" viewBox="0 0 20 14" style="flex-shrink:0"><line x1="2" y1="7" x2="18" y2="7" stroke="${color}" stroke-width="3" stroke-linecap="round"/></svg>`;
}

function triangle(color: string): string {
  return `<svg width="14" height="14" viewBox="0 0 14 14" style="flex-shrink:0"><polygon points="7,1 12,12 2,12" fill="${color}" stroke="#0f172a" stroke-width="1"/></svg>`;
}

/** The direction chevrons drawn along the selected route. */
function chevronLine(color: string): string {
  const chevron = (x: number) =>
    `<polyline points="${x},4 ${x + 3},7 ${x},10" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
  return `<svg width="20" height="14" viewBox="0 0 20 14" style="flex-shrink:0"><line x1="2" y1="7" x2="18" y2="7" stroke="${color}" stroke-width="4" stroke-linecap="round"/>${chevron(5)}${chevron(11)}</svg>`;
}

const mapKeyPage: HelpPage = {
  id: 'map-key',
  label: 'Map Key',
  group: 'Reference',
  title: 'Map Key',
  render: () => {
    const row = (swatch: string, label: string) =>
      `<div class="flex items-center gap-2">${swatch}<span>${label}</span></div>`;

    const stops = [
      row(circle('#ffffff', '#000000'), 'Stop'),
      row(circle('#ffffff', '#000000', true), 'Station'),
      row(circle('#f59e0b', '#000000'), 'Entrance'),
      row(circle('#8b5cf6', '#000000'), 'Generic node'),
      row(circle('#10b981', '#000000'), 'Boarding area'),
      row(circle('#ffffff', '#9ca3af'), "Inherits its station's location"),
    ].join('');

    const routesAndVehicles = [
      row(swatchLine('#3b82f6'), "Route (the feed's color, or an assigned one)"),
      row(chevronLine('#3b82f6'), 'Direction of travel, on the selected route'),
      row(circle('#3b82f6', '#0f172a'), 'Vehicle'),
      row(triangle('#3b82f6'), 'Vehicle, with a known heading'),
      row(circle('#94a3b8', '#0f172a'), "Vehicle, route couldn't be matched"),
    ].join('');

    return `
      <div class="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <div class="col-span-2 grid grid-cols-2 gap-x-6">
          <div class="font-semibold text-xs opacity-60 mb-1">Stops</div>
          <div class="font-semibold text-xs opacity-60 mb-1">Routes &amp; Vehicles</div>
        </div>
        <div class="flex flex-col gap-1">${stops}</div>
        <div class="flex flex-col gap-1">${routesAndVehicles}</div>
      </div>
    `;
  },
};

// ─── Reference: Keyboard Shortcuts ─────────────────────────────────────────

const shortcutsPage: HelpPage = {
  id: 'shortcuts',
  label: 'Keyboard Shortcuts',
  group: 'Reference',
  title: 'Using keyboard shortcuts',
  render: () => buildShortcutsTable(helpRuntimeData.shortcuts),
};

export const HELP_PAGES: HelpPage[] = [
  welcomePage,
  aboutPage,
  mapKeyPage,
  shortcutsPage,
];

export function getHelpPage(id: string): HelpPage | undefined {
  return HELP_PAGES.find((page) => page.id === id);
}
