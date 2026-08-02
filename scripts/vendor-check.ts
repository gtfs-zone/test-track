/**
 * Diff every `verbatim` entry in VENDORED.md against ../coloring-book at the
 * recorded SHA. Exits 0 with a "skipped" message when the sibling repo is
 * absent, so CI (which never has it) is never blocked by this check.
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

let drift = 0;
let checked = 0;

for (const entry of entries) {
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
