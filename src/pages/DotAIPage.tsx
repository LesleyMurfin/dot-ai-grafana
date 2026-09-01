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
import { ASK_TIMEOUT_MESSAGE, DotAITool } from '../utils/dotaiApi';
import { emptyThread, ToolThread } from '../utils/progressiveContext';
import { runAskOrchestrator } from '../utils/askOrchestrator';

const TOOL_OPTIONS: Array<SelectableValue<DotAITool>> = [
  { label: 'Query', value: 'query', description: 'Natural language cluster questions' },
  { label: 'Remediate (analysis only)', value: 'remediate', description: 'AI issue analysis — no execute' },
];

type Threads = Record<DotAITool, ToolThread>;

function DotAIPage() {
  const styles = useStyles2(getStyles);
  const [tool, setTool] = useState<DotAITool>('query');
  const [intent, setIntent] = useState('');
  const [loading, setLoading] = useState(false);
  const [responseText, setResponseText] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [threads, setThreads] = useState<Threads>({
    query: emptyThread(),
    remediate: emptyThread(),
  });

  const activeThread = threads[tool];

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

    const thread = threads[tool];
    setLoading(true);
    setError(undefined);
    setResponseText('');

    try {
      // M4: first-hop + loop (cap 3) via runAskOrchestrator. History never packed.
      // Observability → Grafana Current first; inventory → dot-ai first. Answer FROM Current.
      const result = await runAskOrchestrator({
        tool,
        question: trimmed,
        thread,
      });

      setThreads((prev) => ({
        ...prev,
        [tool]: result.thread,
      }));

      if (result.ok) {
        setResponseText(result.summary);
        setIntent('');
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

  const onClearThread = () => {
    if (loading) {
      return;
    }
    setThreads((prev) => ({
      ...prev,
      [tool]: emptyThread(),
    }));
    setResponseText('');
    setError(undefined);
  };

  const onAnalyzeThis = () => {
    if (loading) {
      return;
    }
    const queryCurrent = threads.query.current.trim();
    if (!queryCurrent) {
      return;
    }
    // Copy Current into Remediate box; Query History stays; analysis only.
    setTool('remediate');
    setIntent(queryCurrent);
    setError(undefined);
    setResponseText('');
  };

  const onIntentKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter submits; Shift+Enter keeps the default newline.
    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }
    event.preventDefault();
    if (loading || !intent.trim()) {
      return;
    }
    event.currentTarget.form?.requestSubmit();
  };

  const showAnalyzeThis = tool === 'query' && Boolean(threads.query.current.trim()) && !loading;

  return (
    <PluginPage>
      <div className={styles.wrap} data-testid={testIds.dotai.container}>
        <form onSubmit={onSubmit} className={styles.form}>
          <Field label="Tool" description="Query cluster resources or request analysis-only remediation guidance.">
            <Select
              options={TOOL_OPTIONS}
              value={TOOL_OPTIONS.find((o) => o.value === tool)}
              onChange={(v) => {
                if (loading) {
                  return;
                }
                setTool((v.value as DotAITool) || 'query');
                setResponseText('');
                setError(undefined);
              }}
              inputId="dotai-tool"
              disabled={loading}
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
              onKeyDown={onIntentKeyDown}
              placeholder={placeholder}
              rows={5}
              disabled={loading}
            />
          </Field>

          <div className={styles.actions}>
            <Button type="submit" data-testid={testIds.dotai.submit} disabled={loading || !intent.trim()}>
              {loading ? 'Running…' : tool === 'remediate' ? 'Analyze' : 'Ask'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              data-testid={testIds.dotai.clearThread}
              disabled={loading}
              onClick={onClearThread}
            >
              Clear thread
            </Button>
            {showAnalyzeThis && (
              <Button
                type="button"
                variant="secondary"
                data-testid={testIds.dotai.analyzeThis}
                disabled={loading}
                onClick={onAnalyzeThis}
              >
                Analyze this
              </Button>
            )}
            {loading && (
              <span className={styles.loading} data-testid={testIds.dotai.loading}>
                <Spinner inline={true} />
                Waiting for dot-ai…
              </span>
            )}
          </div>
        </form>

        {error && (
          <Alert
            title={error === ASK_TIMEOUT_MESSAGE ? 'Ask timed out' : 'Request failed'}
            severity="error"
            data-testid={testIds.dotai.error}
            className={styles.block}
          >
            {error}
          </Alert>
        )}

        {activeThread.current && (
          <div className={styles.context} data-testid={testIds.dotai.current}>
            <h3 className={styles.responseTitle}>Current</h3>
            <pre className={styles.pre}>{activeThread.current}</pre>
          </div>
        )}

        {activeThread.map && (
          <div className={styles.context} data-testid={testIds.dotai.map}>
            <h3 className={styles.responseTitle}>Map</h3>
            <pre className={styles.pre}>{activeThread.map}</pre>
          </div>
        )}

        {activeThread.history.length > 0 && (
          <div className={styles.history} data-testid={testIds.dotai.history}>
            <h3 className={styles.responseTitle}>History</h3>
            <ul className={styles.historyList}>
              {activeThread.history.map((turn, idx) => (
                <li key={`${turn.role}-${idx}`} className={styles.historyItem}>
                  <strong>{turn.role === 'you' ? 'You' : 'Answer'}:</strong> {turn.text}
                </li>
              ))}
            </ul>
          </div>
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
    flex-wrap: wrap;
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
  context: css`
    margin-top: ${theme.spacing(2)};
    padding: ${theme.spacing(1.5)};
    border: 1px solid ${theme.colors.border.weak};
    border-radius: ${theme.shape.radius.default};
    background: ${theme.colors.background.canvas};
  `,
  history: css`
    margin-top: ${theme.spacing(2)};
    padding: ${theme.spacing(1.5)};
    border: 1px solid ${theme.colors.border.weak};
    border-radius: ${theme.shape.radius.default};
  `,
  historyList: css`
    margin: 0;
    padding-left: ${theme.spacing(2)};
  `,
  historyItem: css`
    margin-bottom: ${theme.spacing(0.5)};
    word-break: break-word;
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
