/* @vendored-from coloring-book:src/modules/panel-resizer.ts
   @sha f9c718c
   @status modified
   @changes
   - Import path is `../map-controller` (test-track keeps MapController at src root).
   - Persists the resulting width to localStorage under `panel-width` on mouseup.
   - Adds an exported `restorePanelWidth(appContainer)` to apply the stored width at boot. */
import { MapController } from '../map-controller';

const MIN_WIDTH = 300;
const MAX_WIDTH = 1500;
const DEFAULT_WIDTH = 650;
const STORAGE_KEY = 'panel-width';

/** Apply the persisted panel width, if any, before the map first sizes itself. */
export function restorePanelWidth(appContainer: HTMLElement): void {
  const stored = Number(localStorage.getItem(STORAGE_KEY));
  if (!Number.isFinite(stored) || stored <= 0) {
    return;
  }
  const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, stored));
  appContainer.style.setProperty('--panel-width', `${width}px`);
}

export class PanelResizer {
  constructor(appContainer: HTMLElement, mapController: MapController) {
    const resizer = document.getElementById('panel-resizer');
    if (!resizer) {
      return;
    }

    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth =
        parseInt(
          getComputedStyle(appContainer).getPropertyValue('--panel-width')
        ) || DEFAULT_WIDTH;

      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';

      let currentWidth = startWidth;

      const onMouseMove = (e: MouseEvent) => {
        currentWidth = Math.min(
          MAX_WIDTH,
          Math.max(MIN_WIDTH, startWidth + startX - e.clientX)
        );
        appContainer.style.setProperty('--panel-width', `${currentWidth}px`);
        mapController.resizeNow();
      };

      const onMouseUp = () => {
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        localStorage.setItem(STORAGE_KEY, String(currentWidth));
        mapController.forceMapResize();
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }
}
