/* @vendored-from coloring-book:src/modules/route-sort.ts
   @sha b19718e
   @status verbatim */
/**
 * Paint-order ranking for route lines.
 *
 * All routes live in one GeoJSON source, so which line covers which is decided
 * entirely by `line-sort-key` (higher = painted later = on top). The key blends
 * two things: the route's mode, which always wins, and its trip count, which
 * breaks ties within a mode so a trunk service sits above an hourly one.
 *
 * Pure and dependency-free so it can be vendored as-is.
 */

/** Rank for an unknown or unparseable route_type, below every real mode. */
const RANK_UNKNOWN = 10;

/** Base GTFS route_type to paint rank. Higher paints on top. */
const RANK_BY_TYPE: Record<number, number> = {
  1: 90, // subway / metro
  12: 85, // monorail
  0: 80, // tram / streetcar / light rail
  7: 75, // funicular
  6: 75, // aerial lift
  5: 75, // cable tram
  2: 70, // rail
  4: 60, // ferry
  11: 50, // trolleybus
  3: 40, // bus
};

/**
 * Extended route types (100–1799) collapse onto a base type by their hundreds
 * bucket. 1100 (air) and 1700 (misc) have no sensible base equivalent and fall
 * through to RANK_UNKNOWN.
 */
const BASE_TYPE_BY_HUNDREDS: Record<number, number> = {
  1: 2, // railway service
  2: 3, // coach service
  4: 1, // urban railway service
  7: 3, // bus service
  8: 11, // trolleybus service
  9: 0, // tram service
  10: 4, // water transport service
  12: 4, // ferry service
  13: 6, // aerial lift service
  14: 7, // funicular service
  15: 3, // taxi service
};

/**
 * Map a GTFS route_type to its paint rank. Accepts `unknown` because
 * coloring-book's `Routes` is a loose record, route_type may arrive as a
 * string straight from the CSV.
 */
export function routeTypeRank(rawRouteType: unknown): number {
  const routeType = Number(rawRouteType);
  if (!Number.isFinite(routeType)) {
    console.warn(
      `[routeSort] Non-numeric route_type ${JSON.stringify(rawRouteType)}, ranking as unknown`
    );
    return RANK_UNKNOWN;
  }

  const direct = RANK_BY_TYPE[routeType];
  if (direct !== undefined) {
    return direct;
  }

  if (routeType >= 100 && routeType < 1800) {
    const baseType = BASE_TYPE_BY_HUNDREDS[Math.floor(routeType / 100)];
    if (baseType !== undefined) {
      return RANK_BY_TYPE[baseType];
    }
  }

  console.warn(
    `[routeSort] Unrecognized route_type ${routeType}, ranking as unknown`
  );
  return RANK_UNKNOWN;
}

/**
 * The `line-sort-key` for a route: mode rank in the thousands place, log-scaled
 * trip count in the low three digits. Log scaling keeps a 5000-trip subway from
 * swamping a 400-trip one, the ordering only has to be stable and sensible,
 * not proportional.
 */
export function routeSortKey(rawRouteType: unknown, tripCount: number): number {
  const frequency = Math.min(
    999,
    Math.round(100 * Math.log10(1 + Math.max(0, tripCount)))
  );
  return routeTypeRank(rawRouteType) * 1000 + frequency;
}
