/* @vendored-from coloring-book:src/modules/about-links.ts
   @sha 9673099
   @status verbatim */
// The off-site destinations both gtfs.zone apps name in their About modal, and
// the blocks that render them. Each app supplies its own identity through
// `AboutApp` and keeps its own app-specific middle sections; everything here is
// shared so a URL cannot drift between the two modals.

const SITE_URL = 'https://gtfs.zone';
const MANAGER_URL = 'https://manage.rt.gtfs.zone';
const FORGE_URL = 'https://git.kcfam.us/gtfs.zone';
const GITHUB_URL = 'https://github.com/gtfs-zone';
const CONTACT_EMAIL = 'inquiry@gtfs.zone';

export interface AboutApp {
  /** Host name, used as the modal title and in prose. */
  name: string;
  /** Lead paragraphs saying what the app does, one <p> each. */
  blurb: string[];
  /** Optional bulleted list of what the app shows, under the paragraphs. */
  highlights?: string[];
  /** Optional closing paragraph, rendered after the bullets. */
  blurbFooter?: string;
  /** Subject line the contact link opens with. */
  contactSubject: string;
  /** Repo name, the same on the Forgejo origin and the GitHub mirror. */
  repo: string;
  /** The other app, linked so each modal points at its sibling. */
  sibling: { name: string; href: string; note: string };
}

/** External anchor. Every off-site link in the modal goes through this. */
function link(href: string, label: string): string {
  return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="link">${label}</a>`;
}

/** Exported for other prose that wants the same off-site anchor styling. */
export const renderExternalLink = link;

/** The TransitLand Atlas URL named in `renderResourcesSection()`. */
export const TRANSITLAND_URL = 'https://www.transit.land/';

function divider(label: string): string {
  return `<div class="divider text-sm font-semibold opacity-60">${label}</div>`;
}

function bullets(items: string[]): string {
  return `<ul class="list-disc list-inside space-y-1 text-sm">${items
    .map((item) => `<li>${item}</li>`)
    .join('')}</ul>`;
}

function list(items: string[]): string {
  return `<ul class="list-none space-y-1 text-sm">${items
    .map((item) => `<li>${item}</li>`)
    .join('')}</ul>`;
}

export function renderBlurb(app: AboutApp): string {
  // Lead paragraphs, then the bullets, then a closing line. Breaking the blurb
  // up this way is what keeps a long one from reading as a wall of prose.
  const parts = app.blurb.map((p) => `<p>${p}</p>`);
  if (app.highlights) {
    parts.push(bullets(app.highlights));
  }
  if (app.blurbFooter) {
    parts.push(`<p>${app.blurbFooter}</p>`);
  }
  return `<div class="space-y-2">${parts.join('')}</div>`;
}

export function renderVersionAndSource(app: AboutApp, version: string): string {
  const repo = `${FORGE_URL}/${app.repo}`;
  return (
    divider('Version &amp; Source') +
    list([
      `Version: <code class="font-mono">${version}</code>`,
      link(repo, 'Source code'),
      link(`${repo}/src/branch/main/CHANGELOG.md`, 'Changelog'),
    ])
  );
}

export function renderProjectSection(app: AboutApp): string {
  return (
    divider('Project') +
    list([
      `${link(SITE_URL, 'gtfs.zone')}: the project these tools belong to`,
      `${link(app.sibling.href, app.sibling.name)}: ${app.sibling.note}`,
      `${link(MANAGER_URL, 'manage.rt.gtfs.zone')}: run your own realtime feed (needs an account)`,
    ])
  );
}

export function renderResourcesSection(): string {
  return (
    divider('Resources') +
    list([
      `${link('https://gtfs.org/reference/', 'GTFS Spec Reference')}: official file format and field reference`,
      `${link('https://www.transit.land/', 'TransitLand Atlas')}: real-world GTFS feeds, the source behind Load -&gt; From TransitLand Atlas`,
    ])
  );
}

export function renderFeedbackSection(app: AboutApp): string {
  // The mailto is first because Forgejo redirects anonymous visitors away from
  // the new-issue form; the email always works.
  const mailto = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(app.contactSubject)}`;
  return (
    divider('Feedback') +
    list([
      `${link(mailto, CONTACT_EMAIL)}: questions, feed requests, anything else`,
      `${link(`${GITHUB_URL}/${app.repo}/issues/new`, 'File an issue on GitHub')}: bug reports and feature requests`,
      `${link(`${FORGE_URL}/${app.repo}/issues/new`, 'File an issue on Forgejo')}: the same, on the primary forge (needs a git.kcfam.us account)`,
    ])
  );
}
