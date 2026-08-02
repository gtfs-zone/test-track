/* @vendored-from coloring-book:src/modules/feed-progress-indicator.ts
   @sha f9c718c
   @status verbatim */
/**
 * Feed Progress Indicator
 * Top-bar progress indicator for GTFS feed load operations.
 */
export class FeedProgressIndicator {
  private loadingStates: Map<string, boolean> = new Map();
  private loadingElement: HTMLElement | null = null;
  private progressElement: HTMLElement | null = null;
  private statusElement: HTMLElement | null = null;

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
      </div>
    `;
    return indicator;
  }

  startLoading(operation: string, status: string = 'Processing...'): void {
    this.loadingStates.set(operation, true);
    this.updateLoadingDisplay(status);
  }

  updateProgress(operation: string, progress: number, status?: string): void {
    if (this.loadingStates.has(operation)) {
      if (this.progressElement) {
        (this.progressElement as HTMLProgressElement).value = progress;
      }
      if (status && this.statusElement) {
        this.statusElement.textContent = status;
      }
    }
  }

  finishLoading(operation: string): void {
    this.loadingStates.delete(operation);

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

  private updateLoadingDisplay(status: string): void {
    if (this.statusElement) {
      this.statusElement.textContent = status;
    }

    if (this.progressElement) {
      (this.progressElement as HTMLProgressElement).value = 0;
    }

    this.showLoadingIndicator();
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
