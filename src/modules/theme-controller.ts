/* @vendored-from coloring-book:src/modules/theme-controller.ts
   @sha a4b5ee1
   @status verbatim */
export class ThemeController {
  private listeners: ((theme: string) => void)[] = [];

  /**
   * Subscribe to theme changes. The map resolves its accent color from the
   * active DaisyUI palette, so it has to repaint when the theme switches.
   */
  public onThemeChange(listener: (theme: string) => void): void {
    this.listeners.push(listener);
  }

  private notify(theme: string): void {
    this.listeners.forEach((listener) => {
      try {
        listener(theme);
      } catch (error) {
        console.error('[ThemeController] Theme change listener failed:', error);
      }
    });
  }

  initialize(): void {
    // Load saved theme preference on page load
    this.loadThemePreference();

    // Listen for theme changes on all theme controllers
    document.addEventListener('change', (event) => {
      const target = event.target as HTMLInputElement;
      if (target?.classList.contains('theme-controller')) {
        this.handleThemeChange(target);
      }
    });
  }

  private loadThemePreference(): void {
    const savedTheme = localStorage.getItem('theme');
    const htmlElement = document.documentElement;

    if (savedTheme) {
      // Apply saved theme
      htmlElement.setAttribute('data-theme', savedTheme);
      this.updateThemeControllers(savedTheme);
    } else {
      // Check system preference
      const prefersDark = window.matchMedia(
        '(prefers-color-scheme: dark)'
      ).matches;
      const defaultTheme = prefersDark ? 'dark' : 'light';

      htmlElement.setAttribute('data-theme', defaultTheme);
      this.updateThemeControllers(defaultTheme);
      localStorage.setItem('theme', defaultTheme);
    }
  }

  private handleThemeChange(controller: HTMLInputElement): void {
    const htmlElement = document.documentElement;
    let newTheme: string;

    // Handle different types of theme controllers
    if (controller.type === 'checkbox') {
      // For checkboxes, use the value when checked, or determine opposite
      newTheme = controller.checked
        ? controller.value
        : controller.value === 'light'
          ? 'dark'
          : 'light';
    } else if (controller.type === 'radio') {
      // For radio buttons, use the value directly
      newTheme = controller.value;
    } else {
      return;
    }

    // Apply theme
    htmlElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    this.notify(newTheme);
  }

  private updateThemeControllers(theme: string): void {
    const controllers = document.querySelectorAll(
      '.theme-controller'
    ) as NodeListOf<HTMLInputElement>;

    controllers.forEach((controller) => {
      if (controller.type === 'checkbox') {
        // For toggle-style controllers, check if current theme matches the value
        controller.checked = controller.value === theme;
      } else if (controller.type === 'radio') {
        // For radio controllers, check the one that matches current theme
        controller.checked = controller.value === theme;
      }
    });
  }

  public setTheme(theme: string): void {
    const htmlElement = document.documentElement;
    htmlElement.setAttribute('data-theme', theme);
    this.updateThemeControllers(theme);
    localStorage.setItem('theme', theme);
    this.notify(theme);
  }

  public getCurrentTheme(): string {
    return document.documentElement.getAttribute('data-theme') || 'light';
  }
}
