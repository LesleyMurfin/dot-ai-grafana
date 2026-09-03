import React from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2, renderMarkdown } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';

type Props = {
  text: string;
};

/** Grafana-sanitized GFM. Same family as Headlamp's MarkdownRenderer, no extra dep. */
export function ResponseMarkdown({ text }: Props) {
  const styles = useStyles2(getStyles);
  const html = renderMarkdown(text, { breaks: true });
  return <div className={styles.md} dangerouslySetInnerHTML={{ __html: html }} />;
}

const getStyles = (theme: GrafanaTheme2) => ({
  md: css`
    color: ${theme.colors.text.primary};
    font-size: ${theme.typography.body.fontSize};
    line-height: ${theme.typography.body.lineHeight};

    h1,
    h2,
    h3,
    h4 {
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
