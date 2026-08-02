import JSZip from 'jszip';
import Papa from 'papaparse';

export interface Stop {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface Route {
  id: string;
  short_name: string;
  long_name: string;
  color: string;
  text_color: string;
  type: number;
}

export interface Trip {
  trip_id: string;
  route_id: string;
  shape_id: string;
  headsign: string;
}

/** Verbatim CSV rows, kept for the status page's raw dumps. */
export type RawRow = Record<string, string>;

export interface LoadHooks {
  /** `total` is null when the server sends no Content-Length. */
  onDownload?: (loaded: number, total: number | null) => void;
  onParse?: (fileName: string, done: number, total: number) => void;
}

export interface StaticCounts {
  stops: number;
  routes: number;
  trips: number;
  shapes: number;
  agencies: number;
  services: number;
}

function parseCSV(text: string): RawRow[] {
  return Papa.parse<RawRow>(text, {
    header: true,
    skipEmptyLines: true,
  }).data;
}

/** Files parsed in order, for per-file progress reporting. */
const PARSE_ORDER = [
  'agency.txt',
  'feed_info.txt',
  'calendar.txt',
  'stops.txt',
  'routes.txt',
  'shapes.txt',
  'trips.txt',
  'stop_times.txt',
] as const;

export class GTFSStatic {
  stops = new Map<string, Stop>();
  routes = new Map<string, Route>();
  shapes = new Map<string, [number, number][]>();
  trips = new Map<string, Trip>();
  stopTrips = new Map<string, string[]>();

  /** Raw rows for the tables the status page dumps verbatim. */
  agencies: RawRow[] = [];
  feedInfo: RawRow[] = [];
  calendar: RawRow[] = [];

  async loadFromFile(file: File, hooks: LoadHooks = {}): Promise<void> {
    const zip = await JSZip.loadAsync(file);
    await this.parse(zip, hooks);
  }

  async loadFromUrl(url: string, hooks: LoadHooks = {}): Promise<void> {
    const buffer = await downloadWithProgress(url, hooks.onDownload);
    const zip = await JSZip.loadAsync(buffer);
    await this.parse(zip, hooks);
  }

  counts(): StaticCounts {
    return {
      stops: this.stops.size,
      routes: this.routes.size,
      trips: this.trips.size,
      shapes: this.shapes.size,
      agencies: this.agencies.length,
      services: this.calendar.length,
    };
  }

  private async parse(zip: JSZip, hooks: LoadHooks): Promise<void> {
    const handlers: Record<string, (rows: RawRow[]) => void> = {
      'agency.txt': rows => { this.agencies = rows; },
      'feed_info.txt': rows => { this.feedInfo = rows; },
      'calendar.txt': rows => { this.calendar = rows; },
      'stops.txt': rows => this.ingestStops(rows),
      'routes.txt': rows => this.ingestRoutes(rows),
      'shapes.txt': rows => this.ingestShapes(rows),
      'trips.txt': rows => this.ingestTrips(rows),
      'stop_times.txt': rows => this.ingestStopTimes(rows),
    };

    // Sequential rather than Promise.all: parsing is CPU-bound anyway, and
    // serial order is what makes per-file progress meaningful.
    let done = 0;
    for (const name of PARSE_ORDER) {
      hooks.onParse?.(name, done, PARSE_ORDER.length);
      const file = zip.file(name);
      if (file) handlers[name](parseCSV(await file.async('text')));
      done++;
      hooks.onParse?.(name, done, PARSE_ORDER.length);
    }
  }

  private ingestStops(rows: RawRow[]): void {
    for (const row of rows) {
      this.stops.set(row.stop_id, {
        id: row.stop_id,
        name: row.stop_name,
        lat: parseFloat(row.stop_lat),
        lon: parseFloat(row.stop_lon),
      });
    }
  }

  private ingestRoutes(rows: RawRow[]): void {
    for (const row of rows) {
      this.routes.set(row.route_id, {
        id: row.route_id,
        short_name: row.route_short_name ?? '',
        long_name: row.route_long_name ?? '',
        color: row.route_color ? `#${row.route_color}` : '#0066ff',
        text_color: row.route_text_color ? `#${row.route_text_color}` : '#ffffff',
        type: parseInt(row.route_type ?? '3'),
      });
    }
  }

  private ingestShapes(rows: RawRow[]): void {
    const temp = new Map<string, { seq: number; lon: number; lat: number }[]>();
    for (const row of rows) {
      const id = row.shape_id;
      if (!temp.has(id)) temp.set(id, []);
      temp.get(id)!.push({
        seq: parseInt(row.shape_pt_sequence),
        lat: parseFloat(row.shape_pt_lat),
        lon: parseFloat(row.shape_pt_lon),
      });
    }
    for (const [id, pts] of temp) {
      pts.sort((a, b) => a.seq - b.seq);
      this.shapes.set(id, pts.map(p => [p.lon, p.lat]));
    }
  }

  private ingestTrips(rows: RawRow[]): void {
    for (const row of rows) {
      this.trips.set(row.trip_id, {
        trip_id: row.trip_id,
        route_id: row.route_id,
        shape_id: row.shape_id ?? '',
        headsign: row.trip_headsign ?? '',
      });
    }
  }

  private ingestStopTimes(rows: RawRow[]): void {
    for (const row of rows) {
      const { stop_id, trip_id } = row;
      if (!this.stopTrips.has(stop_id)) this.stopTrips.set(stop_id, []);
      const trips = this.stopTrips.get(stop_id)!;
      if (!trips.includes(trip_id)) trips.push(trip_id);
    }
  }
}

/**
 * Fetch a zip, reporting real byte progress when the server tells us the size.
 * Falls back to a single unmeasured read when the body is not streamable.
 */
async function downloadWithProgress(
  url: string,
  onProgress?: (loaded: number, total: number | null) => void,
): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch GTFS: ${response.status}`);

  const lengthHeader = response.headers.get('Content-Length');
  const total = lengthHeader ? Number(lengthHeader) : null;

  if (!response.body || !onProgress) {
    onProgress?.(0, total);
    return response.arrayBuffer();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded, total);
  }

  const merged = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged.buffer;
}
