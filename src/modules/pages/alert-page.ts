/**
 * The alert page, plus the compact alert list every other page embeds.
 */

import type { AlertRecord, ServiceAlert } from '../../gtfs-rt';
import type { PageState } from '../../types/page-state';
import {
  ALERT_LEVEL_LABELS,
  CAUSE_LABELS,
  EFFECT_LABELS,
  SEVERITY_LABELS,
  activePeriods,
  alertLevel,
  isActiveNow,
  preferredText,
  selectorLevel,
  translations,
} from '../alerts';
import type { RenderContext } from '../render-utils';
import {
  entityLink,
  escHtml,
  formatAbsolute,
  formatDuration,
  missing,
  pageHeader,
  prop,
  propList,
  renderRawJson,
  section,
} from '../render-utils';

type EntitySelector = NonNullable<ServiceAlert['informedEntity']>[number];

function statusBadge(record: AlertRecord): string {
  return isActiveNow(record.alert)
    ? '<span class="badge badge-warning badge-xs">active</span>'
    : '<span class="badge badge-ghost badge-xs">not active</span>';
}

/**
 * A list of alerts as one-line links. Used for the route page's alert regions,
 * the stop page, and the alerts modal, so they cannot drift apart.
 */
export function renderAlertList(
  ctx: RenderContext,
  records: AlertRecord[],
  title: string,
): string {
  if (records.length === 0) return '';
  return section(
    title,
    `<ul class="space-y-1">${records
      .map(record => {
        const header = preferredText(record.alert.headerText) || `Alert ${record.id}`;
        return `<li class="flex items-start gap-2">
          ${statusBadge(record)}
          <span class="text-xs flex-1 min-w-0">${entityLink(
            ctx,
            { type: 'alert', alert_id: record.id },
            header,
          )}</span>
          <span class="text-xs opacity-50 shrink-0">${escHtml(
            ALERT_LEVEL_LABELS[alertLevel(record)],
          )}</span>
        </li>`;
      })
      .join('')}</ul>`,
  );
}

/** The languages the feed supplied beyond the one we chose to display. */
function renderOtherTranslations(label: string, ts: ServiceAlert['headerText']): string {
  const others = translations(ts).filter(t => t.text !== preferredText(ts));
  if (others.length === 0) return '';
  return `
    <details class="text-xs" data-detail="tr:${escHtml(label)}">
      <summary class="cursor-pointer opacity-60">${others.length} other translation${
        others.length === 1 ? '' : 's'
      }</summary>
      <dl class="mt-1 space-y-1">${others
        .map(
          t => `<div>
            <dt class="opacity-50 font-mono">${escHtml(t.language || '(no language)')}</dt>
            <dd class="whitespace-pre-wrap">${escHtml(t.text)}</dd>
          </div>`,
        )
        .join('')}</dl>
    </details>`;
}

/** Every language the feed supplied, not just the one we chose to display. */
function renderTranslations(label: string, ts: ServiceAlert['headerText']): string {
  const list = translations(ts);
  if (list.length === 0) return '';
  return `
    <div class="space-y-1">
      <p class="text-xs opacity-60">${escHtml(label)}</p>
      <p class="text-sm whitespace-pre-wrap">${escHtml(preferredText(ts))}</p>
      ${renderOtherTranslations(label, ts)}
    </div>`;
}

/**
 * The one-line version of the active periods, for the page header. The full
 * list is still rendered below in its own section.
 */
function activeWindow(alert: ServiceAlert): string {
  const periods = activePeriods(alert);
  if (periods.length === 0) return 'always active';

  const now = Date.now() / 1000;
  const current = periods.find(p => (p.start ?? -Infinity) <= now && (p.end ?? Infinity) >= now);
  const upcoming = periods.find(p => p.start !== undefined && p.start > now);

  let phrase: string;
  if (current) {
    phrase =
      current.end === undefined
        ? 'active, open-ended'
        : `active until ${formatAbsolute(current.end)}`;
  } else if (upcoming) {
    phrase = `starts ${formatAbsolute(upcoming.start!)}`;
  } else {
    const last = periods[periods.length - 1];
    phrase = last.end === undefined ? 'not active' : `ended ${formatAbsolute(last.end)}`;
  }

  return periods.length > 1 ? `${phrase}, ${periods.length} periods` : phrase;
}

/**
 * Active periods as absolute times plus what they mean right now. A period with
 * a start and no end is open-ended, and is said to be, rather than being
 * rendered with an end of 1970.
 */
function renderActivePeriods(alert: ServiceAlert): string {
  const periods = activePeriods(alert);
  if (periods.length === 0) {
    return `<p class="text-xs opacity-60">No active period given — the alert is always active.</p>`;
  }
  const now = Date.now() / 1000;
  return `<ul class="text-xs space-y-1">${periods
    .map(p => {
      const start = p.start === undefined ? 'always' : formatAbsolute(p.start);
      const end = p.end === undefined ? 'open-ended' : formatAbsolute(p.end);
      let note: string;
      if (p.start !== undefined && p.start > now) note = `starts in ${formatDuration(p.start - now)}`;
      else if (p.end !== undefined && p.end < now) note = `ended ${formatDuration(now - p.end)} ago`;
      else if (p.end !== undefined) note = `active, ends in ${formatDuration(p.end - now)}`;
      else note = 'active';
      return `<li class="flex justify-between gap-2">
        <span>${escHtml(start)} -&gt; ${escHtml(end)}</span>
        <span class="opacity-60 shrink-0">${escHtml(note)}</span>
      </li>`;
    })
    .join('')}</ul>`;
}

/** Each informed entity as links to the pages for the objects it names. */
function renderInformedEntity(ctx: RenderContext, e: EntitySelector): string {
  const feed = ctx.session.scheduledFeed;
  const links: string[] = [];

  if (e.agencyId) links.push(`<span class="opacity-60">agency</span> ${escHtml(e.agencyId)}`);
  if (e.routeType !== null && e.routeType !== undefined) {
    links.push(`<span class="opacity-60">route_type</span> ${escHtml(String(e.routeType))}`);
  }
  if (e.routeId) {
    const route = feed?.routes.get(e.routeId);
    links.push(
      `<span class="opacity-60">route</span> ${
        route
          ? entityLink(ctx, { type: 'route', route_id: route.id }, route.short_name || route.long_name || route.id)
          : escHtml(e.routeId)
      }`,
    );
  }
  if (e.stopId) {
    const stop = feed?.stops.get(e.stopId);
    links.push(
      `<span class="opacity-60">stop</span> ${
        stop ? entityLink(ctx, { type: 'stop', stop_id: stop.id }, stop.name || stop.id) : escHtml(e.stopId)
      }`,
    );
  }
  if (e.trip?.tripId) {
    const trip = feed?.trips.get(e.trip.tripId);
    links.push(
      `<span class="opacity-60">trip</span> ${escHtml(e.trip.tripId)}${
        trip
          ? ` <span class="opacity-60">on</span> ${entityLink(
              ctx,
              { type: 'route', route_id: trip.route_id },
              trip.route_id,
            )}`
          : ''
      }`,
    );
  }
  if (e.directionId !== null && e.directionId !== undefined) {
    links.push(`<span class="opacity-60">direction</span> ${escHtml(String(e.directionId))}`);
  }

  return `<li class="text-xs rounded border border-base-300 p-2 space-y-1">
    <span class="badge badge-ghost badge-xs">${escHtml(ALERT_LEVEL_LABELS[selectorLevel(e)])}</span>
    <div class="flex flex-wrap gap-x-3 gap-y-1">${
      links.length ? links.join('') : '<span class="opacity-50">names nothing — applies to the whole feed</span>'
    }</div>
  </li>`;
}

export function renderAlertPage(
  ctx: RenderContext,
  state: Extract<PageState, { type: 'alert' }>,
): string {
  const record = ctx.session.alerts.get(state.alert_id);
  if (!record) {
    return `${missing(`Alert ${state.alert_id}`)}
      <p class="text-xs opacity-50 mt-2">GTFS-RT alerts are keyed on the feed entity id, and some
      producers regenerate those between polls — the same disruption may now be under a different id.</p>`;
  }
  const alert = record.alert;
  const url = preferredText(alert.url);

  return `
    <div class="space-y-4">
      <div class="space-y-1">
        ${pageHeader(preferredText(alert.headerText) || record.id, record.id)}
        ${renderOtherTranslations('Header', alert.headerText)}
      </div>

      ${alert.descriptionText ? renderTranslations('Description', alert.descriptionText) : ''}
      ${
        url
          ? `<p class="text-xs"><a href="${escHtml(url)}" target="_blank" rel="noopener" class="link">${escHtml(url)}</a></p>`
          : ''
      }

      ${section(
        'Properties',
        propList([
          prop('Status', `${statusBadge(record)} ${escHtml(activeWindow(alert))}`),
          prop('Level', escHtml(ALERT_LEVEL_LABELS[alertLevel(record)])),
          prop('Cause', escHtml(CAUSE_LABELS[alert.cause as number] ?? String(alert.cause ?? '—'))),
          prop('Effect', escHtml(EFFECT_LABELS[alert.effect as number] ?? String(alert.effect ?? '—'))),
          prop(
            'Severity',
            escHtml(SEVERITY_LABELS[alert.severityLevel as number] ?? String(alert.severityLevel ?? '—')),
          ),
        ]),
      )}

      ${section('Active periods', renderActivePeriods(alert))}

      ${section(
        'Informed entities',
        (alert.informedEntity ?? []).length
          ? `<ul class="space-y-1">${alert.informedEntity!
              .map(e => renderInformedEntity(ctx, e))
              .join('')}</ul>`
          : '<p class="text-xs opacity-60">No informed entities — the alert applies to the whole feed.</p>',
      )}

      ${renderRawJson('Alert (decoded)', record.raw)}
    </div>`;
}
