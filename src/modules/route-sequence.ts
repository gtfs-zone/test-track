/* @vendored-from coloring-book:src/modules/route-sequence.ts
   @sha 9f1f986
   @status verbatim */
/**
 * The canonical stop order for one direction of one route, plus the mapping
 * that puts any individual trip back onto it.
 *
 * A route is served by many trips whose stop lists disagree — short turns,
 * express runs, seasonal deviations. The strip needs one ordered list that
 * contains all of them.
 *
 * The order comes from a topological sort of the stop precedence graph: every
 * pattern asserts "A before B" for each consecutive pair, and any topological
 * order of those assertions contains every pattern as a subsequence, with each
 * stop appearing exactly once. The obvious alternative — folding the vendored
 * pairwise shortest-common-supersequence DP over the patterns — cannot promise
 * that, and on a real feed it does not deliver it: across the MBTA's 730
 * route/directions the fold emits duplicate stops on 14 of them, worst on the
 * Framingham/Worcester line, where six stations appear twice with the entire
 * route between the copies.
 *
 * The fold is still here, for the routes the sort cannot handle. A direction
 * whose patterns run opposite ways is a genuine cycle — the Winthrop ferry is
 * one — so no topological order exists and Kahn's algorithm stalls. Those
 * routes fall back to the fold, one route at a time and never globally; across
 * the same feed that is 5 of the 730.
 *
 * Every pattern is included, however few trips it carries. A route's rare
 * patterns are not noise — on Amtrak's Northeast Regional they are the trains
 * continuing past Washington to Norfolk, a real part of the route. Capping
 * them dropped both those stops and the ability to place any vehicle running
 * them. On the fallback path the cost of admitting them is kept down by
 * folding only patterns that actually add stops: one containment walk rejects
 * the rest in linear time.
 */

import type { RouteSource, RouteSourceTrip } from './route-source.js';
import { shortestCommonSupersequence } from './scs.js';

/** A stop id together with which visit it is, within a single trip. */
export interface StripStop {
  stop_id: string;
  /** 0 for the first visit; >0 only on loop routes. */
  occurrence: number;
}

/**
 * What the trips of a route do at one position on the strip.
 *
 * Endpoints have to be counted per pattern rather than read off the graph:
 * Northeast Regional trains continue past Washington to Norfolk, so Washington
 * has outgoing edges and looks like an ordinary through stop, when in fact it
 * is where most of the route's trips end.
 */
export interface StopStats {
  /** Trips whose first stop this is. */
  startsHere: number;
  /** Trips whose last stop this is. */
  endsHere: number;
  /** Trips calling here at all. */
  serves: number;
}

export interface RoutePattern {
  /** Stable key: the de-looped element sequence, joined. */
  key: string;
  stops: StripStop[];
  trip_ids: string[];
  /** Index into the array handed to the ordering, or null when dropped. */
  scsIndex: number | null;
}

export interface RouteSequence {
  route_id: string;
  direction_id: string;
  /** The supersequence: every stop of every pattern, in order. */
  stops: StripStop[];
  /** Parallel to `stops`. */
  stopStats: StopStats[];
  /** Per pattern, in `scsIndex` order: the strip positions it occupies. */
  patternPositions: number[][];
  patterns: RoutePattern[];
  patternForTrip: Map<string, RoutePattern>;
  totalPatterns: number;
  totalTrips: number;
  /** True when some trip visits the same stop twice. */
  isLoop: boolean;
  /**
   * Position on the strip for the `stopIndex`-th stop of `tripId`'s own stop
   * list, or null when the trip's pattern was dropped.
   */
  positionOf(tripId: string, stopIndex: number): number | null;
}

export interface DirectionInfo {
  direction_id: string;
  label: string;
  tripCount: number;
}

/** `stop_id` plus visit index, so a loop's second visit is its own element. */
function elementKey(stop: StripStop): string {
  return `${stop.stop_id} ${stop.occurrence}`;
}

/**
 * A trip's stops as strip elements, with the map back to its own `stop_times`
 * indices.
 *
 * Platform stop_ids collapse to their station: MBTA models JFK/UMass as four
 * stop_ids under `place-jfk`, one per branch and direction, so without
 * collapsing the Red Line junction renders as several adjacent rows all
 * labelled "JFK/UMass" and the branch never reads as a branch. Collapsing
 * before the occurrence counter runs is what keeps two consecutive platform
 * visits at one station from looking like a revisit.
 *
 * `stopTimesForTrip` is already sorted by `stop_sequence` (route-source), so
 * this is a straight walk. `indexOfStop[i]` is the element the trip's i-th
 * stop time lands on — the identity unless a collapse merged something.
 */
function tripStops(
  source: RouteSource,
  tripId: string
): { elements: StripStop[]; indexOfStop: number[] } {
  const times = source.stopTimesForTrip(tripId);
  if (times.length === 0) {
    return { elements: [], indexOfStop: [] };
  }

  const elements: StripStop[] = [];
  const indexOfStop: number[] = [];
  const seen = new Map<string, number>();
  for (const time of times) {
    const stop_id = source.stationRoot(time.stop_id);
    const last = elements[elements.length - 1];
    if (last && last.stop_id === stop_id) {
      indexOfStop.push(elements.length - 1);
      continue;
    }
    const occurrence = seen.get(stop_id) ?? 0;
    seen.set(stop_id, occurrence + 1);
    indexOfStop.push(elements.length);
    elements.push({ stop_id, occurrence });
  }
  return { elements, indexOfStop };
}

/**
 * Leftmost embedding of each input into the supersequence.
 *
 * Every input is a subsequence of the result by construction, and greedy
 * leftmost matching always finds an embedding when one exists, so each walk
 * consumes its whole input.
 *
 * Returns one `inputPosition -> supersequencePosition` map per sequence rather
 * than the flat alignment list `SCSResultHelper` wants: with every pattern of a
 * route included, re-filtering one shared list per pattern is quadratic in the
 * pattern count for no gain.
 */
function alignToSupersequence(
  sequences: string[][],
  supersequence: string[]
): Array<Map<number, number>> {
  return sequences.map((seq) => {
    const mapping = new Map<number, number>();
    let inputPosition = 0;
    for (
      let sup = 0;
      sup < supersequence.length && inputPosition < seq.length;
      sup++
    ) {
      if (seq[inputPosition] === supersequence[sup]) {
        mapping.set(inputPosition++, sup);
      }
    }
    return mapping;
  });
}

/**
 * Whether `seq` already embeds in `supersequence`, by the same greedy leftmost
 * walk the alignment uses. Contained patterns cannot change a fold's result, so
 * this rejects them for the cost of one linear scan instead of the DP's O(n·m)
 * — which is what makes folding every pattern of a route affordable.
 */
function isSubsequence(seq: string[], supersequence: string[]): boolean {
  let i = 0;
  for (let j = 0; j < supersequence.length && i < seq.length; j++) {
    if (seq[i] === supersequence[j]) {
      i++;
    }
  }
  return i === seq.length;
}

/** Fold pairwise, largest pattern first — see the module comment. */
function foldSupersequence(sequences: string[][]): string[] {
  let acc: string[] = [];
  for (const seq of sequences) {
    if (!isSubsequence(seq, acc)) {
      acc = shortestCommonSupersequence([acc, seq]);
    }
  }
  return acc;
}

/**
 * A topological order of the stop precedence graph, or nothing when the route
 * is cyclic.
 *
 * Kahn's algorithm over the edges every pattern asserts between its consecutive
 * stops. Nothing here is weighted except the tie-break: whenever several stops
 * are ready at once, no pattern orders them against each other, so they are
 * emitted by mean position within the patterns that contain them, weighted by
 * trips so one seasonal run cannot drag a stop away from where the timetable
 * puts it. Without that, ready stops would come out in whatever order the
 * pattern list happened to build them, and a branch would interleave wrongly.
 *
 * A stall means a cycle, which on a real feed means a direction whose patterns
 * run opposite ways. There is no correct linear order for those, so the caller
 * falls back to the fold rather than this function breaking an edge and
 * silently claiming one.
 */
function topoOrder(
  sequences: string[][],
  weights: number[]
): { order: string[]; cyclic: boolean } {
  const outgoing = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();
  const positionSum = new Map<string, number>();
  const positionWeight = new Map<string, number>();

  sequences.forEach((seq, i) => {
    const weight = weights[i] ?? 1;
    const span = seq.length - 1;
    seq.forEach((key, j) => {
      if (!outgoing.has(key)) {
        outgoing.set(key, new Set());
        indegree.set(key, 0);
        positionSum.set(key, 0);
        positionWeight.set(key, 0);
      }
      positionSum.set(
        key,
        positionSum.get(key)! + (span > 0 ? j / span : 0) * weight
      );
      positionWeight.set(key, positionWeight.get(key)! + weight);
    });

    for (let j = 0; j + 1 < seq.length; j++) {
      const edges = outgoing.get(seq[j])!;
      if (edges.has(seq[j + 1])) {
        continue;
      }
      edges.add(seq[j + 1]);
      indegree.set(seq[j + 1], indegree.get(seq[j + 1])! + 1);
    }
  });

  const meanPosition = (key: string): number => {
    const weight = positionWeight.get(key)!;
    return weight > 0 ? positionSum.get(key)! / weight : 0;
  };

  const ready: string[] = [];
  for (const [key, degree] of indegree) {
    if (degree === 0) {
      ready.push(key);
    }
  }

  const order: string[] = [];
  let previous: string | null = null;
  while (ready.length > 0) {
    // Among stops nothing orders against each other, first prefer one the
    // previous stop leads directly to. Mean position alone interleaves a
    // branch: the Red Line's Ashmont and Braintree legs span the same
    // fraction of their patterns, so their stops alternate down the strip
    // instead of running as two legs. Following the edge we just used keeps
    // each leg contiguous, and ties within a leg still fall through to
    // position.
    const continues = previous ? outgoing.get(previous) : undefined;
    let pick = 0;
    for (let i = 1; i < ready.length; i++) {
      const candidateFollows = continues?.has(ready[i]) ?? false;
      const bestFollows = continues?.has(ready[pick]) ?? false;
      if (candidateFollows !== bestFollows) {
        if (candidateFollows) {
          pick = i;
        }
        continue;
      }
      const candidate = meanPosition(ready[i]);
      const best = meanPosition(ready[pick]);
      // The key compare is only there to make the output deterministic.
      if (candidate < best || (candidate === best && ready[i] < ready[pick])) {
        pick = i;
      }
    }
    const key = ready[pick];
    previous = key;
    ready[pick] = ready[ready.length - 1];
    ready.pop();
    order.push(key);

    for (const next of outgoing.get(key)!) {
      const remaining = indegree.get(next)! - 1;
      indegree.set(next, remaining);
      if (remaining === 0) {
        ready.push(next);
      }
    }
  }

  return order.length === indegree.size
    ? { order, cyclic: false }
    : { order: [], cyclic: true };
}

function parseElement(key: string): StripStop {
  const sep = key.lastIndexOf(' ');
  return {
    stop_id: key.slice(0, sep),
    occurrence: Number(key.slice(sep + 1)),
  };
}

/**
 * The dominant `trip_headsign` for a direction, which is what riders and
 * timetables call it. Falls back to the terminal stop, then the bare id.
 */
function directionLabel(
  source: RouteSource,
  trips: RouteSourceTrip[],
  directionId: string
): string {
  const counts = new Map<string, number>();
  for (const trip of trips) {
    if (!trip.headsign) {
      continue;
    }
    counts.set(trip.headsign, (counts.get(trip.headsign) ?? 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [headsign, count] of counts) {
    if (count > bestCount) {
      best = headsign;
      bestCount = count;
    }
  }
  if (best) {
    return best;
  }

  const firstTripStops = trips.length
    ? tripStops(source, trips[0].trip_id).elements
    : [];
  const terminal = firstTripStops[firstTripStops.length - 1];
  const terminalName = terminal ? source.stopName(terminal.stop_id) : undefined;
  if (terminalName) {
    return terminalName;
  }

  return directionId ? `Direction ${directionId}` : 'All trips';
}

/**
 * Every direction the route's trips declare, busiest first.
 *
 * Feeds that omit `direction_id` entirely collapse to a single unnamed
 * direction rather than being forced into a 0/1 split that the data does not
 * support.
 *
 * `serviceId` scopes trip counts and labels to one calendar service; omit it
 * for the feed-wide view.
 */
export function directionsForRoute(
  source: RouteSource,
  routeId: string,
  serviceId?: string
): DirectionInfo[] {
  const byDirection = new Map<string, RouteSourceTrip[]>();
  for (const trip of source.tripsForRoute(routeId, serviceId)) {
    const key = trip.direction_id ?? '';
    let list = byDirection.get(key);
    if (!list) {
      byDirection.set(key, (list = []));
    }
    list.push(trip);
  }

  return [...byDirection.entries()]
    .map(([direction_id, trips]) => ({
      direction_id,
      label: directionLabel(source, trips, direction_id),
      tripCount: trips.length,
    }))
    .sort(
      (a, b) =>
        b.tripCount - a.tripCount ||
        a.direction_id.localeCompare(b.direction_id)
    );
}

function build(
  source: RouteSource,
  routeId: string,
  directionId: string,
  serviceId?: string
): RouteSequence {
  const trips = source
    .tripsForRoute(routeId, serviceId)
    .filter((t) => (t.direction_id ?? '') === directionId);

  // Distinct stop patterns, each remembering which trips share it.
  const byKey = new Map<string, RoutePattern>();
  // Only for trips where collapsing platforms actually merged something; for
  // everyone else a trip's stop_times index is already the element index.
  const collapsedIndex = new Map<string, number[]>();
  let isLoop = false;
  for (const trip of trips) {
    const { elements: stops, indexOfStop } = tripStops(source, trip.trip_id);
    if (stops.length === 0) {
      continue;
    }
    if (stops.some((s) => s.occurrence > 0)) {
      isLoop = true;
    }
    if (indexOfStop.length !== stops.length) {
      collapsedIndex.set(trip.trip_id, indexOfStop);
    }

    const key = stops.map(elementKey).join('');
    let pattern = byKey.get(key);
    if (!pattern) {
      byKey.set(key, (pattern = { key, stops, trip_ids: [], scsIndex: null }));
    }
    pattern.trip_ids.push(trip.trip_id);
  }

  const ranked = [...byKey.values()].sort(
    (a, b) => b.trip_ids.length - a.trip_ids.length
  );
  const totalTrips = ranked.reduce((sum, p) => sum + p.trip_ids.length, 0);

  // Every pattern goes on the strip — see the module comment on why the tail
  // of a real feed is not noise. Order is still busiest-first, which seeds the
  // fold with the dominant pattern.
  const included = ranked;
  included.forEach((pattern, i) => {
    pattern.scsIndex = i;
  });

  const sequences = included.map((p) => p.stops.map(elementKey));
  const topo = topoOrder(
    sequences,
    included.map((p) => p.trip_ids.length)
  );
  const supersequence = topo.cyclic ? foldSupersequence(sequences) : topo.order;
  const mappings = alignToSupersequence(sequences, supersequence);

  const patternForTrip = new Map<string, RoutePattern>();
  for (const pattern of included) {
    for (const tripId of pattern.trip_ids) {
      patternForTrip.set(tripId, pattern);
    }
  }

  // Weighted by trips, not patterns: one pattern carrying 140 trains and one
  // carrying a single seasonal run should not count the same at a terminal.
  const patternPositions = mappings.map((mapping) => [...mapping.values()]);
  const stopStats: StopStats[] = supersequence.map(() => ({
    startsHere: 0,
    endsHere: 0,
    serves: 0,
  }));
  patternPositions.forEach((positions, i) => {
    if (positions.length === 0) {
      return;
    }
    const trips = included[i].trip_ids.length;
    for (const position of positions) {
      stopStats[position].serves += trips;
    }
    stopStats[positions[0]].startsHere += trips;
    stopStats[positions[positions.length - 1]].endsHere += trips;
  });

  return {
    route_id: routeId,
    direction_id: directionId,
    stops: supersequence.map(parseElement),
    stopStats,
    patternPositions,
    patterns: ranked,
    patternForTrip,
    totalPatterns: ranked.length,
    totalTrips,
    isLoop,
    positionOf(tripId, stopIndex) {
      const pattern = patternForTrip.get(tripId);
      if (!pattern || pattern.scsIndex === null) {
        return null;
      }
      // A vehicle at either platform of a collapsed station maps to the one
      // element that station became.
      const remap = collapsedIndex.get(tripId);
      const elementIndex = remap ? remap[stopIndex] : stopIndex;
      if (elementIndex === undefined) {
        return null;
      }
      return mappings[pattern.scsIndex].get(elementIndex) ?? null;
    },
  };
}

/**
 * Cached per RouteSource instance: the fold is the most expensive thing this
 * module does. The cache is keyed on the `RouteSource` object itself, so a
 * fresh adapter instance drops it. coloring-book's data is mutable, so callers
 * that mutate the feed must call `clearRouteSequenceCache` explicitly.
 */
const cache = new WeakMap<RouteSource, Map<string, RouteSequence>>();

export function routeSequence(
  source: RouteSource,
  routeId: string,
  directionId: string,
  serviceId?: string
): RouteSequence {
  let forSource = cache.get(source);
  if (!forSource) {
    cache.set(source, (forSource = new Map()));
  }

  const key = `${routeId} ${directionId} ${serviceId ?? ''}`;
  let sequence = forSource.get(key);
  if (!sequence) {
    forSource.set(
      key,
      (sequence = build(source, routeId, directionId, serviceId))
    );
  }
  return sequence;
}

export function clearRouteSequenceCache(source: RouteSource): void {
  cache.delete(source);
}
