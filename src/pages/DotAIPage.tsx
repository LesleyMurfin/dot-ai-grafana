import React, { FormEvent, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { PluginPage } from '@grafana/runtime';
import { Alert, Button, Field, Select, Spinner, TextArea, useStyles2 } from '@grafana/ui';
import { testIds } from '../components/testIds';
import { ASK_TIMEOUT_MESSAGE, callDotAITool, DotAITool } from '../utils/dotaiApi';

const TOOL_OPTIONS: Array<SelectableValue<DotAITool>> = [
  { label: 'Query', value: 'query', description: 'Natural language cluster questions' },
  { label: 'Remediate (analysis only)', value: 'remediate', description: 'AI issue analysis — no execute' },
];

function DotAIPage() {
  const styles = useStyles2(getStyles);
  const [tool, setTool] = useState<DotAITool>('query');
  const [intent, setIntent] = useState('');
  const [loading, setLoading] = useState(false);
  const [responseText, setResponseText] = useState('');
  const [error, setError] = useState<string | undefined>();

  const placeholder = useMemo(() => {
    return tool === 'query'
      ? 'Ask about cluster resources (plain language, no prefixes)'
      : 'Describe the issue for analysis (no execute)';
  }, [tool]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = intent.trim();
    if (!trimmed || loading) {
      return;
    }
    setLoading(true);
    setError(undefined);
    setResponseText('');
    try {
      const result = await callDotAITool(tool, trimmed);
      if (result.ok) {
        setResponseText(result.summary || '');
      } else {
        setError(result.errorMessage || ASK_TIMEOUT_MESSAGE);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const onIntentKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void onSubmit(event as unknown as FormEvent);
    }
  };

  return (
    <PluginPage>
      <div className={styles.wrap} data-testid={testIds.dotai.container}>
        {tool === 'remediate' && (
          <Alert title="Analysis only" severity="info">
            Remediate never executes changes. For operate/execute, use the Headlamp plugin.
          </Alert>
        )}
        <form className={styles.form} onSubmit={onSubmit}>
          <Field label="Tool">
            <div data-testid={testIds.dotai.tool}>
              <Select
                inputId="dotai-tool"
                options={TOOL_OPTIONS}
                value={TOOL_OPTIONS.find((o) => o.value === tool)}
                onChange={(v) => setTool((v.value as DotAITool) ?? 'query')}
                disabled={loading}
              />
            </div>
          </Field>
          <Field label={tool === 'query' ? 'Question' : 'Issue'}>
            <TextArea
              data-testid={testIds.dotai.intent}
              value={intent}
              onChange={(e) => setIntent(e.currentTarget.value)}
              onKeyDown={onIntentKeyDown}
              placeholder={placeholder}
              rows={6}
              disabled={loading}
            />
          </Field>
          <div className={styles.actions}>
            <Button type="submit" data-testid={testIds.dotai.submit} disabled={loading || !intent.trim()}>
              {tool === 'query' ? 'Ask' : 'Analyze'}
            </Button>
          </div>
        </form>
        {loading && (
          <div className={styles.loading} data-testid={testIds.dotai.loading}>
            <Spinner />
          </div>
        )}
        {error && (
          <div className={styles.block} data-testid={testIds.dotai.error}>
            <Alert title="Request failed" severity="error">
              {error}
            </Alert>
          </div>
        )}
        {responseText && (
          <div className={styles.response} data-testid={testIds.dotai.response}>
            <div className={styles.responseTitle}>Response</div>
            <pre className={styles.pre}>{responseText}</pre>
          </div>
        )}
      </div>
    </PluginPage>
  );
}

export default DotAIPage;

const getStyles = (theme: GrafanaTheme2) => ({
  wrap: css`
    max-width: 960px;
  `,
  form: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(1)};
  `,
  actions: css`
    display: flex;
    gap: ${theme.spacing(1)};
  `,
  loading: css`
    margin-top: ${theme.spacing(2)};
  `,
  block: css`
    margin-top: ${theme.spacing(2)};
  `,
  response: css`
    margin-top: ${theme.spacing(2)};
  `,
  responseTitle: css`
    font-weight: ${theme.typography.fontWeightMedium};
  `,
  pre: css`
    white-space: pre-wrap;
    font-family: ${theme.typography.fontFamilyMonospace};
  `,
});
