/* @vendored-from coloring-book:src/modules/about-links.ts
   @sha 310dce0
   @status verbatim */
// The off-site destinations both gtfs.zone apps name in their About modal, and
// the blocks that render them. Each app supplies its own identity through
// `AboutApp` and keeps its own app-specific middle sections; everything here is
// shared so a URL cannot drift between the two modals.

const SITE_URL = 'https://gtfs.zone';
const FORGE_URL = 'https://git.kcfam.us/gtfs.zone';
const CONTACT_EMAIL = 'inquiry@gtfs.zone';

export interface AboutApp {
  /** Host name, used as the modal title and in prose. */
  name: string;
  /** One paragraph saying what the app does. */
  blurb: string;
  /** Forgejo repo name under gtfs.zone. */
  repo: string;
  /** The other app, linked so each modal points at its sibling. */
  sibling: { name: string; href: string; note: string };
}

/** External anchor. Every off-site link in the modal goes through this. */
function link(href: string, label: string): string {
  return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="link">${label}</a>`;
}

function divider(label: string): string {
  return `<div class="divider text-sm font-semibold opacity-60">${label}</div>`;
}

function list(items: string[]): string {
  return `<ul class="list-none space-y-1 text-sm">${items
    .map((item) => `<li>${item}</li>`)
    .join('')}</ul>`;
}

export function renderBlurb(app: AboutApp): string {
  return `<p>${app.blurb}</p>`;
}

export function renderVersionAndSource(app: AboutApp, version: string): string {
  const repo = `${FORGE_URL}/${app.repo}`;
  return (
    divider('Version &amp; Source') +
    list([
      `Version: <code class="font-mono">${version}</code>`,
      link(repo, 'Source code'),
      link(`${repo}/raw/branch/main/CHANGELOG.md`, 'Changelog'),
    ])
  );
}

export function renderProjectSection(app: AboutApp): string {
  return (
    divider('Project') +
    list([
      `${link(SITE_URL, 'gtfs.zone')}: the project these tools belong to`,
      `${link(app.sibling.href, app.sibling.name)}: ${app.sibling.note}`,
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
  return (
    divider('Feedback') +
    list([
      `<a href="mailto:${CONTACT_EMAIL}" class="link">${CONTACT_EMAIL}</a>: questions, feed requests, anything else`,
      `${link(`${FORGE_URL}/${app.repo}/issues/new`, 'File an issue')}: bug reports and feature requests (needs a git.kcfam.us account)`,
    ])
  );
}
