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
  blurb:
    'viz.rt.gtfs.zone is a browser-based GTFS Realtime visualizer. GTFS Realtime is the feed an agency publishes alongside its schedule to say where its vehicles are right now, how late each trip is running, and what is disrupted. Point this at a static GTFS feed plus its realtime feeds and the map draws the routes and stops, the vehicles moving along them, the arrival predictions for any stop, and the active service alerts. Every feed is fetched and decoded in your browser, so nothing you load is uploaded anywhere.',
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
