/* @vendored-from coloring-book:src/modules/bottom-sheet.ts
   @sha b0a2ff8
   @status verbatim */
type Snap = 'closed' | 'half' | 'full';

/**
 * One button of the mobile dock. The button itself lives in the host app's
 * markup; this only says what pressing it does.
 */
export interface DockItem {
  /** Element id of the button in the dock. */
  id: string;
  /** Snap to open the sheet to on press, or null to leave the sheet alone. */
  snap?: 'half' | 'full' | null;
  /** Ran after the sheet has snapped. */
  onSelect?: () => void;
}

const CLOSED_PX = 0;
const HALF_VH = 0.45;
const FULL_VH = 0.92;

export class BottomSheetController {
  private snap: Snap = 'closed';
  private panel: HTMLElement;
  private dismissCallbacks: Array<() => void> = [];
  private snapCallbacks: Array<(covered: number) => void> = [];
  private active = false;

  constructor(panel: HTMLElement, dockItems: DockItem[] = []) {
    this.panel = panel;
    this.setupDragHandle();
    this.setupDock(dockItems);

    const dock = document.getElementById('mobile-dock');
    if (dock) {
      new ResizeObserver(() => {
        const h = dock.getBoundingClientRect().height;
        if (h > 0) {
          document.documentElement.style.setProperty('--dock-height', `${h}px`);
        }
      }).observe(dock);
    }

    const mobile = window.matchMedia('(max-width: 767px)');
    this.applyMode(mobile.matches);
    mobile.addEventListener('change', (e) => this.applyMode(e.matches));
  }

  /** Enter or leave sheet mode when the breakpoint is crossed. */
  private applyMode(isMobile: boolean): void {
    this.active = isMobile;
    if (isMobile) {
      this.setSnap(this.snap, false);
    } else {
      this.panel.style.removeProperty('height');
      this.panel.style.removeProperty('overflow');
      this.panel.classList.remove('sheet-full', 'sheet-half');
      for (const cb of this.snapCallbacks) {
        cb(CLOSED_PX);
      }
    }
  }

  private setupDragHandle(): void {
    const handle = document.getElementById('sheet-top-handle');
    if (!handle) {
      return;
    }

    let startY = 0;
    let startHeight = 0;
    let lastY = 0;
    let lastTime = 0;
    let velocity = 0;
    let dragging = false;

    const onStart = (clientY: number) => {
      if (!this.active) {
        return;
      }
      startY = clientY;
      startHeight = this.panel.getBoundingClientRect().height;
      lastY = clientY;
      lastTime = Date.now();
      velocity = 0;
      dragging = true;
      this.panel.style.transition = 'none';
      document.body.style.userSelect = 'none';
    };

    const onMove = (clientY: number) => {
      if (!dragging) {
        return;
      }
      const now = Date.now();
      const dt = now - lastTime;
      if (dt > 0) {
        velocity = (lastY - clientY) / dt;
      } // px/ms, positive = up
      lastY = clientY;
      lastTime = now;

      const delta = startY - clientY; // positive = dragging up
      const maxH =
        (window.visualViewport?.height ?? window.innerHeight) * FULL_VH;
      const newHeight = Math.min(
        maxH,
        Math.max(CLOSED_PX, startHeight + delta)
      );
      this.panel.style.height = `${newHeight}px`;
    };

    const onEnd = () => {
      if (!dragging) {
        return;
      }
      dragging = false;
      startY = 0;
      document.body.style.userSelect = '';
      this.panel.style.transition = '';
      const targetSnap = this.resolveSnap(velocity);
      this.setSnap(targetSnap, true);
    };

    // Touch
    handle.addEventListener(
      'touchstart',
      (e) => onStart(e.touches[0].clientY),
      { passive: true }
    );
    document.addEventListener(
      'touchmove',
      (e) => {
        if (dragging) {
          onMove(e.touches[0].clientY);
        }
      },
      { passive: true }
    );
    document.addEventListener('touchend', () => onEnd());

    // Mouse (for desktop testing)
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      onStart(e.clientY);
    });
    document.addEventListener('mousemove', (e) => {
      if (dragging) {
        onMove(e.clientY);
      }
    });
    document.addEventListener('mouseup', () => onEnd());
  }

  private resolveSnap(velocity: number): Snap {
    const VELOCITY_THRESHOLD = 0.4; // px/ms
    const h = this.panel.getBoundingClientRect().height;
    const vph = window.visualViewport?.height ?? window.innerHeight;
    const halfH = vph * HALF_VH;
    const fullH = vph * FULL_VH;

    if (velocity < -VELOCITY_THRESHOLD || h < halfH / 2) {
      // Strongly downward or very low: dismiss
      this.fireDismissCallbacks();
      return 'closed';
    }
    if (velocity > VELOCITY_THRESHOLD) {
      return this.snap === 'half' ? 'full' : 'half';
    }
    // Snap to nearest based on current height
    if (h < (halfH + fullH) / 2) {
      return 'half';
    }
    return 'full';
  }

  private fireDismissCallbacks(): void {
    for (const cb of this.dismissCallbacks) {
      cb();
    }
  }

  private setSnap(snap: Snap, animate: boolean): void {
    this.snap = snap;
    if (!animate) {
      this.panel.style.transition = 'none';
    }
    const h =
      snap === 'closed'
        ? '0px'
        : snap === 'half'
          ? `${HALF_VH * 100}dvh`
          : `${FULL_VH * 100}dvh`;
    this.panel.style.height = h;
    this.panel.classList.toggle('sheet-full', snap === 'full');
    this.panel.classList.toggle('sheet-half', snap === 'half');
    if (snap === 'closed') {
      this.panel.style.overflow = 'hidden';
    } else {
      this.panel.style.removeProperty('overflow');
    }
    if (!animate) {
      // Re-enable transition after layout settles
      requestAnimationFrame(() => {
        this.panel.style.transition = '';
      });
    }
    const covered = this.coveredHeight();
    for (const cb of this.snapCallbacks) {
      cb(covered);
    }
  }

  private setupDock(items: DockItem[]): void {
    const buttons = items.map((item) => ({
      item,
      el: document.getElementById(item.id),
    }));

    for (const { item, el } of buttons) {
      el?.addEventListener('click', () => {
        for (const other of buttons) {
          other.el?.classList.toggle('dock-active', other.item.id === item.id);
        }
        const snap = item.snap === undefined ? 'half' : item.snap;
        if (snap) {
          this.open(snap);
        }
        item.onSelect?.();
      });
    }
  }

  public onDismiss(cb: () => void): void {
    this.dismissCallbacks.push(cb);
  }

  /**
   * Pixels of the map the sheet is currently covering. 0 on desktop, where the
   * panel sits beside the map rather than over it.
   */
  public coveredHeight(): number {
    if (!this.active || this.snap === 'closed') {
      return CLOSED_PX;
    }
    const vph = window.visualViewport?.height ?? window.innerHeight;
    return vph * (this.snap === 'half' ? HALF_VH : FULL_VH);
  }

  /** Fired on every snap change, including drag-driven ones. */
  public onSnapChange(cb: (covered: number) => void): void {
    this.snapCallbacks.push(cb);
  }

  public open(snap: 'half' | 'full' = 'half'): void {
    if (!this.active) {
      return;
    }
    this.setSnap(snap, true);
  }

  public close(): void {
    if (!this.active) {
      return;
    }
    // Programmatic close: does not fire dismiss callbacks
    this.setSnap('closed', true);
  }
}
