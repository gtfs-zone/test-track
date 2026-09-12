/* @vendored-from coloring-book:scripts/generate-atlas-data.ts
   @sha f91fd8a
   @status verbatim */
/**
 * Build public/atlas-feeds.json from the transitland-atlas DMFR corpus.
 *
 * Two passes. The first walks every DMFR file and builds a global operator
 * index; the second walks feeds and resolves against it. A per-file index does
 * not work: in the real corpus a feed almost never declares `operators[]` —
 * the link runs the other way, from `operator.associated_feeds[].feed_onestop_id`
 * back to the feed, and frequently from a different file than the feed lives in.
 *
 * Output is one row per *source kind*: a `static` row when the feed has
 * `static_current`, an `rt` row when it has any realtime URL. The UI pins one of
 * each, so they must be separately selectable.
 *
 * `--schedule-only` drops the rt rows. An app with no realtime would otherwise
 * ship several hundred KB of endpoints it can never load, and this is the only
 * difference between the two apps' copies of this file — so it is a flag rather
 * than a fork.
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REPO = 'transitland/transitland-atlas';
const BRANCH = 'main';
const CONCURRENCY = 8;
const OUTPUT_PATH = path.join(__dirname, '..', 'public', 'atlas-feeds.json');
const LOCAL_ATLAS_PATH = path.join(__dirname, '..', '..', 'transitland-atlas');

/** GBFS is bikeshare discovery, not something this app can load. */
const USABLE_SPECS = new Set(['gtfs', 'gtfs-rt']);

const SCHEDULE_ONLY = process.argv.includes('--schedule-only');

interface DmfrUrls {
  static_current?: string;
  realtime_vehicle_positions?: string;
  realtime_trip_updates?: string;
  realtime_alerts?: string;
}

interface DmfrFeed {
  id: string;
  spec?: string;
  urls?: DmfrUrls;
  operators?: Array<{ onestop_id: string }>;
}

interface DmfrOperator {
  onestop_id: string;
  name?: string;
  short_name?: string;
  tags?: Record<string, string>;
  associated_feeds?: Array<{ feed_onestop_id?: string; gtfs_agency_id?: string }>;
}

interface DmfrFile {
  feeds?: DmfrFeed[];
  operators?: DmfrOperator[];
}

/** One DMFR document plus where it came from (the domain is search context). */
interface SourceDoc {
  origin: string;
  dmfr: DmfrFile;
}

export interface AtlasRow {
  /** Stable identity for pinning: `${feedId}:static` or `${feedId}:rt`. */
  rowId: string;
  kind: 'static' | 'rt';
  feedId: string;
  name: string;
  operator_name: string;
  /** DMFR source domain (e.g. "511.org"). The corpus carries no place data. */
  source: string;
  scheduledUrl?: string;
  vehiclesUrl?: string;
  tripUpdatesUrl?: string;
  alertsUrl?: string;
}

interface GithubTreeItem {
  path: string;
  type: string;
  sha: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'generate-atlas-data' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.json() as Promise<T>;
}

async function runConcurrently<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

/** "511.org.dmfr.json" → "511.org" */
function originFromFilename(filePath: string): string {
  return path.basename(filePath).replace(/\.dmfr\.json$/, '').replace(/\.json$/, '');
}

const GEOHASH_SEGMENT = /^[0-9bcdefghjkmnpqrstuvwxyz]{1,6}$/;

/**
 * Humanize a feed onestop id when no operator resolves.
 * `f-9q8-samtrans` → "samtrans"; `f-columbia~county~public~transportation` →
 * "columbia county public transportation".
 *
 * The second dash-segment of a onestop id is a geohash when one is present, so
 * it is dropped — but only when there is a third segment to fall back to,
 * otherwise a genuinely short name would be eaten.
 */
function humanizeFeedId(feedId: string): string {
  const segments = feedId.split('-');
  if (segments[0] === 'f') segments.shift();
  if (segments.length > 1 && GEOHASH_SEGMENT.test(segments[0])) segments.shift();
  return segments
    .join('-')
    .replace(/~/g, ' ')
    .replace(/_/g, ' ')
    .trim();
}

/** Global operator index, keyed by feed onestop id. */
function buildOperatorIndex(docs: SourceDoc[]): Map<string, DmfrOperator> {
  const byOnestopId = new Map<string, DmfrOperator>();
  const byFeedId = new Map<string, DmfrOperator>();

  for (const { dmfr } of docs) {
    for (const op of dmfr.operators ?? []) {
      byOnestopId.set(op.onestop_id, op);
      for (const assoc of op.associated_feeds ?? []) {
        // First operator to claim a feed wins; later files do not clobber.
        if (assoc.feed_onestop_id && !byFeedId.has(assoc.feed_onestop_id)) {
          byFeedId.set(assoc.feed_onestop_id, op);
        }
      }
    }
  }

  // Feeds that *do* declare operators[] get resolved through the onestop index.
  for (const { dmfr } of docs) {
    for (const feed of dmfr.feeds ?? []) {
      if (byFeedId.has(feed.id)) continue;
      const opId = feed.operators?.[0]?.onestop_id;
      const op = opId ? byOnestopId.get(opId) : undefined;
      if (op) byFeedId.set(feed.id, op);
    }
  }

  return byFeedId;
}

function buildRows(docs: SourceDoc[]): AtlasRow[] {
  const operatorsByFeedId = buildOperatorIndex(docs);
  const rows: AtlasRow[] = [];
  const seenRowIds = new Set<string>();

  for (const { origin, dmfr } of docs) {
    for (const feed of dmfr.feeds ?? []) {
      if (!USABLE_SPECS.has(feed.spec ?? 'gtfs')) continue;

      const urls = feed.urls ?? {};
      const scheduledUrl = urls.static_current;
      const vehiclesUrl = urls.realtime_vehicle_positions;
      const tripUpdatesUrl = urls.realtime_trip_updates;
      const alertsUrl = urls.realtime_alerts;
      if (!scheduledUrl && !vehiclesUrl && !tripUpdatesUrl && !alertsUrl) continue;

      const op = operatorsByFeedId.get(feed.id);
      const operatorName = op?.name ?? op?.short_name ?? '';
      const name = op?.short_name ?? op?.name ?? humanizeFeedId(feed.id);

      const base = {
        feedId: feed.id,
        name,
        operator_name: operatorName,
        source: origin,
      };

      const push = (row: AtlasRow) => {
        if (seenRowIds.has(row.rowId)) return;
        seenRowIds.add(row.rowId);
        rows.push(row);
      };

      if (scheduledUrl) {
        push({ ...base, rowId: `${feed.id}:static`, kind: 'static', scheduledUrl });
      }
      if (!SCHEDULE_ONLY && (vehiclesUrl || tripUpdatesUrl || alertsUrl)) {
        push({
          ...base,
          rowId: `${feed.id}:rt`,
          kind: 'rt',
          ...(vehiclesUrl ? { vehiclesUrl } : {}),
          ...(tripUpdatesUrl ? { tripUpdatesUrl } : {}),
          ...(alertsUrl ? { alertsUrl } : {}),
        });
      }
    }
  }

  rows.sort((a, b) => a.rowId.localeCompare(b.rowId));
  return rows;
}

async function writeRows(rows: AtlasRow[]): Promise<void> {
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  // Minified: this file is fetched by the browser on first atlas open.
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(rows));

  const { size } = await fs.stat(OUTPUT_PATH);
  const scheduledCount = rows.filter(r => r.kind === 'static').length;
  const named = rows.filter(r => r.operator_name).length;
  console.log(
    `\n${rows.length} rows (${scheduledCount} scheduled, ${rows.length - scheduledCount} rt), ` +
      `${named} with a resolved operator, ${(size / 1024 / 1024).toFixed(2)} MB`,
  );
  console.log(`Written to ${OUTPUT_PATH}`);
}

async function mainLocal(atlasPath: string) {
  const feedsDir = path.join(atlasPath, 'feeds');
  const entries = await fs.readdir(feedsDir, { recursive: true });
  const dmfrFiles = (entries as string[])
    .filter(e => e.endsWith('.json'))
    .map(e => path.join(feedsDir, e));

  console.log(`Reading ${dmfrFiles.length} local DMFR files from ${atlasPath}...`);

  const docs = await runConcurrently(dmfrFiles, CONCURRENCY, async (filePath) => {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return { origin: originFromFilename(filePath), dmfr: JSON.parse(raw) as DmfrFile };
    } catch {
      return { origin: originFromFilename(filePath), dmfr: {} as DmfrFile };
    }
  });

  await writeRows(buildRows(docs));
}

async function mainRemote() {
  console.log('Fetching transitland-atlas file tree from GitHub...');
  const tree = await fetchJson<{ tree: GithubTreeItem[] }>(
    `https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`,
  );

  const dmfrFiles = tree.tree
    .filter(item => item.type === 'blob' && item.path.startsWith('feeds/') && item.path.endsWith('.json'))
    .map(item => item.path);

  console.log(`Fetching ${dmfrFiles.length} DMFR files...`);

  let done = 0;
  const docs = await runConcurrently(dmfrFiles, CONCURRENCY, async (repoPath) => {
    const url = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${repoPath}`;
    let dmfr: DmfrFile;
    try {
      dmfr = await fetchJson<DmfrFile>(url);
    } catch {
      dmfr = {};
    }
    done++;
    if (done % 100 === 0) process.stdout.write(`  ${done}/${dmfrFiles.length}\r`);
    return { origin: originFromFilename(repoPath), dmfr };
  });

  await writeRows(buildRows(docs));
}

async function main() {
  try {
    await fs.access(LOCAL_ATLAS_PATH);
    await mainLocal(LOCAL_ATLAS_PATH);
  } catch {
    await mainRemote();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
