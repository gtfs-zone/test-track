/* @vendored-from coloring-book:src/modules/notification-system.ts
   @sha 51e8536
   @status verbatim */
import { renderCloseIcon } from './modal-utils.js';

interface NotificationAction {
  id: string;
  label: string;
  handler: () => void;
  primary?: boolean;
}

interface NotificationOptions {
  autoHide?: boolean;
  duration?: number;
  actions?: NotificationAction[];
}

interface Notification {
  id: number;
  message: string;
  type: string;
  autoHide: boolean;
  duration: number;
  actions: NotificationAction[];
  element: HTMLElement | null;
}

export class NotificationSystem {
  private container: HTMLElement | null = null;
  private notifications: Notification[] = [];
  private maxNotifications: number = 5;
  private autoHideDelay: number = 5000; // 5 seconds

  constructor() {}

  initialize(): void {
    // Create notification container
    this.container = document.createElement('div');
    this.container.id = 'notification-container';
    this.container.className = 'fixed top-32 left-2 z-[100] space-y-2 max-w-xs';
    document.body.appendChild(this.container);
  }

  show(
    message: string,
    type: string = 'info',
    options: NotificationOptions = {}
  ): number {
    const {
      autoHide = true,
      duration = this.autoHideDelay,
      actions = [],
    } = options;

    const notification = {
      id: Date.now() + Math.random(),
      message,
      type,
      autoHide,
      duration,
      actions,
      element: null,
    };

    this.notifications.push(notification);
    this.renderNotification(notification);

    // Remove oldest notifications if we exceed the limit
    if (this.notifications.length > this.maxNotifications) {
      const toRemove = this.notifications.splice(
        0,
        this.notifications.length - this.maxNotifications
      );
      toRemove.forEach((n) => this.removeNotification(n.id));
    }

    // Auto-hide if enabled
    if (autoHide) {
      setTimeout(() => {
        this.removeNotification(notification.id);
      }, duration);
    }

    return notification.id;
  }

  error(message: string, options: NotificationOptions = {}): number {
    return this.show(message, 'error', {
      autoHide: true,
      duration: 8000,
      ...options,
    });
  }

  warning(message: string, options: NotificationOptions = {}): number {
    return this.show(message, 'warning', {
      autoHide: true,
      duration: 6000,
      ...options,
    });
  }

  success(message: string, options: NotificationOptions = {}): number {
    return this.show(message, 'success', {
      autoHide: true,
      duration: 4000,
      ...options,
    });
  }

  info(message: string, options: NotificationOptions = {}): number {
    return this.show(message, 'info', {
      autoHide: true,
      duration: 5000,
      ...options,
    });
  }

  loading(message: string, options: NotificationOptions = {}): number {
    return this.show(message, 'loading', {
      autoHide: true,
      duration: 30000,
      ...options,
    });
  }

  renderNotification(notification: Notification): void {
    const { message, type, actions } = notification;

    const alertClassMap: Record<string, string> = {
      error: 'alert',
      warning: 'alert',
      success: 'alert',
      info: 'alert',
      loading: 'alert',
    };

    const iconMap: Record<string, string> = {
      info: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-info h-6 w-6 shrink-0"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`,
      success: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-success h-6 w-6 shrink-0"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`,
      warning: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-warning h-6 w-6 shrink-0"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>`,
      error: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-error h-6 w-6 shrink-0"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`,
      loading: `<span class="loading loading-spinner loading-sm shrink-0"></span>`,
    };

    const element = document.createElement('div');
    element.setAttribute('role', 'alert');
    element.className = `notification-item ${alertClassMap[type] ?? 'alert'} shadow-lg max-w-sm transform transition-all duration-300 ease-in-out`;
    element.style.opacity = '0';
    element.style.transform = 'translateX(-100%)';

    let actionsHtml = '';
    if (actions.length > 0) {
      actionsHtml = `
        <div class="flex gap-2 mt-1">
          ${actions
            .map(
              (action) => `
            <button
              class="notification-action btn btn-xs ${action.primary ? 'btn-info' : 'btn-outline'}"
              data-action="${action.id}"
            >
              ${action.label}
            </button>
          `
            )
            .join('')}
        </div>
      `;
    }

    element.innerHTML = `
      ${iconMap[type] ?? ''}
      <div class="flex-1 min-w-0">
        <span class="text-sm [overflow-wrap:anywhere]">${this.formatMessage(message)}</span>
        ${actionsHtml}
      </div>
      <button class="notification-close btn btn-ghost btn-xs btn-circle shrink-0">${renderCloseIcon('h-3 w-3')}</button>
    `;

    notification.element = element;
    this.container!.appendChild(element);

    // Animate in
    requestAnimationFrame(() => {
      element.style.opacity = '1';
      element.style.transform = 'translateX(0)';
    });

    // Add event listeners
    const closeBtn = element.querySelector('.notification-close');
    closeBtn?.addEventListener('click', () => {
      this.removeNotification(notification.id);
    });

    // Add action listeners
    const actionBtns = element.querySelectorAll('.notification-action');
    actionBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const actionId = (btn as HTMLElement).dataset.action;
        const action = actions.find((a) => a.id === actionId);
        if (action && action.handler) {
          action.handler();
        }
        this.removeNotification(notification.id);
      });
    });
  }

  removeNotification(id: number): void {
    const notificationIndex = this.notifications.findIndex((n) => n.id === id);
    if (notificationIndex === -1) {
      return;
    }

    const notification = this.notifications[notificationIndex];
    if (!notification.element) {
      return;
    }

    // Animate out
    notification.element.style.opacity = '0';
    notification.element.style.transform = 'translateX(-100%)';

    setTimeout(() => {
      if (notification.element && notification.element.parentNode) {
        notification.element.parentNode.removeChild(notification.element);
      }
      this.notifications.splice(notificationIndex, 1);
    }, 300);
  }

  removeAllNotifications(): void {
    this.notifications.forEach((notification) => {
      this.removeNotification(notification.id);
    });
  }

  updateNotification(
    id: number,
    newMessage: string,
    newType: string | null = null
  ): void {
    const notification = this.notifications.find((n) => n.id === id);
    if (!notification) {
      return;
    }

    notification.message = newMessage;
    if (newType) {
      notification.type = newType;
    }

    // Re-render the notification
    const oldElement = notification.element;
    this.renderNotification(notification);

    if (oldElement && oldElement.parentNode) {
      oldElement.parentNode.replaceChild(notification.element!, oldElement);
    }
  }

  escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Lightly format a notification message for readability. Uses typography
   * tiers (weight / monospace / opacity) rather than hue, so it stays legible
   * on any colored alert background and across themes:
   * - `"name/id"` (quoted entity token from humanLabel) becomes a monospace chip so
   *   long ids are visually distinct from prose and wrap anywhere (#135).
   * - `(field, field)` (changed-field summary) becomes muted monospace so GTFS keys
   *   read as keys, not prose.
   * - `created` / `updated` / `deleted` (change verbs) become bold, for quick scan.
   * Everything else is plain escaped text. Purely presentational, the
   * underlying wording stays identical to the Changes panel / undo-redo labels.
   */
  private formatMessage(message: string): string {
    return message
      .split(/("[^"]*"|\([^)]*\))/g)
      .map((part) => {
        if (part.length >= 2 && part.startsWith('"') && part.endsWith('"')) {
          const inner = this.escapeHtml(part.slice(1, -1));
          return `<code class="px-1 rounded bg-current/15 font-mono text-[0.85em] [overflow-wrap:anywhere]">${inner}</code>`;
        }
        if (part.length >= 2 && part.startsWith('(') && part.endsWith(')')) {
          return `<span class="font-mono text-[0.85em] opacity-70 [overflow-wrap:anywhere]">${this.escapeHtml(part)}</span>`;
        }
        return this.escapeHtml(part).replace(
          /\b(created|updated|deleted)\b/g,
          '<strong class="font-semibold">$1</strong>'
        );
      })
      .join('');
  }
}

// Create a global instance
export const notify = new NotificationSystem();
