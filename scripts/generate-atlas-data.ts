import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REPO = 'transitland/transitland-atlas';
const BRANCH = 'master';
const CONCURRENCY = 8;
const OUTPUT_PATH = path.join(__dirname, '..', 'public', 'atlas-feeds.json');

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
  places?: Array<{ name: string; adm1_name?: string; adm0_name?: string }>;
}

interface DmfrFile {
  feeds?: DmfrFeed[];
  operators?: DmfrOperator[];
}

interface AtlasFeed {
  id: string;
  name: string;
  operator_name: string;
  location: string;
  staticUrl?: string;
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

function deriveLocation(op: DmfrOperator): string {
  if (op.places && op.places.length > 0) {
    const p = op.places[0];
    const parts = [p.name, p.adm1_name, p.adm0_name].filter(Boolean);
    if (parts.length) return parts.join(', ');
  }
  const tags = op.tags ?? {};
  const country = tags['country_name'] ?? tags['adm0_name'] ?? '';
  const state = tags['us_state_iso'] ?? tags['adm1_name'] ?? '';
  return [state, country].filter(Boolean).join(', ');
}

async function processDmfrFile(rawUrl: string): Promise<AtlasFeed[]> {
  let dmfr: DmfrFile;
  try {
    dmfr = await fetchJson<DmfrFile>(rawUrl);
  } catch {
    return [];
  }

  const operatorMap = new Map<string, DmfrOperator>();
  for (const op of dmfr.operators ?? []) {
    operatorMap.set(op.onestop_id, op);
  }

  const feeds: AtlasFeed[] = [];
  for (const feed of dmfr.feeds ?? []) {
    const urls = feed.urls ?? {};
    const staticUrl = urls.static_current;
    const vehiclesUrl = urls.realtime_vehicle_positions;
    const tripUpdatesUrl = urls.realtime_trip_updates;
    const alertsUrl = urls.realtime_alerts;

    if (!staticUrl && !vehiclesUrl && !tripUpdatesUrl && !alertsUrl) continue;

    const opId = feed.operators?.[0]?.onestop_id;
    const op = opId ? operatorMap.get(opId) : undefined;
    const operatorName = op?.name ?? op?.short_name ?? '';
    const location = op ? deriveLocation(op) : '';

    feeds.push({
      id: feed.id,
      name: op?.short_name ?? op?.name ?? feed.id,
      operator_name: operatorName,
      location,
      ...(staticUrl ? { staticUrl } : {}),
      ...(vehiclesUrl ? { vehiclesUrl } : {}),
      ...(tripUpdatesUrl ? { tripUpdatesUrl } : {}),
      ...(alertsUrl ? { alertsUrl } : {}),
    });
  }
  return feeds;
}

async function main() {
  console.log('Fetching transitland-atlas file tree...');
  const tree = await fetchJson<{ tree: GithubTreeItem[] }>(
    `https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`,
  );

  const dmfrFiles = tree.tree
    .filter(item => item.type === 'blob' && item.path.startsWith('feeds/') && item.path.endsWith('.json'))
    .map(item => `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${item.path}`);

  console.log(`Processing ${dmfrFiles.length} DMFR files...`);

  let done = 0;
  const chunks = await runConcurrently(dmfrFiles, CONCURRENCY, async (url) => {
    const result = await processDmfrFile(url);
    done++;
    if (done % 100 === 0) process.stdout.write(`  ${done}/${dmfrFiles.length}\r`);
    return result;
  });

  const allFeeds = chunks.flat();
  console.log(`\nFound ${allFeeds.length} feeds with URLs.`);

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(allFeeds, null, 2));
  console.log(`Written to ${OUTPUT_PATH}`);
}

main().catch(err => { console.error(err); process.exit(1); });
