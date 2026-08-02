/**
 * The branch structure of a route strip: which lane each stop sits in, and
 * where lanes split and rejoin.
 *
 * The graph this needs is already computed and discarded by `route-sequence`.
 * `patternPositions` gives, per stop pattern, the ascending strip positions it
 * occupies; consecutive pairs, deduped across patterns, are the DAG. So there
 * is no ordering algorithm here — only classification and a lane sweep.
 *
 * The classification is the whole point. Drawing every edge as a lane is
 * unreadable: on a route where each trip skips a different subset, most edges
 * are stopping policy, not geography. An express that skips three stops and
 * rejoins the same line is a *bypass* — the line it rejoins is already drawn,
 * so the skip needs no lane of its own. A skip with no alternate path is a
 * genuine *branch*, and that is what earns a lane.
 *
 * The result: the Red Line's Ashmont/Braintree split gets two lanes below
 * JFK/UMass, while Framingham/Worcester — nineteen patterns of short turns and
 * express runs, every one of them a subsequence of the full run — stays a
 * single column, exactly as it looks today.
 */

import type { RouteSequence } from './route-sequence';

/**
 * More lanes than this and the gutter costs more width than the branching is
 * worth reading; the outermost lane is shared past the cap.
 */
const MAX_LANES = 5;

export interface RailRow {
  /** Lane holding this row's dot. */
  lane: number;
  /** Lanes crossing this row untouched, drawn as full-height verticals. */
  through: number[];
  /**
   * Lanes arriving from above into `lane`. Includes `lane` itself when this row
   * has a predecessor, so an empty list means the strip starts here.
   */
  merges: number[];
  /**
   * Lanes leaving downward from `lane`. Includes `lane` itself when the strip
   * continues in it, so an empty list means the strip ends here.
   */
  branches: number[];
  /** Lanes live in the gap below this row — `through` ∪ `branches`. */
  exiting: number[];
}

export interface RouteGraph {
  /** Parallel to `sequence.stops`. */
  rows: RailRow[];
  laneCount: number;
}

const cache = new WeakMap<RouteSequence, RouteGraph>();

/** The lane layout for a strip. Memoised per `RouteSequence`. */
export function routeGraph(sequence: RouteSequence): RouteGraph {
  const hit = cache.get(sequence);
  if (hit) return hit;
  const graph = build(sequence);
  cache.set(sequence, graph);
  return graph;
}

/**
 * Every "A immediately precedes B" assertion any pattern makes, deduped.
 *
 * Trip weights are deliberately absent: they say how *popular* an edge is, not
 * whether it is structural, and the page already reports the trip-weighted
 * facts from `stopStats`.
 */
function edgesOf(sequence: RouteSequence): Map<number, Set<number>> {
  const out = new Map<number, Set<number>>();
  for (const positions of sequence.patternPositions) {
    for (let k = 0; k + 1 < positions.length; k++) {
      const from = positions[k];
      const to = positions[k + 1];
      if (to <= from) continue;
      const targets = out.get(from);
      if (targets) targets.add(to);
      else out.set(from, new Set([to]));
    }
  }
  return out;
}

/**
 * Is there a path from `from` to `to` that does not use the edge between them?
 *
 * Bounded to positions in `(from, to]`: the strip order is topological, so no
 * path leaving that window can come back into it. That makes the walk cost
 * proportional to the span of the edge under test rather than to the strip.
 */
function hasAlternatePath(
  edges: Map<number, Set<number>>,
  from: number,
  to: number,
): boolean {
  const stack: number[] = [];
  const seen = new Set<number>();

  for (const next of edges.get(from) ?? []) {
    if (next !== to && next < to) stack.push(next);
  }

  while (stack.length > 0) {
    const at = stack.pop() as number;
    if (at === to) return true;
    if (seen.has(at)) continue;
    seen.add(at);
    for (const next of edges.get(at) ?? []) {
      if (next <= to && !seen.has(next)) stack.push(next);
    }
  }
  return false;
}

/**
 * The edges worth a lane: trunk steps, plus skips that genuinely leave the
 * line. A skip whose stops can be walked through some other way is an express
 * rejoining the line it left, and gets nothing.
 */
function structuralEdges(edges: Map<number, Set<number>>): Map<number, number[]> {
  const kept = new Map<number, number[]>();
  for (const [from, targets] of edges) {
    const survivors: number[] = [];
    for (const to of targets) {
      if (to === from + 1 || !hasAlternatePath(edges, from, to)) survivors.push(to);
    }
    if (survivors.length > 0) kept.set(from, survivors.sort((a, b) => a - b));
  }
  return kept;
}

/**
 * The git-graph sweep. Lanes hold the position they are reserved for; at each
 * row the leftmost lane targeting it wins and the rest merge into it, then the
 * row's outgoing edges reserve lanes going down.
 *
 * A route whose only edges are `i → i+1` puts every row in lane 0 with nothing
 * passing through — which is what keeps an ordinary line looking exactly as it
 * did before any of this existed.
 */
function build(sequence: RouteSequence): RouteGraph {
  const kept = structuralEdges(edgesOf(sequence));
  const rows: RailRow[] = [];
  /** Reserved position per lane, or null when the lane is free. */
  const lanes: Array<number | null> = [];
  let laneCount = 0;

  /** Reserve a lane for `target`, and say which one. */
  const reserve = (target: number): number => {
    const free = lanes.indexOf(null);
    if (free >= 0) {
      lanes[free] = target;
      return free;
    }
    if (lanes.length < MAX_LANES) {
      lanes.push(target);
      return lanes.length - 1;
    }
    // Past the cap, branches share the outermost lane. It keeps the nearest of
    // the targets crowded onto it, so the lane merges at the first row that
    // wants it; the ones it drops re-enter the sweep at their own rows.
    const last = MAX_LANES - 1;
    const held = lanes[last];
    lanes[last] = held === null ? target : Math.min(held, target);
    return last;
  };

  for (let i = 0; i < sequence.stops.length; i++) {
    const merges: number[] = [];
    for (let l = 0; l < lanes.length; l++) {
      if (lanes[l] === i) {
        merges.push(l);
        lanes[l] = null;
      }
    }

    const lane = merges.length > 0 ? merges[0] : reserve(i);
    // `reserve` claimed the lane for this row; the row is here now, so release
    // it and let the outgoing edges below claim it again.
    if (merges.length === 0) lanes[lane] = null;

    const branches: number[] = [];
    /** Lanes this row claimed for the first time, as opposed to converged on. */
    const claimed = new Set<number>();
    for (const to of kept.get(i) ?? []) {
      const existing = lanes.indexOf(to);
      if (existing >= 0) {
        // Something above already reserved a lane for this target; converge on
        // it rather than running two lanes into the same row.
        if (!branches.includes(existing)) branches.push(existing);
        continue;
      }
      // The nearest target continues straight down in this row's own lane.
      let target: number;
      if (branches.length === 0) {
        target = lane;
        lanes[lane] = to;
      } else {
        target = reserve(to);
      }
      claimed.add(target);
      if (!branches.includes(target)) branches.push(target);
    }

    // A lane this row converged into is *also* carrying whatever reserved it
    // from above, so it needs the pass-through vertical as well as the curve
    // joining it. Without both, the through line breaks at the merge: on the
    // Fall River / New Bedford line, the Fall River leg vanishes for exactly
    // the one row where New Bedford's leg rejoins it.
    const through: number[] = [];
    for (let l = 0; l < lanes.length; l++) {
      if (lanes[l] !== null && l !== lane && !claimed.has(l)) through.push(l);
    }

    laneCount = Math.max(laneCount, lane + 1, ...branches.map(l => l + 1), ...through.map(l => l + 1));
    rows.push({
      lane,
      through,
      merges,
      branches,
      // A converged lane appears in both, and must be drawn once.
      exiting: [...new Set([...through, ...branches])],
    });
  }

  return { rows, laneCount: Math.max(1, laneCount) };
}
