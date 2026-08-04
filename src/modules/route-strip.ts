/* @vendored-from coloring-book:src/modules/route-strip.ts
   @sha 9f1f986
   @status verbatim */
/**
 * The rail geometry for a route strip: SVG path builders for a branching
 * transit line, plus the two-layer cell that lays them under a stop's dot.
 *
 * Row heights are content-driven and unknown to this module, so each row's
 * SVG stretches a fixed 100-unit viewBox over whatever height it gets.
 * Circles would come out as ellipses under that non-uniform vertical scale,
 * which is why the dot is HTML, not SVG.
 *
 * Pure string builders only - no DOM, no app context. Callers own the grid
 * wrapper and everything to the right of the rail.
 */

import type { RouteGraph } from './route-graph.js';
import type { StopStats } from './route-sequence.js';

export const RAIL_WIDTH = 9;
/** The gutter a single-lane route gets - the width the rail column always had. */
export const GUTTER_BASE = 40;
/** Each extra lane costs this much width. */
export const LANE_WIDTH = 14;

/** Where a row's dot goes, if it has one. */
export type RowDot =
  | { kind: 'none' }
  | { kind: 'open' | 'solid'; lane: number };

/** Centre of lane `l`, in px from the left of the gutter. */
export function laneX(lane: number): number {
  return GUTTER_BASE / 2 + lane * LANE_WIDTH;
}

export function gutterWidth(laneCount: number): number {
  return GUTTER_BASE + (laneCount - 1) * LANE_WIDTH;
}

/**
 * One rail path, drawn twice.
 *
 * `route_color` is whatever the feed says, and `#FFFFFF` on a light theme is a
 * real and common hazard, so a slightly wider neutral stroke goes underneath.
 *
 * The viewBox is 100 tall against a row whose height is content-driven and
 * unknown here, so the vertical scale is arbitrary. `non-scaling-stroke` keeps
 * the stroke 9px regardless; the curves stretch, which is the intended look.
 */
export function railPath(d: string, color: string): string {
  return `<path d="${d}" fill="none" stroke="currentColor" class="text-base-content/15" stroke-width="${
    RAIL_WIDTH + 2
  }" stroke-linecap="round" vector-effect="non-scaling-stroke"/><path d="${d}" fill="none" stroke="${color}" stroke-width="${RAIL_WIDTH}" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
}

/** Straight down the whole row, in one lane. */
export function verticalPath(lane: number): string {
  return `M ${laneX(lane)},0 L ${laneX(lane)},100`;
}

/** From `lane` at the top of the row into `into` at the row's centre. */
export function mergePath(lane: number, into: number): string {
  const x0 = laneX(lane);
  const x1 = laneX(into);
  return lane === into
    ? `M ${x1},0 L ${x1},50`
    : `M ${x0},0 C ${x0},20 ${x1},30 ${x1},50`;
}

/** From `from` at the row's centre out into `lane` at the bottom. */
export function branchPath(from: number, lane: number): string {
  const x0 = laneX(from);
  const x1 = laneX(lane);
  return lane === from
    ? `M ${x0},50 L ${x0},100`
    : `M ${x0},50 C ${x0},80 ${x1},70 ${x1},100`;
}

/**
 * The rail cell: an SVG of lines, plus the dot as real HTML on top.
 *
 * The dot cannot go in the SVG - the non-uniform vertical scale would render a
 * circle as an ellipse of unpredictable eccentricity.
 */
export function railCell(
  color: string,
  laneCount: number,
  paths: string[],
  dot: RowDot
): string {
  const width = gutterWidth(laneCount);
  const dotHtml =
    dot.kind === 'none'
      ? ''
      : `<span class="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full ring-1 ring-base-content/25"
           style="left:${laneX(dot.lane)}px;background:${
             dot.kind === 'solid' ? color : 'var(--color-base-100, #fff)'
           };box-shadow:inset 0 0 0 3px ${color}"></span>`;
  return `
    <div class="relative shrink-0" style="width:${width}px" aria-hidden="true">
      <svg class="absolute inset-0 w-full h-full" viewBox="0 0 ${width} 100" preserveAspectRatio="none">${paths
        .map((d) => railPath(d, color))
        .join('')}</svg>
      ${dotHtml}
    </div>`;
}

/** A stop row, or the gap above/below it where a chip may sit. */
export type RowPathsOptions =
  | { kind: 'stop'; leadIn: boolean; leadOut: boolean }
  | { kind: 'gap'; side: 'above' | 'below'; last: boolean };

/**
 * A row's line segments, for either a stop row or a gap row between a stop
 * and something drawn beside it (test-track sits vehicle chips there;
 * coloring-book has none today).
 *
 * `stop`: the row's own through/merge/branch lanes, from `RouteGraph`.
 * `leadIn`/`leadOut` extend the row's own lane to the row edge at a terminus
 * that has a further row beyond it, so the two stay visually joined.
 *
 * `gap`: the lanes live across a gap row carry over from the neighbouring
 * stop row (`merges`+`through` above, `exiting` below). Past the end of the
 * strip there is nothing live, only the neighbouring stop's own lane; `last`
 * says this is the outermost row of a run, so it gets the half-length capped
 * segment instead of a full-height vertical.
 */
export function rowPaths(
  graph: RouteGraph,
  index: number,
  opts: RowPathsOptions
): string[] {
  const row = graph.rows[index];

  if (opts.kind === 'stop') {
    const paths = [
      ...row.through.map(verticalPath),
      ...row.merges.map((lane) => mergePath(lane, row.lane)),
      ...row.branches.map((lane) => branchPath(row.lane, lane)),
    ];
    if (opts.leadIn && row.merges.length === 0) {
      paths.push(mergePath(row.lane, row.lane));
    }
    if (opts.leadOut && row.branches.length === 0) {
      paths.push(branchPath(row.lane, row.lane));
    }
    return paths;
  }

  const live =
    opts.side === 'above' ? [...row.merges, ...row.through] : row.exiting;
  if (live.length > 0) {
    return live.map(verticalPath);
  }
  if (!opts.last) {
    return [verticalPath(row.lane)];
  }
  return [
    opts.side === 'above'
      ? branchPath(row.lane, row.lane)
      : mergePath(row.lane, row.lane),
  ];
}

/**
 * A stop is called an endpoint when this share of the direction's trips begin
 * or end there. Any threshold is arbitrary; this one is low enough to catch a
 * genuine branch terminus and high enough to ignore the one trip a day that
 * happens to lay up mid-route.
 */
export const ENDPOINT_SHARE = 0.05;

/**
 * Below this share of trips, a stop is drawn as a deviation from the trunk
 * and labelled with how many trips actually call there. The label is a raw
 * count, not a percentage: "87 of 300 trips" is a fact about the timetable,
 * while "29%" is a number the reader has to unpack before it says anything.
 */
export const MINORITY_SHARE = 0.5;

/**
 * The endpoint threshold for a direction, from its total trip count. Compute
 * once per render and pass to `isEndpoint`/`endpointNote` for every row.
 */
export function endpointThreshold(totalTrips: number): number {
  return Math.max(1, totalTrips * ENDPOINT_SHARE);
}

/** Whether enough trips start or end at this stop to call it a terminus. */
export function isEndpoint(stats: StopStats, threshold: number): boolean {
  return stats.startsHere >= threshold || stats.endsHere >= threshold;
}

/**
 * Where trips begin and end, when enough of them do it here to be a fact
 * about the route rather than about one trip. Empty when neither count meets
 * the threshold.
 */
export function endpointNote(stats: StopStats, threshold: number): string {
  const parts: string[] = [];
  if (stats.endsHere >= threshold) {
    parts.push(`${stats.endsHere} end`);
  }
  if (stats.startsHere >= threshold) {
    parts.push(`${stats.startsHere} start`);
  }
  return parts.join(' - ');
}

/** Whether this stop is served by few enough trips to read as a deviation. */
export function isMinority(stats: StopStats, totalTrips: number): boolean {
  const share = totalTrips > 0 ? stats.serves / totalTrips : 1;
  return share < MINORITY_SHARE;
}
