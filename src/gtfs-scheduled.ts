import JSZip from 'jszip';
import Papa from 'papaparse';
import { splitInnerZipPath } from './modules/feed-url-resolve';
import { downloadWithProgress } from './modules/feed-download';
import { routeColor, routeTextColor } from './utils/route-colors';

/** Verbatim CSV rows, kept so object pages can dump every column. */
export type RawRow = Record<string, string>;

/**
 * Every entity keeps its parsed convenience fields *and* the original CSV row,
 * so an object page can show a typed summary above a verbatim column table.
 *
 * `StopTime` is the one exception: it has no object page, and stop_times.txt is
 * by far the largest file (hundreds of thousands of rows for a mid-size
 * agency), so keeping a `raw` copy of each row would roughly double the memory
 * cost of a feed for nothing.
 */
export interface Stop {
  id: string;
  name: string;
  lat: number;
  lon: number;
  location_type: number;
  parent_station: string;
  raw: RawRow;
}

export interface Route {
  id: string;
  short_name: string;
  long_name: string;
  color: string;
  text_color: string;
  type: number;
  agency_id: string;
  raw: RawRow;
}

export interface Trip {
  trip_id: string;
  route_id: string;
  service_id: string;
  shape_id: string;
  headsign: string;
  direction_id: string;
  raw: RawRow;
}

export interface StopTime {
  trip_id: string;
  stop_id: string;
  stop_sequence: number;
  arrival_time: string;
  departure_time: string;
}

export interface Agency {
  id: string;
  name: string;
  url: string;
  timezone: string;
  raw: RawRow;
}

export interface Calendar {
  service_id: string;
  start_date: string;
  end_date: string;
  /** Monday-first, indexed 0–6. */
  days: boolean[];
  raw: RawRow;
}

export interface CalendarDate {
  service_id: string;
  date: string;
  /** 1 = service added, 2 = service removed. */
  exception_type: number;
  raw: RawRow;
}

export interface FeedInfo {
  publisher_name: string;
  publisher_url: string;
  lang: string;
  version: string;
  raw: RawRow;
}

export interface LoadHooks {
  /** `total` is null when the server sends no Content-Length. */
  onDownload?: (loaded: number, total: number | null) => void;
  onParse?: (fileName: string, done: number, total: number) => void;
  /** Aborts the download only; a parse always runs to completion. */
  signal?: AbortSignal;
}

export interface ScheduledCounts {
  stops: number;
  routes: number;
  trips: number;
  shapes: number;
  agencies: number;
  services: number;
  stopTimes: number;
}

/** A CSV column that carried leading/trailing whitespace, and how many rows had it. */
export interface PaddedColumn {
  file: string;
  column: string;
  rows: number;
}

/**
 * Every value trimmed, and a note of which columns needed it.
 *
 * The GTFS reference forbids leading and trailing spaces in field values, but
 * producers that right-align numeric columns are common — RIPTA stores stop_id
 * as "      5" in stops.txt and "  29570" in stop_times.txt. The padding is
 * self-consistent within the scheduled feed, so schedule-internal joins work and the
 * damage is invisible until a realtime id is looked up against it: the realtime
 * feed sends "29570" and nothing matches.
 *
 * Trimming here — the one choke point every scheduled file passes through — covers
 * present and future id columns without each ingest site having to remember.
 * Headers are trimmed too, so a padded header cannot produce a column name no
 * ingest function recognises. Only leading/trailing whitespace is stripped:
 * interior spaces ("Westerly Town Hall") and empty strings ('' is meaningful
 * here) are preserved. `padded` counts rows, not distinct values.
 */
function parseCSV(text: string): { rows: RawRow[]; padded: Map<string, number> } {
  const rows = Papa.parse<RawRow>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: h => h.trim(),
  }).data;

  const padded = new Map<string, number>();
  for (const row of rows) {
    for (const key in row) {
      const value = row[key];
      if (typeof value !== 'string') continue;
      const trimmed = value.trim();
      if (trimmed !== value) {
        row[key] = trimmed;
        padded.set(key, (padded.get(key) ?? 0) + 1);
      }
    }
  }
  return { rows, padded };
}

const DAY_FIELDS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

/** Files parsed in order, for per-file progress reporting. */
const PARSE_ORDER = [
  'agency.txt',
  'feed_info.txt',
  'calendar.txt',
  'calendar_dates.txt',
  'stops.txt',
  'routes.txt',
  'shapes.txt',
  'trips.txt',
  'stop_times.txt',
] as const;

export class GTFSScheduled {
  stops = new Map<string, Stop>();
  routes = new Map<string, Route>();
  shapes = new Map<string, [number, number][]>();
  trips = new Map<string, Trip>();
  agencies: Agency[] = [];
  feedInfo: FeedInfo[] = [];
  calendar: Calendar[] = [];
  calendarDates: CalendarDate[] = [];

  /** Trip stop_times, sorted by `stop_sequence`. Drives the route strip. */
  stopTimesByTrip = new Map<string, StopTime[]>();
  tripsByRoute = new Map<string, Trip[]>();
  /** Derived from stop_times to trips: which routes serve a stop. */
  routesByStop = new Map<string, Set<string>>();
  /** Trip ids serving a stop, in first-seen order. */
  stopTrips = new Map<string, string[]>();

  /** Direct children of each stop, keyed by parent `stop_id`. */
  childrenByParent = new Map<string, string[]>();
  /**
   * Malformed `parent_station` references, surfaced on the status page rather
   * than thrown. A station page aggregates over its children, so a feed that
   * mis-wires the hierarchy is worth reporting.
   */
  stationIssues = { danglingParent: 0, nonStationParent: 0, cyclicStops: 0 };

  /**
   * CSV columns that arrived with leading/trailing whitespace and were trimmed
   * at parse time. Surfaced on the status page rather than absorbed silently:
   * without the trim, no realtime id would match a padded scheduled column (see
   * `parseCSV`).
   */
  paddedColumns: PaddedColumn[] = [];

  private stopTimeCount = 0;

  async loadFromFile(file: File, hooks: LoadHooks = {}): Promise<void> {
    const zip = await JSZip.loadAsync(file);
    await this.parse(zip, hooks);
  }

  /**
   * A URL may name an archive inside the archive — `…/outer.zip#inner.zip` —
   * for the agencies that publish several datasets in one download. The
   * fragment is split off here rather than anywhere upstream, so the CORS proxy
   * concatenation in `maybeProxy` never has to know about it and `fetch` never
   * sees it.
   */
  async loadFromUrl(url: string, hooks: LoadHooks = {}): Promise<void> {
    const { url: fetchUrl, innerPaths } = splitInnerZipPath(url);
    const blob = await downloadWithProgress(fetchUrl, {
      onProgress: hooks.onDownload,
      signal: hooks.signal,
    });
    let zip = await JSZip.loadAsync(blob);
    for (const inner of innerPaths) {
      zip = await openInnerZip(zip, inner);
    }
    await this.parse(zip, hooks);
  }

  counts(): ScheduledCounts {
    return {
      stops: this.stops.size,
      routes: this.routes.size,
      trips: this.trips.size,
      shapes: this.shapes.size,
      agencies: this.agencies.length,
      services: this.calendar.length,
      stopTimes: this.stopTimeCount,
    };
  }

  private async parse(zip: JSZip, hooks: LoadHooks): Promise<void> {
    const handlers: Record<string, (rows: RawRow[]) => void> = {
      'agency.txt': rows => this.ingestAgencies(rows),
      'feed_info.txt': rows => this.ingestFeedInfo(rows),
      'calendar.txt': rows => this.ingestCalendar(rows),
      'calendar_dates.txt': rows => this.ingestCalendarDates(rows),
      'stops.txt': rows => this.ingestStops(rows),
      'routes.txt': rows => this.ingestRoutes(rows),
      'shapes.txt': rows => this.ingestShapes(rows),
      'trips.txt': rows => this.ingestTrips(rows),
      'stop_times.txt': rows => this.ingestStopTimes(rows),
    };

    // Sequential rather than Promise.all: parsing is CPU-bound anyway, and
    // serial order is what makes per-file progress meaningful. It also lets
    // stop_times.txt rely on trips.txt already being indexed.
    let done = 0;
    for (const name of PARSE_ORDER) {
      hooks.onParse?.(name, done, PARSE_ORDER.length);
      const file = zip.file(name);
      if (file) {
        const { rows, padded } = parseCSV(await file.async('text'));
        for (const [column, count] of padded) {
          this.paddedColumns.push({ file: name, column, rows: count });
        }
        handlers[name](rows);
      }
      done++;
      hooks.onParse?.(name, done, PARSE_ORDER.length);
    }

    this.buildStationIndex();
  }

  /**
   * Index the station hierarchy and count malformed `parent_station` links.
   *
   * Spec: a platform / entrance / generic node (`location_type` 0 / 2 / 3) has a
   * station (type 1) parent; a boarding area (type 4) has a platform (type 0)
   * parent. Anything else is a feed defect — counted, not thrown.
   */
  private buildStationIndex(): void {
    const expectedParentType: Record<number, number> = { 0: 1, 2: 1, 3: 1, 4: 0 };
    for (const stop of this.stops.values()) {
      const parentId = stop.parent_station;
      if (!parentId) continue;
      const parent = this.stops.get(parentId);
      if (!parent) {
        this.stationIssues.danglingParent++;
        continue;
      }
      const expected = expectedParentType[stop.location_type];
      if (expected !== undefined && parent.location_type !== expected) {
        this.stationIssues.nonStationParent++;
      }
      let children = this.childrenByParent.get(parentId);
      if (!children) this.childrenByParent.set(parentId, (children = []));
      children.push(stop.id);
    }

    // A parent_station cycle would hang descendants(); count the stops caught
    // in one so the traversal's visited-guard is a reported fact, not a silent
    // save.
    for (const stop of this.stops.values()) {
      const seen = new Set<string>([stop.id]);
      let current: string | undefined = stop.parent_station;
      while (current && this.stops.has(current)) {
        if (seen.has(current)) {
          this.stationIssues.cyclicStops++;
          break;
        }
        seen.add(current);
        current = this.stops.get(current)?.parent_station;
      }
    }
  }

  /** Walk `parent_station` to the topmost ancestor, guarding against cycles. */
  stationRoot(stopId: string): string {
    const seen = new Set<string>([stopId]);
    let current = stopId;
    for (;;) {
      const parent = this.stops.get(current)?.parent_station;
      if (!parent || !this.stops.has(parent) || seen.has(parent)) return current;
      seen.add(parent);
      current = parent;
    }
  }

  /** Every stop beneath `stopId` in the hierarchy, recursive, cycle-guarded. */
  descendants(stopId: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>([stopId]);
    const stack = [...(this.childrenByParent.get(stopId) ?? [])];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      for (const child of this.childrenByParent.get(id) ?? []) {
        if (!seen.has(child)) stack.push(child);
      }
    }
    return out;
  }

  /** Boardable descendants only (`location_type` 0) — the service-bearing ones. */
  boardableDescendants(stopId: string): string[] {
    return this.descendants(stopId).filter(id => this.stops.get(id)?.location_type === 0);
  }

  /** The stop's own position, or the nearest ancestor's with valid coordinates. */
  resolvedPosition(stopId: string): [number, number] | null {
    const seen = new Set<string>();
    let current: string | undefined = stopId;
    while (current && !seen.has(current)) {
      seen.add(current);
      const stop = this.stops.get(current);
      if (!stop) return null;
      if (Number.isFinite(stop.lat) && Number.isFinite(stop.lon)) return [stop.lon, stop.lat];
      current = stop.parent_station;
    }
    return null;
  }

  private ingestAgencies(rows: RawRow[]): void {
    this.agencies = rows.map(row => ({
      id: row.agency_id ?? '',
      name: row.agency_name ?? '',
      url: row.agency_url ?? '',
      timezone: row.agency_timezone ?? '',
      raw: row,
    }));
  }

  private ingestFeedInfo(rows: RawRow[]): void {
    this.feedInfo = rows.map(row => ({
      publisher_name: row.feed_publisher_name ?? '',
      publisher_url: row.feed_publisher_url ?? '',
      lang: row.feed_lang ?? '',
      version: row.feed_version ?? '',
      raw: row,
    }));
  }

  private ingestCalendar(rows: RawRow[]): void {
    this.calendar = rows.map(row => ({
      service_id: row.service_id,
      start_date: row.start_date ?? '',
      end_date: row.end_date ?? '',
      days: DAY_FIELDS.map(d => row[d] === '1'),
      raw: row,
    }));
  }

  private ingestCalendarDates(rows: RawRow[]): void {
    this.calendarDates = rows.map(row => ({
      service_id: row.service_id,
      date: row.date ?? '',
      exception_type: parseInt(row.exception_type ?? '1'),
      raw: row,
    }));
  }

  private ingestStops(rows: RawRow[]): void {
    for (const row of rows) {
      this.stops.set(row.stop_id, {
        id: row.stop_id,
        name: row.stop_name ?? '',
        lat: parseFloat(row.stop_lat),
        lon: parseFloat(row.stop_lon),
        location_type: parseInt(row.location_type || '0'),
        parent_station: row.parent_station ?? '',
        raw: row,
      });
    }
  }

  private ingestRoutes(rows: RawRow[]): void {
    for (const row of rows) {
      // A feed that omits route_color gets a hue hashed from its route_id, so
      // colorless routes are still told apart on the map instead of all
      // rendering in one flat house color. See utils/route-colors.ts.
      const color = routeColor(row.route_id, row.route_color);
      this.routes.set(row.route_id, {
        id: row.route_id,
        short_name: row.route_short_name ?? '',
        long_name: row.route_long_name ?? '',
        color,
        text_color: routeTextColor(color, row.route_text_color),
        type: parseInt(row.route_type ?? '3'),
        agency_id: row.agency_id ?? '',
        raw: row,
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
      const trip: Trip = {
        trip_id: row.trip_id,
        route_id: row.route_id,
        service_id: row.service_id ?? '',
        shape_id: row.shape_id ?? '',
        headsign: row.trip_headsign ?? '',
        direction_id: row.direction_id ?? '',
        raw: row,
      };
      this.trips.set(trip.trip_id, trip);

      let forRoute = this.tripsByRoute.get(trip.route_id);
      if (!forRoute) this.tripsByRoute.set(trip.route_id, (forRoute = []));
      forRoute.push(trip);
    }
  }

  private ingestStopTimes(rows: RawRow[]): void {
    for (const row of rows) {
      const { stop_id, trip_id } = row;

      // `stop_sequence` is a string in the CSV and must be compared
      // numerically — '10' < '9' lexically, which would scramble every trip.
      const stopTime: StopTime = {
        trip_id,
        stop_id,
        stop_sequence: parseInt(row.stop_sequence ?? '0'),
        arrival_time: row.arrival_time ?? '',
        departure_time: row.departure_time ?? '',
      };

      let forTrip = this.stopTimesByTrip.get(trip_id);
      if (!forTrip) this.stopTimesByTrip.set(trip_id, (forTrip = []));
      forTrip.push(stopTime);

      let trips = this.stopTrips.get(stop_id);
      if (!trips) this.stopTrips.set(stop_id, (trips = []));
      // Rows for one trip arrive contiguously in every feed worth reading, so
      // checking the tail is enough to dedupe without an O(n) scan per row.
      if (trips[trips.length - 1] !== trip_id) trips.push(trip_id);

      const routeId = this.trips.get(trip_id)?.route_id;
      if (routeId) {
        let routes = this.routesByStop.get(stop_id);
        if (!routes) this.routesByStop.set(stop_id, (routes = new Set()));
        routes.add(routeId);
      }
    }

    this.stopTimeCount = rows.length;
    for (const times of this.stopTimesByTrip.values()) {
      times.sort((a, b) => a.stop_sequence - b.stop_sequence);
    }
  }
}

/**
 * Open one archive nested inside another.
 *
 * Reports rather than absorbs: a mistyped inner name would otherwise surface
 * much later as an empty feed ("0 stops, 0 routes"), which reads as the
 * agency's fault. Naming what the outer archive actually holds turns that into
 * a one-line fix.
 */
async function openInnerZip(zip: JSZip, innerPath: string): Promise<JSZip> {
  const entry = zip.file(innerPath);
  if (!entry) {
    const zips = Object.keys(zip.files).filter(n => n.toLowerCase().endsWith('.zip'));
    const found = zips.length ? zips.join(', ') : 'no nested archives at all';
    throw new Error(`The archive has no entry "${innerPath}" — it contains ${found}.`);
  }
  return JSZip.loadAsync(await entry.async('arraybuffer'));
}

