/* @vendored-from coloring-book:src/types/gtfs-flex.ts
   @sha a4b519a
   @status verbatim */
/**
 * GTFS Flex (on-demand service) shared types.
 *
 * A stop_time references exactly one of stop_id, location_group_id or
 * location_id. StopTimeRef is the generalized form of that reference so the
 * sequence and timetable pipelines do not have to assume stop_id. Reading one
 * off a parsed stop_times row is each app's own business, since each has its
 * own row model.
 */

export type StopTimeRefKind = 'stop' | 'location_group' | 'location';

export interface StopTimeRef {
  kind: StopTimeRefKind;
  id: string;
}
