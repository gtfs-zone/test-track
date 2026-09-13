/* @vendored-from coloring-book:src/utils/tooltip-position.ts
   @sha 3c3f412
   @status verbatim */
/**
 * Portal-based positioning for field label tooltips.
 *
 * `renderFieldLabelContent` (src/utils/field-component.ts) renders tooltips
 * inside scrollable ancestors: page content, modal bodies, and table wrappers
 * all set `overflow-y-auto`/`overflow-x-auto` (see browse-navigation.ts,
 * modal-utils.ts, timetable-renderer.ts, editable-table.ts). DaisyUI's CSS
 * tooltip positions `.tooltip-content` as `position: absolute` relative to
 * the trigger, which gets clipped by any of those ancestors whenever the
 * tooltip (up to 36rem wide) doesn't fit in the available space.
 *
 * This module sidesteps all ancestor clipping by portaling the tooltip
 * content to `document.body` as `position: fixed`, positioned from the
 * trigger's `getBoundingClientRect()` and clamped to the viewport. It applies
 * to every element with the `.field-tooltip-trigger` class and a
 * `data-tooltip-content` attribute holding the tooltip's HTML.
 */

const TRIGGER_SELECTOR = '.field-tooltip-trigger';
const PORTAL_CLASS = 'field-tooltip-portal';
const VIEWPORT_MARGIN = 8;
const HIDE_DELAY_MS = 100;

let activePortal: HTMLDivElement | null = null;
let activeTrigger: HTMLElement | null = null;
let hideTimeoutId: ReturnType<typeof setTimeout> | null = null;
let initialized = false;

function clearHideTimeout(): void {
  if (hideTimeoutId !== null) {
    clearTimeout(hideTimeoutId);
    hideTimeoutId = null;
  }
}

function hidePortal(): void {
  clearHideTimeout();
  if (activePortal) {
    activePortal.remove();
    activePortal = null;
  }
  activeTrigger = null;
}

function scheduleHide(): void {
  clearHideTimeout();
  hideTimeoutId = setTimeout(hidePortal, HIDE_DELAY_MS);
}

function positionPortal(trigger: HTMLElement, portal: HTMLDivElement): void {
  const triggerRect = trigger.getBoundingClientRect();
  const portalRect = portal.getBoundingClientRect();

  // Prefer below the trigger, flip above if it doesn't fit, otherwise clamp.
  let top = triggerRect.bottom + VIEWPORT_MARGIN;
  if (top + portalRect.height > window.innerHeight - VIEWPORT_MARGIN) {
    const above = triggerRect.top - VIEWPORT_MARGIN - portalRect.height;
    top =
      above >= VIEWPORT_MARGIN
        ? above
        : Math.max(
            VIEWPORT_MARGIN,
            window.innerHeight - VIEWPORT_MARGIN - portalRect.height
          );
  }

  // Center horizontally on the trigger, clamped within the viewport.
  let left = triggerRect.left + triggerRect.width / 2 - portalRect.width / 2;
  left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(left, window.innerWidth - portalRect.width - VIEWPORT_MARGIN)
  );

  portal.style.top = `${top}px`;
  portal.style.left = `${left}px`;
}

function showPortal(trigger: HTMLElement): void {
  clearHideTimeout();
  if (activeTrigger === trigger) {
    return;
  }
  hidePortal();

  const content = trigger.dataset.tooltipContent;
  if (!content) {
    return;
  }

  const portal = document.createElement('div');
  // z-index sits above DaisyUI's modal layer (999) so tooltips triggered
  // inside a modal aren't painted behind it.
  portal.className = `${PORTAL_CLASS} fixed z-[2000] max-w-[36rem] max-h-[60vh] overflow-y-auto overflow-x-hidden text-left text-xs font-normal leading-snug whitespace-normal p-3 rounded-field bg-neutral text-neutral-content pointer-events-auto`;
  portal.innerHTML = content;
  portal.addEventListener('pointerenter', clearHideTimeout);
  portal.addEventListener('pointerleave', scheduleHide);

  document.body.appendChild(portal);
  activePortal = portal;
  activeTrigger = trigger;
  positionPortal(trigger, portal);
}

// Element, not HTMLElement: a trigger's content is often an inline SVG icon,
// and the pointer lands on the SVGElement, which is not an HTMLElement.
function findTrigger(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) {
    return null;
  }
  return target.closest<HTMLElement>(TRIGGER_SELECTOR);
}

function handlePointerOver(event: PointerEvent): void {
  const trigger = findTrigger(event.target);
  if (trigger) {
    showPortal(trigger);
  }
}

function handlePointerOut(event: PointerEvent): void {
  const trigger = findTrigger(event.target);
  if (!trigger) {
    return;
  }
  // Don't hide if the pointer moved to a descendant still within the trigger.
  const related = event.relatedTarget;
  if (related instanceof Element && trigger.contains(related)) {
    return;
  }
  scheduleHide();
}

function handleFocusIn(event: FocusEvent): void {
  const trigger = findTrigger(event.target);
  if (trigger) {
    showPortal(trigger);
  }
}

function handleFocusOut(event: FocusEvent): void {
  const trigger = findTrigger(event.target);
  if (trigger) {
    scheduleHide();
  }
}

function handleViewportChange(): void {
  if (!activeTrigger || !activePortal) {
    return;
  }
  const rect = activeTrigger.getBoundingClientRect();
  const stillVisible =
    rect.bottom > 0 &&
    rect.top < window.innerHeight &&
    rect.right > 0 &&
    rect.left < window.innerWidth;
  if (!stillVisible) {
    hidePortal();
    return;
  }
  positionPortal(activeTrigger, activePortal);
}

/**
 * Register the document-level delegated listeners that drive field label
 * tooltip portals. Safe to call more than once; only registers listeners
 * once per page load.
 */
export function initFieldTooltipPortal(): void {
  if (initialized) {
    return;
  }
  initialized = true;
  document.addEventListener('pointerover', handlePointerOver);
  document.addEventListener('pointerout', handlePointerOut);
  document.addEventListener('focusin', handleFocusIn);
  document.addEventListener('focusout', handleFocusOut);
  window.addEventListener('scroll', handleViewportChange, true);
  window.addEventListener('resize', handleViewportChange);
}
