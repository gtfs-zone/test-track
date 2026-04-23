import { transit_realtime } from 'gtfs-realtime-bindings';
import type { VehiclePosition } from './map-controller';

export type TripUpdate = transit_realtime.ITripUpdate;
export type ServiceAlert = transit_realtime.IAlert;

export class GTFSRealtime extends EventTarget {
  private vehicleUrl: string;
  private tripUpdatesUrl: string;
  private alertsUrl: string;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(vehicleUrl: string, tripUpdatesUrl: string, alertsUrl: string) {
    super();
    this.vehicleUrl = vehicleUrl;
    this.tripUpdatesUrl = tripUpdatesUrl;
    this.alertsUrl = alertsUrl;
  }

  start(intervalMs = 15000): void {
    this.poll();
    this.intervalId = setInterval(() => this.poll(), intervalMs);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async poll(): Promise<void> {
    await Promise.allSettled([
      this.vehicleUrl ? this.fetchVehicles() : Promise.resolve(),
      this.tripUpdatesUrl ? this.fetchTripUpdates() : Promise.resolve(),
      this.alertsUrl ? this.fetchAlerts() : Promise.resolve(),
    ]);
  }

  private async decodeFeed(url: string): Promise<transit_realtime.FeedMessage | null> {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();
      return transit_realtime.FeedMessage.decode(new Uint8Array(buf));
    } catch {
      return null;
    }
  }

  private async fetchVehicles(): Promise<void> {
    const feed = await this.decodeFeed(this.vehicleUrl);
    if (!feed) return;
    const positions: VehiclePosition[] = [];
    for (const entity of feed.entity) {
      const v = entity.vehicle;
      if (!v?.position) continue;
      positions.push({
        id: entity.id,
        lat: v.position.latitude,
        lon: v.position.longitude,
        bearing: v.position.bearing ?? undefined,
        tripId: v.trip?.tripId ?? undefined,
        routeId: v.trip?.routeId ?? undefined,
      });
    }
    this.dispatchEvent(new CustomEvent<VehiclePosition[]>('vehicles', { detail: positions }));
  }

  private async fetchTripUpdates(): Promise<void> {
    const feed = await this.decodeFeed(this.tripUpdatesUrl);
    if (!feed) return;
    const updates = feed.entity.flatMap(e => (e.tripUpdate ? [e.tripUpdate] : []));
    this.dispatchEvent(new CustomEvent<TripUpdate[]>('tripUpdates', { detail: updates }));
  }

  private async fetchAlerts(): Promise<void> {
    const feed = await this.decodeFeed(this.alertsUrl);
    if (!feed) return;
    const alerts = feed.entity.flatMap(e => (e.alert ? [e.alert] : []));
    this.dispatchEvent(new CustomEvent<ServiceAlert[]>('alerts', { detail: alerts }));
  }
}
