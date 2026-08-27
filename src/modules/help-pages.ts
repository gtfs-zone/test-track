/* @vendored-from coloring-book:src/modules/help-pages.ts
   @sha 2302e2e
   @status modified
   @changes
   - Editor-only pages dropped (Getting Started/Shapes/Fares/Map Key/Keyboard
     Shortcuts); HELP_PAGES is just [welcomePage, aboutPage]
   - welcomePage copy rewritten for viz.rt.gtfs.zone (live vehicle map, not
     the GTFS editor)
   - ABOUT_APP replaced with test-track's existing AboutApp config, moved
     here from the old about-modal.ts
   - setHelpRuntimeData narrowed to { version } only; no shortcuts registry */
/**
 * The help page registry: what pages exist, their grouping, and their copy.
 *
 * Rendering lives in `help-modal.ts`. This module is data only, following
 * landing-zone's `src/content/copy.ts` convention of keeping copy separate
 * from the code that draws it.
 */

import { eyebrow, lede, glyphList } from './help-modal.js';
import {
  renderBlurb,
  renderVersionAndSource,
  renderProjectSection,
  renderResourcesSection,
  renderFeedbackSection,
  type AboutApp,
} from './about-links.js';

export type HelpGroup = 'Getting Started' | 'Reference';

export interface HelpPage {
  id: string;
  label: string;
  group: HelpGroup;
  title: string;
  render(): string;
  /**
   * localStorage key for a "don't show this again" checkbox. Pages without
   * one are reference-only: always available from the menu, never suppressed.
   */
  showOnceKey?: string;
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
  showOnceKey: 'help.welcome.seen',
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
 * Version data isn't known when this module loads (it comes from
 * `__APP_VERSION__`), so `index.ts` pushes it in once during boot.
 */
let helpRuntimeData: { version: string } = { version: '' };

export function setHelpRuntimeData(data: { version: string }): void {
  helpRuntimeData = data;
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

export const HELP_PAGES: HelpPage[] = [welcomePage, aboutPage];

export function getHelpPage(id: string): HelpPage | undefined {
  return HELP_PAGES.find((page) => page.id === id);
}
