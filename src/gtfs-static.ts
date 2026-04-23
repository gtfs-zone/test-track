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

function parseCSV(text: string): Record<string, string>[] {
  return Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  }).data;
}

export class GTFSStatic {
  stops = new Map<string, Stop>();
  routes = new Map<string, Route>();
  shapes = new Map<string, [number, number][]>();
  trips = new Map<string, Trip>();
  stopTrips = new Map<string, string[]>();

  async loadFromFile(file: File): Promise<void> {
    const zip = await JSZip.loadAsync(file);
    await this.parse(zip);
  }

  async loadFromUrl(url: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch GTFS: ${response.status}`);
    const buffer = await response.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);
    await this.parse(zip);
  }

  private async parse(zip: JSZip): Promise<void> {
    await Promise.all([
      this.parseStops(zip),
      this.parseRoutes(zip),
      this.parseShapes(zip),
      this.parseTrips(zip),
    ]);
    await this.parseStopTimes(zip);
  }

  private async parseStops(zip: JSZip): Promise<void> {
    const file = zip.file('stops.txt');
    if (!file) return;
    for (const row of parseCSV(await file.async('text'))) {
      this.stops.set(row.stop_id, {
        id: row.stop_id,
        name: row.stop_name,
        lat: parseFloat(row.stop_lat),
        lon: parseFloat(row.stop_lon),
      });
    }
  }

  private async parseRoutes(zip: JSZip): Promise<void> {
    const file = zip.file('routes.txt');
    if (!file) return;
    for (const row of parseCSV(await file.async('text'))) {
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

  private async parseShapes(zip: JSZip): Promise<void> {
    const file = zip.file('shapes.txt');
    if (!file) return;
    const temp = new Map<string, { seq: number; lon: number; lat: number }[]>();
    for (const row of parseCSV(await file.async('text'))) {
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

  private async parseTrips(zip: JSZip): Promise<void> {
    const file = zip.file('trips.txt');
    if (!file) return;
    for (const row of parseCSV(await file.async('text'))) {
      this.trips.set(row.trip_id, {
        trip_id: row.trip_id,
        route_id: row.route_id,
        shape_id: row.shape_id ?? '',
        headsign: row.trip_headsign ?? '',
      });
    }
  }

  private async parseStopTimes(zip: JSZip): Promise<void> {
    const file = zip.file('stop_times.txt');
    if (!file) return;
    for (const row of parseCSV(await file.async('text'))) {
      const { stop_id, trip_id } = row;
      if (!this.stopTrips.has(stop_id)) this.stopTrips.set(stop_id, []);
      const trips = this.stopTrips.get(stop_id)!;
      if (!trips.includes(trip_id)) trips.push(trip_id);
    }
  }
}
