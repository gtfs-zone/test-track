/* @vendored-from coloring-book:src/types/gtfs-flex.ts
   @sha d66a68b
   @status modified
   @changes
   - Types only. `stopTimeRef`, its `value` helper and the `StopTimes` entity
     import are dropped: test-track ingests stop_times into its own `StopTime`
     model and builds refs in `gtfs-scheduled-route-source.ts`. */
/**
 * GTFS Flex (on-demand service) shared types and helpers.
 *
 * A stop_time references exactly one of stop_id, location_group_id or
 * location_id. StopTimeRef is the generalized form of that reference so the
 * sequence and timetable pipelines do not have to assume stop_id.
 */

export type StopTimeRefKind = 'stop' | 'location_group' | 'location';

export interface StopTimeRef {
  kind: StopTimeRefKind;
  id: string;
}
