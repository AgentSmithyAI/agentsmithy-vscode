/**
 * Lightweight utility to show a spinner on a button while an async action is in progress.
 * Works with plain DOM (no framework). Keeps button width to avoid layout shifts,
 * toggles aria-busy, and disables/enables the button while loading.
 */
export class LoadingButton {
  private originalHTML: string | null = null;
  private originalWidth: string | null = null;
  private loading = false;

  constructor(private readonly el: HTMLButtonElement) {}

  isLoading(): boolean {
    return this.loading;
  }

  start(): void {
    if (this.loading) return;
    this.loading = true;

    // Preserve width to avoid layout shift when swapping content
    const rect = this.el.getBoundingClientRect();
    this.originalWidth = this.el.style.width || '';
    this.el.style.width = rect.width ? rect.width + 'px' : this.el.style.width;

    this.originalHTML = this.el.innerHTML;
    this.el.setAttribute('aria-busy', 'true');
    this.el.disabled = true;
    this.el.classList.add('loading');

    // Minimal spinner icon (reuses CSS from other spinners if present)
    this.el.innerHTML =
      '<span class="loading-btn-spinner" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" class="spinner" width="16" height="16">' +
      '<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-dasharray="62.8" stroke-dashoffset="47.1"/>' +
      '</svg>' +
      '</span>';
  }

  stop(): void {
    if (!this.loading) return;
    this.loading = false;

    this.el.removeAttribute('aria-busy');
    this.el.disabled = false;
    this.el.classList.remove('loading');

    if (this.originalHTML !== null) {
      this.el.innerHTML = this.originalHTML;
    }
    if (this.originalWidth !== null) {
      this.el.style.width = this.originalWidth;
    }
    this.originalHTML = null;
    this.originalWidth = null;
  }

  /**
   * Convenience: start loading, and stop when the provided promise settles.
   */
  bindTo<T>(promise: Promise<T>): Promise<T> {
    this.start();
    return promise.finally(() => this.stop());
  }
}
