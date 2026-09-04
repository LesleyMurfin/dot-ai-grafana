// Jest setup provided by Grafana scaffolding
import './.config/jest-setup';

// https://jestjs.io/docs/manual-mocks#mocking-methods-which-are-not-implemented-in-jsdom
// @grafana/ui >= 11.5 renders `Select` (and other overlay components) inside a
// `ScrollContainer`, which constructs an `IntersectionObserver` on mount. jsdom
// does not implement it, so provide a minimal no-op stand-in.
class IntersectionObserverStub {
  constructor(_callback, options = {}) {
    this.root = options.root ?? null;
    this.rootMargin = options.rootMargin ?? '0px';
    this.thresholds = Array.isArray(options.threshold) ? options.threshold : [options.threshold ?? 0];
  }

  observe() {}

  unobserve() {}

  disconnect() {}

  takeRecords() {
    return [];
  }
}

Object.defineProperty(global, 'IntersectionObserver', {
  writable: true,
  value: IntersectionObserverStub,
});

Object.defineProperty(window, 'IntersectionObserver', {
  writable: true,
  value: IntersectionObserverStub,
});
