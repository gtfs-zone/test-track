import { showModal } from './modal-utils';
import type { FeedConfig } from './atlas-search';

export interface ExampleFeed {
  name: string;
  description?: string;
  config: FeedConfig;
}

// Add entries here to populate the Examples picker.
export const EXAMPLES: ExampleFeed[] = [];

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderRows(examples: ExampleFeed[]): string {
  if (examples.length === 0) {
    return '<p class="text-sm opacity-40 text-center py-8">No examples configured yet.</p>';
  }
  return examples
    .map(
      (ex, i) => `
      <button class="w-full text-left px-3 py-2 hover:bg-base-200 rounded-lg flex items-start gap-2" data-example-idx="${i}">
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium truncate">${escHtml(ex.name)}</p>
          ${ex.description ? `<p class="text-xs opacity-60 truncate">${escHtml(ex.description)}</p>` : ''}
        </div>
      </button>`
    )
    .join('');
}

export async function showExamplesModal(): Promise<FeedConfig | null> {
  let selected: FeedConfig | null = null;

  const body = `<div class="space-y-0.5">${renderRows(EXAMPLES)}</div>`;

  await showModal({
    title: 'Examples',
    body,
    escapeAction: 0,
    actions: [{ label: 'Cancel', onClick: () => {} }],
    onMount: (close) => {
      document.querySelectorAll<HTMLButtonElement>('[data-example-idx]').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.dataset.exampleIdx);
          selected = EXAMPLES[idx].config;
          close();
        });
      });
    },
  });

  return selected;
}
