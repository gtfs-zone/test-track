/**
 * Two passes over VENDORED.md, against ../coloring-book:
 *
 * - drift: every `verbatim` entry must still match its source at the *recorded*
 *   SHA. A mismatch means someone edited the local copy.
 * - staleness: every entry, `modified` included, is checked for commits landed
 *   on the source path since the recorded SHA. Drift-clean says nothing about
 *   freshness, so without this a file ten commits behind reports `ok`.
 *
 * Staleness is a warning by default, since a routine build should not break
 * the day someone commits upstream. `--strict` makes it fatal.
 *
 * Exits 0 with a "skipped" message when the sibling repo is absent, so CI
 * (which never has it) is never blocked by this check.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRepo = resolve(repoRoot, '..', 'coloring-book');

interface Entry {
  localPath: string;
  sourcePath: string;
  sha: string;
  status: string;
}

function parseVendoredTable(markdown: string): Entry[] {
  const entries: Entry[] = [];
  for (const line of markdown.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim().replace(/^`|`$/g, ''));
    if (cells.length < 4) continue;
    const [localPath, sourcePath, sha, status] = cells;
    if (localPath === 'Local path' || /^-+$/.test(localPath)) continue;
    // `origin` rows are this repo's own canonical files, listed only so the
    // table maps everything that is shared. There is nothing upstream to diff.
    if (status === 'origin') continue;
    entries.push({ localPath, sourcePath, sha, status });
  }
  return entries;
}

/** Drop the leading vendor banner block comment so bodies compare cleanly. */
function stripBanner(text: string): string {
  const match = text.match(/^\s*\/\*[\s\S]*?\*\/\n?/);
  if (match && match[0].includes('@vendored-from')) {
    return text.slice(match[0].length);
  }
  return text;
}

/** Commits on `path` after `sha`, newest first. Empty when the entry is current. */
function commitsSince(sha: string, path: string): string[] {
  try {
    const log = execFileSync(
      'git',
      ['-C', sourceRepo, 'log', '--oneline', `${sha}..HEAD`, '--', path],
      { encoding: 'utf8' }
    ).trim();
    return log ? log.split('\n') : [];
  } catch {
    return [];
  }
}

function readFromSource(sha: string, path: string): string | null {
  try {
    return execFileSync('git', ['-C', sourceRepo, 'show', `${sha}:${path}`], {
      encoding: 'utf8',
    });
  } catch {
    return null;
  }
}

if (!existsSync(sourceRepo)) {
  console.log(`vendor:check skipped — ${sourceRepo} not present`);
  process.exit(0);
}

const entries = parseVendoredTable(
  readFileSync(resolve(repoRoot, 'VENDORED.md'), 'utf8')
);

const strict = process.argv.includes('--strict');

let drift = 0;
let checked = 0;
let stale = 0;

for (const entry of entries) {
  // Staleness applies to every entry: a `modified` file still has to be told
  // about upstream work, even though its body is expected to differ.
  const behind = commitsSince(entry.sha, entry.sourcePath);
  if (behind.length > 0) {
    stale++;
    console.warn(
      `STALE    ${entry.localPath}  (${behind.length} commit${
        behind.length === 1 ? '' : 's'
      } behind ${entry.sha})`
    );
    for (const line of behind) {
      console.warn(`           ${line}`);
    }
  }

  if (entry.status !== 'verbatim') continue;
  checked++;

  const localFile = resolve(repoRoot, entry.localPath);
  if (!existsSync(localFile)) {
    console.error(`MISSING  ${entry.localPath} — listed in VENDORED.md but not on disk`);
    drift++;
    continue;
  }

  const upstream = readFromSource(entry.sha, entry.sourcePath);
  if (upstream === null) {
    console.error(
      `UNREADABLE  ${entry.sourcePath} @ ${entry.sha} — not found in ${sourceRepo}`
    );
    drift++;
    continue;
  }

  const local = stripBanner(readFileSync(localFile, 'utf8'));
  if (local === upstream) {
    console.log(`ok       ${entry.localPath}`);
  } else {
    console.error(
      `DRIFT    ${entry.localPath} differs from ${entry.sourcePath} @ ${entry.sha}`
    );
    drift++;
  }
}

if (drift > 0) {
  console.error(`\n${drift} of ${checked} verbatim entries drifted.`);
  process.exit(1);
}

console.log(`\n${checked} verbatim entries match.`);

if (stale > 0) {
  const message = `${stale} of ${entries.length} entries are behind coloring-book HEAD.`;
  if (strict) {
    console.error(message);
    process.exit(1);
  }
  console.warn(`${message} Re-sync them, or pass --strict to fail on this.`);
}
