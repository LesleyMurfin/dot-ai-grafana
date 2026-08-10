import React, { FormEvent, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { PluginPage } from '@grafana/runtime';
import {
  Alert,
  Button,
  Field,
  Select,
  Spinner,
  TextArea,
  useStyles2,
} from '@grafana/ui';
import { testIds } from '../components/testIds';
import { callDotAITool, DotAITool } from '../utils/dotaiApi';

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
    if (tool === 'remediate') {
      return 'Describe the issue (e.g. why is checkout-api CrashLooping in prod?)';
    }
    return 'Ask about cluster resources (e.g. show failing pods in production)';
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
      // D2: plain intent only — never prefix [visualization]
      const result = await callDotAITool(tool, trimmed);
      if (result.ok) {
        setResponseText(result.summary);
      } else {
        setError(result.errorMessage || 'Request failed');
        if (result.summary) {
          setResponseText(result.summary);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <PluginPage>
      <div className={styles.wrap} data-testid={testIds.dotai.container}>
        <form onSubmit={onSubmit} className={styles.form}>
          <Field label="Tool" description="Query cluster resources or request analysis-only remediation guidance.">
            <Select
              options={TOOL_OPTIONS}
              value={TOOL_OPTIONS.find((o) => o.value === tool)}
              onChange={(v) => setTool((v.value as DotAITool) || 'query')}
              inputId="dotai-tool"
            />
          </Field>

          <Field
            label={tool === 'remediate' ? 'Issue description' : 'Question'}
            description={
              tool === 'remediate'
                ? 'Analysis only — this plugin never executes changes.'
                : 'Plain-language intent sent to dot-ai query.'
            }
          >
            <TextArea
              data-testid={testIds.dotai.intent}
              value={intent}
              onChange={(e) => setIntent(e.currentTarget.value)}
              placeholder={placeholder}
              rows={5}
              disabled={loading}
            />
          </Field>

          <div className={styles.actions}>
            <Button
              type="submit"
              data-testid={testIds.dotai.submit}
              disabled={loading || !intent.trim()}
            >
              {loading ? 'Running…' : tool === 'remediate' ? 'Analyze' : 'Ask'}
            </Button>
            {loading && (
              <span className={styles.loading} data-testid={testIds.dotai.loading}>
                <Spinner inline={true} />
                Waiting for dot-ai…
              </span>
            )}
          </div>
        </form>

        {error && (
          <Alert title="Request failed" severity="error" data-testid={testIds.dotai.error} className={styles.block}>
            {error}
          </Alert>
        )}

        {responseText && (
          <div className={styles.response} data-testid={testIds.dotai.response}>
            <h3 className={styles.responseTitle}>Response</h3>
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
    align-items: center;
    gap: ${theme.spacing(2)};
    margin-bottom: ${theme.spacing(2)};
  `,
  loading: css`
    display: inline-flex;
    align-items: center;
    gap: ${theme.spacing(1)};
    color: ${theme.colors.text.secondary};
  `,
  block: css`
    margin-top: ${theme.spacing(2)};
  `,
  response: css`
    margin-top: ${theme.spacing(2)};
    padding: ${theme.spacing(2)};
    border: 1px solid ${theme.colors.border.weak};
    border-radius: ${theme.shape.radius.default};
    background: ${theme.colors.background.secondary};
  `,
  responseTitle: css`
    margin: 0 0 ${theme.spacing(1)} 0;
    font-size: ${theme.typography.h5.fontSize};
  `,
  pre: css`
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: ${theme.typography.fontFamilyMonospace};
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
});
