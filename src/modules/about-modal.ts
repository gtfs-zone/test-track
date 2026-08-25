import { showModal } from './modal-utils';
import {
  AboutApp,
  renderBlurb,
  renderFeedbackSection,
  renderProjectSection,
  renderResourcesSection,
  renderVersionAndSource,
} from './about-links';

const APP: AboutApp = {
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

export function showAboutModal(version: string): Promise<void> {
  const body = [
    renderBlurb(APP),
    renderVersionAndSource(APP, version),
    renderProjectSection(APP),
    renderResourcesSection(),
    renderFeedbackSection(APP),
  ].join('\n');

  return showModal({
    title: APP.name,
    body,
    actions: [{ label: 'Close', onClick: () => {} }],
    enterAction: 0,
    escapeAction: 0,
  });
}
