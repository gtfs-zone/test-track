/**
 * Two passes over VENDORED.md. Every row names its own `Source repo` and is
 * resolved against that sibling checkout, which is every vendored row
 * coloring-book today:
 *
 * - drift: every `verbatim` entry must still match its source at the *recorded*
 *   SHA. A mismatch means someone edited the local copy.
 * - staleness: `verbatim` and `modified` entries are checked for commits landed
 *   on the source path since the recorded SHA. Drift-clean says nothing about
 *   freshness, so without this a file ten commits behind reports `ok`.
 *
 * Two statuses are exempt from both passes, and both are counted in the summary
 * so the tier stays visible rather than silently unchecked:
 *
 * - `adopted`: was vendored, is test-track's file now. The banner records
 *   where it came from, but feature work has taken it over far enough that
 *   re-syncing has stopped being meaningful, so upstream commits on it are
 *   not news.
 * - `origin`: never vendored. test-track is the canonical source another repo
 *   vendors *from*, so the row carries no source repo, no source path and no
 *   SHA. It is listed only so the table is the whole map of what is shared.
 *
 * Staleness is a warning by default, since a routine build should not break
 * the day someone commits upstream. `--strict` makes it fatal.
 *
 * A row whose sibling repo is absent is skipped, and the run exits 0 when every
 * row was skipped, so CI (which has neither sibling) is never blocked by this.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const siblingRoot = resolve(repoRoot, '..');

interface Entry {
  localPath: string;
  sourceRepo: string;
  sourcePath: string;
  sha: string;
  status: string;
}

/** Absolute path of the checkout a row resolves against. */
function repoPath(sourceRepo: string): string {
  return resolve(siblingRoot, sourceRepo);
}

function parseVendoredTable(markdown: string): Entry[] {
  const entries: Entry[] = [];
  for (const line of markdown.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim().replace(/^`|`$/g, ''));
    if (cells.length < 5) continue;
    const [localPath, sourceRepo, sourcePath, sha, status] = cells;
    if (localPath === 'Local path' || /^-+$/.test(localPath)) continue;
    // An `origin` row has nothing upstream, so its source cells are dashes.
    // Every other row is dropped unless it resolves to a real commit.
    if (status === 'origin') {
      entries.push({ localPath, sourceRepo: '', sourcePath: '', sha: '', status });
      continue;
    }
    if (!sourceRepo || !sourcePath || !/^[0-9a-f]{7,40}$/.test(sha)) continue;
    entries.push({ localPath, sourceRepo, sourcePath, sha, status });
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
function commitsSince(repo: string, sha: string, path: string): string[] {
  try {
    const log = execFileSync(
      'git',
      ['-C', repo, 'log', '--oneline', `${sha}..HEAD`, '--', path],
      { encoding: 'utf8' }
    ).trim();
    return log ? log.split('\n') : [];
  } catch {
    return [];
  }
}

function readFromSource(repo: string, sha: string, path: string): string | null {
  try {
    return execFileSync('git', ['-C', repo, 'show', `${sha}:${path}`], {
      encoding: 'utf8',
    });
  } catch {
    return null;
  }
}

const entries = parseVendoredTable(
  readFileSync(resolve(repoRoot, 'VENDORED.md'), 'utf8')
);

const strict = process.argv.includes('--strict');

let drift = 0;
let checked = 0;
let stale = 0;
let skipped = 0;
let adopted = 0;
let origin = 0;

// One line per absent sibling rather than one per row it would have covered.
const reportedMissing = new Set<string>();

for (const entry of entries) {
  // Both of these come before the sibling lookup: neither needs a checkout, so
  // neither may count towards `skipped` and trip the all-skipped early exit.
  if (entry.status === 'adopted') {
    adopted++;
    console.log(`adopted  ${entry.localPath}`);
    continue;
  }

  if (entry.status === 'origin') {
    origin++;
    console.log(`origin   ${entry.localPath}`);
    continue;
  }

  const repo = repoPath(entry.sourceRepo);
  if (!existsSync(repo)) {
    skipped++;
    if (!reportedMissing.has(entry.sourceRepo)) {
      reportedMissing.add(entry.sourceRepo);
      console.log(`skipped  rows from ${entry.sourceRepo} - ${repo} not present`);
    }
    continue;
  }

  // Staleness applies to every checked entry: a `modified` file still has to be
  // told about upstream work, even though its body is expected to differ.
  const behind = commitsSince(repo, entry.sha, entry.sourcePath);
  if (behind.length > 0) {
    stale++;
    console.warn(
      `STALE    ${entry.localPath}  (${behind.length} commit${
        behind.length === 1 ? '' : 's'
      } behind ${entry.sourceRepo}@${entry.sha})`
    );
    for (const line of behind) {
      console.warn(`           ${line}`);
    }
  }

  if (entry.status !== 'verbatim') continue;
  checked++;

  const localFile = resolve(repoRoot, entry.localPath);
  if (!existsSync(localFile)) {
    console.error(`MISSING  ${entry.localPath} - listed in VENDORED.md but not on disk`);
    drift++;
    continue;
  }

  const upstream = readFromSource(repo, entry.sha, entry.sourcePath);
  if (upstream === null) {
    console.error(
      `UNREADABLE  ${entry.sourceRepo}:${entry.sourcePath} @ ${entry.sha} - not found in ${repo}`
    );
    drift++;
    continue;
  }

  const local = stripBanner(readFileSync(localFile, 'utf8'));
  if (local === upstream) {
    console.log(`ok       ${entry.localPath}`);
  } else {
    console.error(
      `DRIFT    ${entry.localPath} differs from ${entry.sourceRepo}:${entry.sourcePath} @ ${entry.sha}`
    );
    drift++;
  }
}

if (entries.length === 0) {
  console.error('VENDORED.md lists no entries - the table is empty or malformed.');
  process.exit(1);
}

const unchecked = adopted + origin;

if (skipped > 0 && skipped + unchecked === entries.length) {
  console.log('vendor:check skipped - no sibling repo present');
  process.exit(0);
}

if (drift > 0) {
  console.error(`\n${drift} of ${checked} verbatim entries drifted.`);
  process.exit(1);
}

const notChecked = [
  adopted > 0 ? `${adopted} adopted` : null,
  origin > 0 ? `${origin} origin` : null,
].filter(Boolean);

console.log(
  `\n${checked} verbatim entries match` +
    (notChecked.length > 0 ? `, ${notChecked.join(' and ')} not checked.` : '.')
);

if (stale > 0) {
  const message = `${stale} of ${entries.length - unchecked} checked entries are behind their source repo's HEAD.`;
  if (strict) {
    console.error(message);
    process.exit(1);
  }
  console.warn(`${message} Re-sync them, or pass --strict to fail on this.`);
}
