import { renderUploadIcon, showModal } from './modal-utils';
import type { FeedSelection } from './feed-selection';
import { describeMissing, isComplete } from './feed-selection';
import { normalizeFeedUrl, validateFeedUrl } from './feed-url-resolve';

/** Every URL field, so validation can name the one that is wrong. */
const URL_FIELDS: Array<[id: string, label: string]> = [
  ['manual-static-url', 'Static GTFS'],
  ['manual-vehicles-url', 'Vehicle Positions'],
  ['manual-trip-updates-url', 'Trip Updates'],
  ['manual-alerts-url', 'Service Alerts'],
];

/**
 * The first URL problem in the form, or '' when there is none. Reported through
 * the same hint line as the missing-feed message, so the Load button is never
 * enabled on a URL that cannot be fetched.
 */
function describeBadUrl(): string {
  for (const [id, label] of URL_FIELDS) {
    const raw = (document.getElementById(id) as HTMLInputElement).value.trim();
    if (!raw) continue;
    const reason = validateFeedUrl(raw);
    if (reason) return `${label}: ${reason}`;
  }
  return '';
}

/** Read the current form state as a selection. */
function readForm(): FeedSelection {
  // Normalized here rather than at load time, so what gets stored — and shared
  // in a link — is the URL that was actually fetched.
  const val = (id: string) =>
    normalizeFeedUrl((document.getElementById(id) as HTMLInputElement).value);
  const checked = (id: string) =>
    (document.getElementById(id) as HTMLInputElement).checked;

  const staticUrl = val('manual-static-url');
  const staticFile = (document.getElementById('manual-file-input') as HTMLInputElement)
    .files?.[0];
  const vehiclesUrl = val('manual-vehicles-url');
  const tripUpdatesUrl = val('manual-trip-updates-url');
  const alertsUrl = val('manual-alerts-url');

  let staticSource: FeedSelection['static'] = null;
  if (staticFile) {
    staticSource = { kind: 'file', file: staticFile, label: staticFile.name };
  } else if (staticUrl) {
    staticSource = {
      kind: 'url',
      url: staticUrl,
      useCors: checked('manual-static-cors'),
      label: 'Custom static feed',
    };
  }

  const hasRt = Boolean(vehiclesUrl || tripUpdatesUrl || alertsUrl);
  return {
    static: staticSource,
    realtime: hasRt
      ? {
          vehiclesUrl: vehiclesUrl || undefined,
          tripUpdatesUrl: tripUpdatesUrl || undefined,
          alertsUrl: alertsUrl || undefined,
          useCors: checked('manual-rt-cors'),
          label: 'Custom realtime feed',
        }
      : null,
  };
}

const CORS_TOOLTIP =
  "Routes requests through cors.gtfs.zone when the feed server doesn't send CORS headers.";

function corsToggle(id: string): string {
  return `
    <label class="flex items-center gap-2 text-xs cursor-pointer">
      <input type="checkbox" id="${id}" class="checkbox checkbox-xs" checked />
      CORS proxy
      <span class="tooltip" data-tip="${CORS_TOOLTIP}">
        <span class="cursor-help opacity-60">?</span>
      </span>
    </label>`;
}

export async function showManualLoadModal(): Promise<FeedSelection | null> {
  let result: FeedSelection | null = null;

  const body = `
    <div class="space-y-4">
      <section class="rounded-lg border border-base-300 p-3 space-y-2">
        <div class="flex items-center justify-between gap-2">
          <h4 class="font-medium text-sm">Static GTFS</h4>
          ${corsToggle('manual-static-cors')}
        </div>
        <div class="flex gap-2">
          <input type="text" id="manual-static-url" class="input input-bordered input-sm flex-1" placeholder="https://…/gtfs.zip" />
          <button type="button" id="manual-upload-btn" class="btn btn-sm btn-outline gap-1">
            ${renderUploadIcon()} Upload ZIP
          </button>
          <input type="file" id="manual-file-input" accept=".zip" class="hidden" />
        </div>
        <div id="manual-file-row" class="hidden items-center gap-2">
          <p id="manual-file-name" class="text-xs opacity-60"></p>
          <button type="button" id="manual-file-clear" class="btn btn-ghost btn-xs">Clear</button>
        </div>
      </section>

      <section class="rounded-lg border border-base-300 p-3 space-y-2">
        <div class="flex items-center justify-between gap-2">
          <h4 class="font-medium text-sm">Realtime GTFS-RT</h4>
          ${corsToggle('manual-rt-cors')}
        </div>
        <p class="text-xs opacity-60">At least one endpoint is required.</p>
        <label class="label py-1"><span class="label-text text-xs">Vehicle Positions URL</span></label>
        <input type="text" id="manual-vehicles-url" class="input input-bordered input-sm w-full" placeholder="https://…/vehicle_positions.pb" />
        <label class="label py-1"><span class="label-text text-xs">Trip Updates URL</span></label>
        <input type="text" id="manual-trip-updates-url" class="input input-bordered input-sm w-full" placeholder="https://…/trip_updates.pb" />
        <label class="label py-1"><span class="label-text text-xs">Service Alerts URL</span></label>
        <input type="text" id="manual-alerts-url" class="input input-bordered input-sm w-full" placeholder="https://…/alerts.pb" />
      </section>
    </div>
  `;

  const actionBarContent = `<p id="manual-hint" class="text-xs opacity-60"></p>`;

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
          const sel = readForm();
          if (describeBadUrl() || !isComplete(sel)) return true;
          result = sel;
          return;
        },
      },
      { label: 'Cancel', onClick: () => {} },
    ],
    onMount: () => {
      const uploadBtn = document.getElementById('manual-upload-btn') as HTMLButtonElement;
      const fileInput = document.getElementById('manual-file-input') as HTMLInputElement;
      const fileRow = document.getElementById('manual-file-row') as HTMLElement;
      const fileNameEl = document.getElementById('manual-file-name') as HTMLElement;
      const clearBtn = document.getElementById('manual-file-clear') as HTMLButtonElement;
      const staticUrlInput = document.getElementById('manual-static-url') as HTMLInputElement;
      const staticCors = document.getElementById('manual-static-cors') as HTMLInputElement;
      const hintEl = document.getElementById('manual-hint')!;
      const loadBtn = staticUrlInput
        .closest('.modal')!
        .querySelector<HTMLButtonElement>('button[data-idx="0"]')!;

      const revalidate = () => {
        const problem = describeBadUrl() || describeMissing(readForm());
        loadBtn.disabled = problem !== '';
        hintEl.textContent = problem;
      };

      const showFile = (file: File | undefined) => {
        if (file) {
          fileNameEl.textContent = file.name;
          fileRow.classList.remove('hidden');
          fileRow.classList.add('flex');
          staticUrlInput.value = '';
          staticUrlInput.disabled = true;
          staticCors.disabled = true;
        } else {
          fileRow.classList.add('hidden');
          fileRow.classList.remove('flex');
          staticUrlInput.disabled = false;
          staticCors.disabled = false;
        }
        revalidate();
      };

      uploadBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => showFile(fileInput.files?.[0]));
      clearBtn.addEventListener('click', () => {
        fileInput.value = '';
        showFile(undefined);
      });

      document
        .querySelectorAll<HTMLInputElement>('#manual-static-url, #manual-vehicles-url, #manual-trip-updates-url, #manual-alerts-url')
        .forEach(input => input.addEventListener('input', revalidate));

      revalidate();
    },
  });

  return result;
}
