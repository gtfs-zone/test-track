/* @vendored-from coloring-book:src/modules/feed-progress-indicator.ts
   @sha 43f3664
   @status verbatim */
/**
 * Feed Progress Indicator
 * Top-bar progress indicator for GTFS feed load operations.
 */
export interface LoadingOptions {
  /**
   * Renders a Cancel button while this operation is the one on display.
   * Omit it for work that cannot be interrupted (a file read, a parse).
   */
  onCancel?: () => void;
}

/** What the bar would show for one live operation. */
interface OperationState {
  status: string;
  progress: number;
}

export class FeedProgressIndicator {
  private loadingStates: Map<string, OperationState> = new Map();
  private cancelHandlers: Map<string, () => void> = new Map();
  private cancellingOperations: Set<string> = new Set();
  // Several operations can be live at once, but the bar shows one at a time;
  // the Cancel button belongs to whichever one is on display.
  private currentOperation: string | null = null;
  private loadingElement: HTMLElement | null = null;
  private progressElement: HTMLElement | null = null;
  private statusElement: HTMLElement | null = null;
  private cancelElement: HTMLButtonElement | null = null;

  constructor() {
    this.initializeLoadingIndicator();
  }

  private initializeLoadingIndicator(): void {
    let existingIndicator = document.getElementById('global-loading-indicator');
    if (!existingIndicator) {
      existingIndicator = this.createLoadingIndicator();
      document.body.appendChild(existingIndicator);
    }

    this.loadingElement = existingIndicator;
    this.progressElement = existingIndicator.querySelector('.loading-progress');
    this.statusElement = existingIndicator.querySelector('.loading-status');
    this.cancelElement = existingIndicator.querySelector('.loading-cancel');
    this.cancelElement?.addEventListener('click', () => this.handleCancel());
  }

  private createLoadingIndicator(): HTMLElement {
    const indicator = document.createElement('div');
    indicator.id = 'global-loading-indicator';
    indicator.className =
      'fixed top-0 left-0 right-0 z-50 bg-primary text-primary-content px-4 py-2 transform -translate-y-full transition-transform duration-300 ease-in-out';
    indicator.innerHTML = `
      <div class="flex items-center justify-center space-x-3">
        <span class="loading loading-spinner loading-sm"></span>
        <div class="flex flex-col">
          <span class="loading-status text-sm font-medium">Processing...</span>
          <div class="loading-progress-container mt-1">
            <progress class="loading-progress progress progress-primary-content w-64 h-1" value="0" max="100"></progress>
          </div>
        </div>
        <button type="button" class="loading-cancel btn btn-ghost btn-xs hidden">Cancel</button>
      </div>
    `;
    return indicator;
  }

  startLoading(
    operation: string,
    status: string = 'Processing...',
    options: LoadingOptions = {}
  ): void {
    this.loadingStates.set(operation, { status, progress: 0 });
    // A restarted operation gets its own handler, never the previous run's.
    if (options.onCancel) {
      this.cancelHandlers.set(operation, options.onCancel);
    } else {
      this.cancelHandlers.delete(operation);
    }
    this.cancellingOperations.delete(operation);
    this.currentOperation = operation;
    this.render();
    this.showLoadingIndicator();
  }

  updateProgress(operation: string, progress: number, status?: string): void {
    const state = this.loadingStates.get(operation);
    if (!state) {
      return;
    }
    state.progress = progress;
    // Chunks keep arriving after a cancel until the abort lands; the
    // 'Cancelling...' line stays put rather than flickering back to bytes.
    if (status && !this.cancellingOperations.has(operation)) {
      state.status = status;
    }
    this.currentOperation = operation;
    this.render();
  }

  finishLoading(operation: string): void {
    this.loadingStates.delete(operation);
    this.cancelHandlers.delete(operation);
    this.cancellingOperations.delete(operation);
    if (this.currentOperation === operation) {
      // Hand the bar back to whatever is still running, with its own status and
      // progress, rather than leaving this operation's "Complete!" at 100%.
      const remaining = this.getLoadingOperations();
      this.currentOperation = remaining[remaining.length - 1] ?? null;
    }
    this.render();

    if (this.loadingStates.size === 0) {
      this.hideLoadingIndicator();
    }
  }

  isLoading(): boolean {
    return this.loadingStates.size > 0;
  }

  getLoadingOperations(): string[] {
    return Array.from(this.loadingStates.keys());
  }

  /** Fires the displayed operation's handler once, then locks the button. */
  private handleCancel(): void {
    const operation = this.currentOperation;
    if (!operation) {
      return;
    }
    const handler = this.cancelHandlers.get(operation);
    if (!handler) {
      return;
    }
    this.cancelHandlers.delete(operation);
    this.cancellingOperations.add(operation);
    const state = this.loadingStates.get(operation);
    if (state) {
      state.status = 'Cancelling...';
    }
    this.render();
    handler();
  }

  private updateCancelButton(): void {
    if (!this.cancelElement) {
      return;
    }
    const operation = this.currentOperation;
    const cancelling =
      operation !== null && this.cancellingOperations.has(operation);
    const cancellable =
      operation !== null && this.cancelHandlers.has(operation);
    this.cancelElement.classList.toggle('hidden', !cancellable && !cancelling);
    this.cancelElement.disabled = cancelling;
  }

  /** Paint whichever operation currently owns the bar. */
  private render(): void {
    const state =
      this.currentOperation === null
        ? undefined
        : this.loadingStates.get(this.currentOperation);
    if (state) {
      if (this.statusElement) {
        this.statusElement.textContent = state.status;
      }
      if (this.progressElement) {
        (this.progressElement as HTMLProgressElement).value = state.progress;
      }
    }
    this.updateCancelButton();
  }

  private showLoadingIndicator(): void {
    if (this.loadingElement) {
      this.loadingElement.classList.remove('-translate-y-full');
      this.loadingElement.classList.add('translate-y-0');
    }
  }

  private hideLoadingIndicator(): void {
    if (this.loadingElement) {
      this.loadingElement.classList.remove('translate-y-0');
      this.loadingElement.classList.add('-translate-y-full');
    }
  }
}

export const feedProgressIndicator = new FeedProgressIndicator();
