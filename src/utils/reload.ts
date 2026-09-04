// Seam for the full page reload we do after saving plugin settings.
//
// It lives in its own module purely so tests can stub it with `jest.mock`:
// jsdom exposes `window.location` (and its `reload` method) as an unforgeable,
// non-configurable property, so it can be neither redefined nor spied on.
export const reloadPage = (): void => {
  window.location.reload();
};
