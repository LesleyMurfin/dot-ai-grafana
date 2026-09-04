// Jest setup provided by Grafana scaffolding
import './.config/jest-setup';

// jsdom does not implement IntersectionObserver, but @grafana/ui >= 11.6 renders
// Combobox through ScrollContainer, whose ScrollIndicators constructs one on mount.
// Without this, any test rendering a Combobox throws
// `ReferenceError: IntersectionObserver is not defined`.
// Inert on purpose: it never emits synthetic intersection records, so tests cannot
// come to depend on faked visibility state.
if (typeof globalThis.IntersectionObserver === 'undefined') {
  class IntersectionObserverStub {
    constructor(_callback, options = {}) {
      this.root = options.root ?? null;
      this.rootMargin = options.rootMargin ?? '0px';
      this.thresholds = Object.freeze(
        Array.isArray(options.threshold) ? [...options.threshold] : [options.threshold ?? 0]
      );
    }

    observe() {}

    unobserve() {}

    disconnect() {}

    takeRecords() {
      return [];
    }
  }

  globalThis.IntersectionObserver = IntersectionObserverStub;
}
