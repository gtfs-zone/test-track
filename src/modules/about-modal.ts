import { showModal } from './modal-utils';

export function showAboutModal(version: string): Promise<void> {
  const body = `
    <p>viz.rt.gtfs.zone is a browser-based GTFS Realtime visualizer. Load any GTFS static feed and realtime feeds to see live vehicle positions, trip updates, and service alerts on a map.</p>

    <div class="divider text-sm font-semibold opacity-60">Version &amp; Source</div>
    <ul class="list-none space-y-1 text-sm">
      <li>Version: <code class="font-mono">${version}</code></li>
      <li><a href="https://git.kcfam.us/gtfs.zone/test-track" target="_blank" rel="noopener noreferrer" class="link">Source code</a></li>
      <li><a href="https://git.kcfam.us/gtfs.zone/test-track/raw/branch/main/CHANGELOG.md" target="_blank" rel="noopener noreferrer" class="link">Changelog</a></li>
    </ul>
  `;

  return showModal({
    title: 'viz.rt.gtfs.zone',
    body,
    actions: [{ label: 'Close', onClick: () => {} }],
    enterAction: 0,
    escapeAction: 0,
  });
}
