/* @vendored-from coloring-book:src/utils/escape-html.ts
   @sha a2bf4cf
   @status verbatim */
/**
 * HTML escaping for the string-building renderers.
 *
 * The obvious implementation (`createElement('div')`, set `textContent`, read
 * `innerHTML`) allocates a detached DOM node per call, and the timetable calls
 * this once per rendered token. On the MBTA feed that was ~450,000 detached
 * divs for a single Red Line timetable, which cost more than everything else
 * the view did put together. A regex over five characters is the whole job.
 */

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(text: unknown): string {
  if (text === null || text === undefined) {
    return '';
  }
  return String(text).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}
