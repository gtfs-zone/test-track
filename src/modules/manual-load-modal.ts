import { renderUploadIcon, showModal } from './modal-utils';
import type { FeedConfig } from './atlas-search';

export async function showManualLoadModal(): Promise<FeedConfig | null> {
  let result: FeedConfig | null = null;

  const body = `
    <div class="space-y-4">
      <div>
        <label class="label"><span class="label-text font-medium">Static GTFS</span></label>
        <div class="flex gap-2">
          <input type="text" id="manual-static-url" class="input input-bordered input-sm flex-1" placeholder="https://…/gtfs.zip" />
          <button type="button" id="manual-upload-btn" class="btn btn-sm btn-outline gap-1">
            ${renderUploadIcon()} Upload ZIP
          </button>
          <input type="file" id="manual-file-input" accept=".zip" class="hidden" />
        </div>
        <p id="manual-file-name" class="text-xs opacity-60 mt-1 hidden"></p>
      </div>
      <div>
        <label class="label"><span class="label-text font-medium">Vehicle Positions URL</span></label>
        <input type="text" id="manual-vehicles-url" class="input input-bordered input-sm w-full" placeholder="https://…/vehicle_positions.pb" />
      </div>
      <div>
        <label class="label"><span class="label-text font-medium">Trip Updates URL</span></label>
        <input type="text" id="manual-trip-updates-url" class="input input-bordered input-sm w-full" placeholder="https://…/trip_updates.pb" />
      </div>
      <div>
        <label class="label"><span class="label-text font-medium">Service Alerts URL</span></label>
        <input type="text" id="manual-alerts-url" class="input input-bordered input-sm w-full" placeholder="https://…/alerts.pb" />
      </div>
    </div>
  `;

  const actionBarContent = `
    <label class="flex items-center gap-2 text-sm cursor-pointer">
      <input type="checkbox" id="manual-cors-checkbox" class="checkbox checkbox-sm" checked />
      CORS proxy
    </label>
    <div class="tooltip" data-tip="Routes requests through cors.gtfs.zone when the feed server doesn't send CORS headers.">
      <span class="cursor-help opacity-60 text-xs">?</span>
    </div>
  `;

  await showModal({
    title: 'Load Feed Manually',
    body,
    actionBarContent,
    escapeAction: 1,
    enterAction: 0,
    actions: [
      {
        label: 'Load',
        className: 'btn-primary',
        onClick: () => {
          const staticUrl = (document.getElementById('manual-static-url') as HTMLInputElement).value.trim();
          const vehiclesUrl = (document.getElementById('manual-vehicles-url') as HTMLInputElement).value.trim();
          const tripUpdatesUrl = (document.getElementById('manual-trip-updates-url') as HTMLInputElement).value.trim();
          const alertsUrl = (document.getElementById('manual-alerts-url') as HTMLInputElement).value.trim();
          const useCors = (document.getElementById('manual-cors-checkbox') as HTMLInputElement).checked;
          const fileInput = document.getElementById('manual-file-input') as HTMLInputElement;
          const staticFile = fileInput.files?.[0];

          if (!staticUrl && !staticFile && !vehiclesUrl && !tripUpdatesUrl && !alertsUrl) {
            // Keep modal open — nothing filled in
            return true;
          }

          result = {
            staticUrl: staticUrl || undefined,
            staticFile,
            vehiclesUrl: vehiclesUrl || undefined,
            tripUpdatesUrl: tripUpdatesUrl || undefined,
            alertsUrl: alertsUrl || undefined,
            useCors,
          };
        },
      },
      {
        label: 'Cancel',
        onClick: () => {},
      },
    ],
    onMount: () => {
      const uploadBtn = document.getElementById('manual-upload-btn') as HTMLButtonElement;
      const fileInput = document.getElementById('manual-file-input') as HTMLInputElement;
      const fileNameEl = document.getElementById('manual-file-name') as HTMLElement;
      const staticUrlInput = document.getElementById('manual-static-url') as HTMLInputElement;

      uploadBtn.addEventListener('click', () => fileInput.click());

      fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (file) {
          fileNameEl.textContent = file.name;
          fileNameEl.classList.remove('hidden');
          staticUrlInput.value = '';
          staticUrlInput.disabled = true;
        } else {
          fileNameEl.classList.add('hidden');
          staticUrlInput.disabled = false;
        }
      });
    },
  });

  return result;
}
