import React, { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { PluginPage } from '@grafana/runtime';
import {
  Alert,
  Button,
  Collapse,
  Field,
  Select,
  Spinner,
  TextArea,
  useStyles2,
} from '@grafana/ui';
import { testIds } from '../components/testIds';
import { ResponseMarkdown } from '../components/ResponseMarkdown';
import { DotAITool } from '../utils/dotaiApi';
import { ASK_CANCELLED_MESSAGE, askErrorTitle } from '../utils/askErrors';
import { emptyThread, ToolThread } from '../utils/progressiveContext';
import { runAskOrchestrator } from '../utils/askOrchestrator';
import {
  fetchGitOpsStatus,
  gitopsReasonCopy,
  GitOpsProposal,
  GitOpsStatus,
  proposeGitOpsPR,
} from '../utils/gitopsApi';

const TOOL_OPTIONS: Array<SelectableValue<DotAITool>> = [
  { label: 'Query', value: 'query', description: 'Natural language cluster questions' },
  { label: 'Remediate (analysis only)', value: 'remediate', description: 'AI issue analysis — no execute' },
];

type Threads = Record<DotAITool, ToolThread>;

type DotAIPageProps = {
  showContext?: boolean;
  sendGrafanaEvidence?: boolean;
};

function DotAIPage({ showContext = true, sendGrafanaEvidence = true }: DotAIPageProps) {
  const styles = useStyles2(getStyles);
  const abortRef = useRef<AbortController | null>(null);
  const [tool, setTool] = useState<DotAITool>('query');
  const [intent, setIntent] = useState('');
  const [loading, setLoading] = useState(false);
  const [responseText, setResponseText] = useState('');
  const [currentOpen, setCurrentOpen] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [threads, setThreads] = useState<Threads>({
    query: emptyThread(),
    remediate: emptyThread(),
  });
  const [analysisResult, setAnalysisResult] = useState('');
  const [gitopsStatus, setGitopsStatus] = useState<GitOpsStatus | undefined>();
  const [proposing, setProposing] = useState(false);
  const [proposal, setProposal] = useState<GitOpsProposal | undefined>();
  const [proposeError, setProposeError] = useState<string | undefined>();

  const activeThread = threads[tool];

  const placeholder = useMemo(() => {
    if (tool === 'remediate') {
      return 'Describe the issue (e.g. why is checkout-api CrashLooping in prod?)';
    }
    return 'Ask about cluster resources (e.g. show failing pods in production)';
  }, [tool]);

  const runAsk = async (trimmed: string) => {
    if (!trimmed) {
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const thread = threads[tool];
    setLoading(true);
    setError(undefined);
    setResponseText('');
    setAnalysisResult('');
    setGitopsStatus(undefined);
    setProposal(undefined);
    setProposeError(undefined);
    try {
      const result = await runAskOrchestrator({
        tool,
        question: trimmed,
        thread,
        signal: ac.signal,
        skipStack: !sendGrafanaEvidence,
      });
      if (ac.signal.aborted) {
        setError(ASK_CANCELLED_MESSAGE);
        return;
      }
      setThreads((prev) => ({
        ...prev,
        [tool]: result.thread,
      }));
      if (result.ok) {
        setResponseText(result.summary);
        setIntent('');
        setAnalysisResult(tool === 'remediate' ? result.summary : '');
      } else {
        setError(result.errorMessage || 'Request failed');
        if (result.summary) {
          setResponseText(result.summary);
        }
      }
    } catch (e) {
      if (ac.signal.aborted) {
        setError(ASK_CANCELLED_MESSAGE);
        return;
      }
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      if (abortRef.current === ac) {
        abortRef.current = null;
      }
      setLoading(false);
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (loading) {
      return;
    }
    await runAsk(intent.trim());
  };

  const onCancel = () => {
    abortRef.current?.abort();
  };

  const onRetry = () => {
    void runAsk(intent.trim());
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
    setAnalysisResult('');
    setGitopsStatus(undefined);
    setProposal(undefined);
    setProposeError(undefined);
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
    setAnalysisResult('');
    setGitopsStatus(undefined);
    setProposal(undefined);
    setProposeError(undefined);
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
  const showPropose = tool === 'remediate' && Boolean(analysisResult) && !loading;

  useEffect(() => {
    if (!showPropose) {
      return;
    }
    let cancelled = false;
    fetchGitOpsStatus().then((status) => {
      if (!cancelled) {
        setGitopsStatus(status);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [showPropose, analysisResult]);

  const onPropose = async () => {
    if (!analysisResult || proposing || !gitopsStatus?.ready) {
      return;
    }
    setProposing(true);
    setProposeError(undefined);
    setProposal(undefined);
    try {
      const result = await proposeGitOpsPR(analysisResult);
      if (result.created || !result.dry) {
        setProposeError('Preview refused: the plugin must not create a pull request in this version.');
        return;
      }
      if (result.ok) {
        setProposal(result);
        return;
      }
      setProposeError(result.error || gitopsReasonCopy(result.reason || ''));
    } catch (e) {
      setProposeError(e instanceof Error ? e.message : 'Propose failed');
    } finally {
      setProposing(false);
    }
  };

  return (
    <PluginPage>
      <div className={styles.wrap} data-testid={testIds.dotai.container}>
        <Alert
          title={sendGrafanaEvidence ? 'What each Ask sends' : 'What each Ask sends (Grafana evidence off)'}
          severity="info"
          data-testid={testIds.dotai.consent}
        >
          {sendGrafanaEvidence
            ? 'Asks POST to your configured dot-ai server: your question, the session Current summary and Map of resource names, and a condensed Prior block of up to 240 characters built from your earlier questions and dot-ai\u2019s earlier answers (the question side can also carry follow-up instructions this page adds automatically). Query Asks that need live data replace Current with Grafana datasource facts read at that moment (Loki, Prometheus, Tempo, Alertmanager) instead of sending both; Remediate Asks read no datasource. Answers quote log, metric and alert lines verbatim, so anything credential-shaped in them is sent too. Full History stays in this browser.'
            : 'Send Grafana evidence is off, so Asks read no datasource. Asks still POST your question, the session Current summary and Map of resource names, and a condensed Prior block of up to 240 characters built from your earlier questions and dot-ai\u2019s earlier answers (the question side can also carry follow-up instructions this page adds automatically) \u2014 both quote log, metric and alert lines verbatim. The toggle does not cover Prior, Current or Map. Full History stays in this browser.'}
        </Alert>
        {tool === 'remediate' && (
          <Alert title="Analysis only" severity="info">
            Remediate never executes changes. For operate/execute, use the Headlamp plugin.
          </Alert>
        )}
        <form onSubmit={onSubmit} className={styles.form}>
          <Field label="Tool" description="Query cluster resources or request analysis-only remediation guidance.">
            <div data-testid={testIds.dotai.tool}>
              <Select
                options={TOOL_OPTIONS}
                value={TOOL_OPTIONS.find((o) => o.value === tool)}
                onChange={(v) => {
                  if (loading) {
                    return;
                  }
                  setTool((v.value as DotAITool) || 'query');
                  setResponseText('');
                  setAnalysisResult('');
                  setGitopsStatus(undefined);
                  setProposal(undefined);
                  setProposeError(undefined);
                  setError(undefined);
                }}
                inputId="dotai-tool"
                disabled={loading}
              />
            </div>
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
            {loading && (
              <Button type="button" variant="secondary" data-testid={testIds.dotai.cancel} onClick={onCancel}>
                Cancel
              </Button>
            )}
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
          <Alert title={askErrorTitle(error)} severity="error" data-testid={testIds.dotai.error} className={styles.block}>
            {error}
            {error !== ASK_CANCELLED_MESSAGE && (
              <div className={styles.actions}>
                <Button type="button" data-testid={testIds.dotai.retry} onClick={onRetry} disabled={loading || !intent.trim()}>
                  Retry
                </Button>
              </div>
            )}
          </Alert>
        )}

        {showContext && (activeThread.map || activeThread.drilldowns.length > 0) && (
          <div className={styles.context} data-testid={testIds.dotai.map}>
            <h3 className={styles.responseTitle}>Map</h3>
            {activeThread.drilldowns.length > 0 && (
              <div className={styles.drilldowns} data-testid={testIds.dotai.drilldown}>
                {activeThread.drilldowns.map((link) => (
                  <a
                    key={link.id}
                    className={styles.drilldownLink}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            )}
            {activeThread.map && <pre className={styles.pre}>{activeThread.map}</pre>}
          </div>
        )}

        {showContext && activeThread.current && (
          <div className={styles.context} data-testid={testIds.dotai.current}>
            <Collapse
              label={
                // ReactNode label, not a plain string, so e2e has one stable click
                // target for the toggle across the Grafana versions in the matrix —
                // Collapse's own header markup is not a contract.
                <span data-testid={testIds.dotai.currentToggle}>Current (Grafana evidence)</span>
              }
              collapsible={true}
              isOpen={currentOpen}
              onToggle={() => setCurrentOpen(!currentOpen)}
            >
              <pre className={styles.pre}>{activeThread.current}</pre>
            </Collapse>
          </div>
        )}

        {showContext && activeThread.history.length > 0 && (
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
            <ResponseMarkdown text={responseText} />
          </div>
        )}

        {showPropose && (
          <div className={styles.propose} data-testid={testIds.dotai.gitopsPropose}>
            <div className={styles.actions}>
              <Button
                type="button"
                variant="secondary"
                data-testid={testIds.dotai.gitopsProposeButton}
                disabled={!gitopsStatus?.ready || proposing}
                onClick={() => void onPropose()}
              >
                {proposing ? 'Preparing preview…' : 'Propose GitOps PR'}
              </Button>
            </div>
            {gitopsStatus && !gitopsStatus.ready && (
              <div className={styles.proposeReason} data-testid={testIds.dotai.gitopsProposeReason}>
                {gitopsReasonCopy(gitopsStatus.reason)}
              </div>
            )}
            {proposeError && (
              <Alert title="GitOps PR preview failed" severity="error" className={styles.block}>
                {proposeError}
              </Alert>
            )}
            {proposal && (
              <div className={styles.proposal} data-testid={testIds.dotai.gitopsProposal}>
                <h3 className={styles.responseTitle}>GitOps PR preview</h3>
                <p className={styles.proposeReason}>
                  Preview only — no pull request was created and nothing was applied to the cluster.
                </p>
                <div data-testid={testIds.dotai.gitopsProposalTitle}>
                  <div className={styles.proposalLabel}>Title</div>
                  <pre className={styles.pre}>{proposal.title}</pre>
                </div>
                <div data-testid={testIds.dotai.gitopsProposalBody}>
                  <div className={styles.proposalLabel}>Body</div>
                  <pre className={styles.pre}>{proposal.body}</pre>
                </div>
                <div data-testid={testIds.dotai.gitopsProposalDiff}>
                  <div className={styles.proposalLabel}>Diff</div>
                  {(proposal.files ?? []).map((file) => (
                    <div key={file.path}>
                      <div className={styles.proposalLabel}>{file.path}</div>
                      <pre className={styles.pre}>{file.diff}</pre>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
  drilldowns: css`
    display: flex;
    flex-wrap: wrap;
    gap: ${theme.spacing(1)};
    margin-bottom: ${theme.spacing(1)};
  `,
  drilldownLink: css`
    color: ${theme.colors.text.link};
  `,
  pre: css`
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: ${theme.typography.fontFamilyMonospace};
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
  propose: css`
    margin-top: ${theme.spacing(2)};
    padding: ${theme.spacing(2)};
    border: 1px solid ${theme.colors.border.weak};
    border-radius: ${theme.shape.radius.default};
  `,
  proposeReason: css`
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
    margin-bottom: ${theme.spacing(1)};
  `,
  proposal: css`
    margin-top: ${theme.spacing(1.5)};
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(1.5)};
  `,
  proposalLabel: css`
    font-weight: ${theme.typography.fontWeightMedium};
    margin-bottom: ${theme.spacing(0.5)};
  `,
});
