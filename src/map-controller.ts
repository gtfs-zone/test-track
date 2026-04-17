import maplibregl from 'maplibre-gl';
import type { GTFSStatic } from './gtfs-static';

export interface VehiclePosition {
  id: string;
  lat: number;
  lon: number;
  bearing?: number;
  tripId?: string;
  routeId?: string;
}

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

export class MapController {
  private map!: maplibregl.Map;
  private stopClickCallback: ((stopId: string) => void) | null = null;

  initialize(container: string): void {
    this.map = new maplibregl.Map({
      container,
      style: STYLE_URL,
      center: [0, 30],
      zoom: 2,
    });
    this.map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
    this.map.once('load', () => this.onMapLoad());
  }

  private onMapLoad(): void {
    this.addVehicleArrowImage();

    this.map.on('click', 'stops-layer', e => {
      const stopId = e.features?.[0]?.properties?.stop_id as string | undefined;
      if (stopId) this.stopClickCallback?.(stopId);
    });
    this.map.on('mouseenter', 'stops-layer', () => {
      this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mouseleave', 'stops-layer', () => {
      this.map.getCanvas().style.cursor = '';
    });
  }

  private addVehicleArrowImage(): void {
    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    // Arrow pointing north (up), rotated per bearing at render time
    ctx.fillStyle = '#4af';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(size / 2, 2);
    ctx.lineTo(size - 5, size - 5);
    ctx.lineTo(size / 2, size - 9);
    ctx.lineTo(5, size - 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    this.map.addImage('vehicle-arrow', ctx.getImageData(0, 0, size, size));
  }

  private whenLoaded(fn: () => void): void {
    if (this.map.loaded()) {
      fn();
    } else {
      this.map.once('load', fn);
    }
  }

  loadStaticFeed(feed: GTFSStatic): void {
    this.whenLoaded(() => this.applyStaticFeed(feed));
  }

  private applyStaticFeed(feed: GTFSStatic): void {
    this.clearStaticFeed();

    // Build a shape_id → route color lookup from trips
    const shapeColor = new Map<string, string>();
    for (const trip of feed.trips.values()) {
      if (!shapeColor.has(trip.shape_id)) {
        const route = feed.routes.get(trip.route_id);
        shapeColor.set(trip.shape_id, route?.color ?? '#0066ff');
      }
    }

    const shapeFeatures = Array.from(feed.shapes.entries()).map(([shapeId, coords]) => ({
      type: 'Feature' as const,
      geometry: { type: 'LineString' as const, coordinates: coords },
      properties: { shape_id: shapeId, color: shapeColor.get(shapeId) ?? '#0066ff' },
    }));

    const stopFeatures = Array.from(feed.stops.values()).map(stop => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [stop.lon, stop.lat] },
      properties: { stop_id: stop.id, stop_name: stop.name },
    }));

    this.map.addSource('shapes', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: shapeFeatures },
    });
    this.map.addSource('stops', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: stopFeatures },
    });

    this.map.addLayer({
      id: 'shapes-layer',
      type: 'line',
      source: 'shapes',
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 2,
        'line-opacity': 0.8,
      },
    });

    this.map.addLayer({
      id: 'stops-layer',
      type: 'circle',
      source: 'stops',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 7],
        'circle-color': '#fff',
        'circle-stroke-color': '#0066ff',
        'circle-stroke-width': 2,
      },
    });

    if (stopFeatures.length > 0) {
      const lons = stopFeatures.map(f => f.geometry.coordinates[0]);
      const lats = stopFeatures.map(f => f.geometry.coordinates[1]);
      this.map.fitBounds(
        [
          [Math.min(...lons), Math.min(...lats)],
          [Math.max(...lons), Math.max(...lats)],
        ],
        { padding: 40 }
      );
    }
  }

  onStopClick(callback: (stopId: string) => void): void {
    this.stopClickCallback = callback;
  }

  showVehicles(positions: VehiclePosition[]): void {
    const data = {
      type: 'FeatureCollection' as const,
      features: positions.map(v => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [v.lon, v.lat] },
        properties: {
          id: v.id,
          bearing: v.bearing ?? 0,
          tripId: v.tripId ?? '',
          routeId: v.routeId ?? '',
        },
      })),
    };

    const source = this.map.getSource('vehicles') as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(data);
    } else {
      this.map.addSource('vehicles', { type: 'geojson', data });
      this.map.addLayer({
        id: 'vehicles-layer',
        type: 'symbol',
        source: 'vehicles',
        layout: {
          'icon-image': 'vehicle-arrow',
          'icon-size': 0.8,
          'icon-rotate': ['get', 'bearing'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
        },
      });
    }
  }

  clearVehicles(): void {
    if (this.map.getLayer('vehicles-layer')) this.map.removeLayer('vehicles-layer');
    if (this.map.getSource('vehicles')) this.map.removeSource('vehicles');
  }

  clearStaticFeed(): void {
    if (this.map.getLayer('stops-layer')) this.map.removeLayer('stops-layer');
    if (this.map.getLayer('shapes-layer')) this.map.removeLayer('shapes-layer');
    if (this.map.getSource('stops')) this.map.removeSource('stops');
    if (this.map.getSource('shapes')) this.map.removeSource('shapes');
  }
}
