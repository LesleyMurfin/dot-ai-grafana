import React, { ChangeEvent, FormEvent, useState } from 'react';
import { lastValueFrom } from 'rxjs';
import { css } from '@emotion/css';
import { AppPluginMeta, GrafanaTheme2, PluginConfigPageProps, PluginMeta } from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { Alert, Button, Field, FieldSet, Input, SecretInput, Switch, useStyles2 } from '@grafana/ui';
import { testIds } from '../testIds';

export type AppPluginSettings = {
  apiUrl?: string;
  debugLog?: boolean;
  showContext?: boolean;
  sendGrafanaEvidence?: boolean;
  gitopsProvider?: string;
  gitopsOwner?: string;
  gitopsRepo?: string;
  gitopsBaseBranch?: string;
  gitopsApiUrl?: string;
};

export type GitopsJsonData = {
  gitopsProvider: string;
  gitopsOwner: string;
  gitopsRepo: string;
  gitopsBaseBranch: string;
  gitopsApiUrl: string;
};

/** Empty GitOps keys persisted on save so clearing a field actually clears it. */
export const emptyGitopsJsonData = (): GitopsJsonData => ({
  gitopsProvider: '',
  gitopsOwner: '',
  gitopsRepo: '',
  gitopsBaseBranch: '',
  gitopsApiUrl: '',
});

type State = {
  apiUrl: string;
  isApiKeySet: boolean;
  apiKey: string;
  debugLog: boolean;
  showContext: boolean;
  sendGrafanaEvidence: boolean;
  gitopsOwner: string;
  gitopsRepo: string;
  gitopsBaseBranch: string;
  gitopsApiUrl: string;
  gitopsPrToken: string;
  isGitopsPrTokenSet: boolean;
};

function persistGitopsJson(state: State): GitopsJsonData {
  const hasGitops = Boolean(
    state.gitopsOwner || state.gitopsRepo || state.gitopsApiUrl || state.gitopsPrToken || state.isGitopsPrTokenSet
  );
  if (!hasGitops) {
    return emptyGitopsJsonData();
  }
  return {
    gitopsProvider: 'github',
    gitopsOwner: state.gitopsOwner,
    gitopsRepo: state.gitopsRepo,
    gitopsBaseBranch: state.gitopsBaseBranch || 'main',
    gitopsApiUrl: state.gitopsApiUrl,
  };
}

function gitopsStatusCopy(state: State): string {
  const tokenPresent = Boolean(state.isGitopsPrTokenSet || state.gitopsPrToken);
  if (!state.gitopsOwner && !state.gitopsRepo && !tokenPresent) {
    return 'GitOps PR execute is off until owner, repo, and PR-create token are set.';
  }
  if (state.gitopsPrToken && state.apiKey && state.gitopsPrToken === state.apiKey) {
    return 'PR-create token must not be the analysis token. Execute stays off.';
  }
  if (!state.gitopsOwner) {
    return 'GitOps PR execute is off: missing owner.';
  }
  if (!state.gitopsRepo) {
    return 'GitOps PR execute is off: missing repo.';
  }
  if (!tokenPresent) {
    return 'GitOps PR execute is off: missing PR-create token.';
  }
  return 'GitOps credentials are set. PR create is not enabled in this version (M3). Query and Remediate still use the analysis token only.';
}

type TestStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

type TestConnectionPayload = {
  status?: string;
  message?: string;
  connected?: boolean;
};

export interface AppConfigProps extends PluginConfigPageProps<AppPluginMeta<AppPluginSettings>> {}

function readStringField(obj: unknown, key: string): string | undefined {
  if (!obj || typeof obj !== 'object' || !(key in obj)) {
    return undefined;
  }
  const value = (obj as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

function readBoolField(obj: unknown, key: string): boolean | undefined {
  if (!obj || typeof obj !== 'object' || !(key in obj)) {
    return undefined;
  }
  const value = (obj as Record<string, unknown>)[key];
  return typeof value === 'boolean' ? value : undefined;
}

function parseTestConnectionBody(body: unknown): TestConnectionPayload {
  // backendSrv.fetch resolves to FetchResponse; prefer .data when present.
  let payload: unknown = body;
  if (body && typeof body === 'object' && 'data' in body) {
    payload = (body as { data: unknown }).data;
  }

  return {
    status: readStringField(payload, 'status'),
    message: readStringField(payload, 'message'),
    connected: readBoolField(payload, 'connected'),
  };
}

function errorMessageFromUnknown(err: unknown): string {
  if (!err || typeof err !== 'object') {
    return 'Connection test failed';
  }
  if ('data' in err) {
    const nested = readStringField((err as { data: unknown }).data, 'message');
    if (nested) {
      return nested;
    }
  }
  const message = readStringField(err, 'message');
  if (message) {
    return message;
  }
  const statusText = readStringField(err, 'statusText');
  if (statusText) {
    return statusText;
  }
  return 'Connection test failed';
}

const AppConfig = ({ plugin }: AppConfigProps) => {
  const s = useStyles2(getStyles);
  const { enabled, pinned, jsonData, secureJsonFields } = plugin.meta;
  const [state, setState] = useState<State>({
    apiUrl: jsonData?.apiUrl || '',
    apiKey: '',
    isApiKeySet: Boolean(secureJsonFields?.apiKey),
    debugLog: Boolean(jsonData?.debugLog),
    showContext: jsonData?.showContext !== false,
    sendGrafanaEvidence: jsonData?.sendGrafanaEvidence !== false,
    gitopsOwner: jsonData?.gitopsOwner || '',
    gitopsRepo: jsonData?.gitopsRepo || '',
    gitopsBaseBranch: jsonData?.gitopsBaseBranch || '',
    gitopsApiUrl: jsonData?.gitopsApiUrl || '',
    gitopsPrToken: '',
    isGitopsPrTokenSet: Boolean(secureJsonFields?.gitopsPrToken),
  });
  const [testStatus, setTestStatus] = useState<TestStatus>({ kind: 'idle' });

  const isSubmitDisabled = Boolean(!state.apiUrl || (!state.isApiKeySet && !state.apiKey));
  const isTestDisabled = Boolean(!state.apiUrl || (!state.isApiKeySet && !state.apiKey) || testStatus.kind === 'loading');

  const onResetApiKey = () =>
    setState({
      ...state,
      apiKey: '',
      isApiKeySet: false,
    });

  const onResetGitopsPrToken = () =>
    setState({
      ...state,
      gitopsPrToken: '',
      isGitopsPrTokenSet: false,
    });

  const buildSecureJsonData = (): { apiKey?: string; gitopsPrToken?: string } | undefined => {
    const secure: { apiKey?: string; gitopsPrToken?: string } = {};
    if (!state.isApiKeySet) {
      secure.apiKey = state.apiKey;
    }
    if (!state.isGitopsPrTokenSet && state.gitopsPrToken) {
      secure.gitopsPrToken = state.gitopsPrToken;
    }
    return Object.keys(secure).length > 0 ? secure : undefined;
  };

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    setState({
      ...state,
      [event.target.name]: event.target.value.trim(),
    });
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitDisabled) {
      return;
    }

    updatePluginAndReload(plugin.meta.id, {
      enabled,
      pinned,
      jsonData: {
        apiUrl: state.apiUrl,
        debugLog: state.debugLog,
        showContext: state.showContext,
        sendGrafanaEvidence: state.sendGrafanaEvidence,
        ...persistGitopsJson(state),
      },
      // Secrets cannot be queried later by the frontend.
      // Omit a key when it was set previously and left untouched.
      secureJsonData: buildSecureJsonData(),
    });
  };

  const onTestConnection = async () => {
    if (isTestDisabled) {
      return;
    }

    setTestStatus({ kind: 'loading' });
    try {
      const data: { apiUrl: string; apiKey?: string } = { apiUrl: state.apiUrl };
      if (state.apiKey) {
        data.apiKey = state.apiKey;
      }

      const response = await getBackendSrv().fetch({
        url: `/api/plugins/${plugin.meta.id}/resources/test-connection`,
        method: 'POST',
        data,
        showErrorAlert: false,
        showSuccessAlert: false,
      });

      const body = await lastValueFrom(response as unknown as Parameters<typeof lastValueFrom>[0]);
      const payload = parseTestConnectionBody(body);

      if (payload.status === 'ok') {
        const message =
          payload.message ||
          (payload.connected === false
            ? 'dot-ai responded but Kubernetes reports not connected'
            : 'Connection successful');
        setTestStatus({ kind: 'success', message });
        return;
      }

      setTestStatus({ kind: 'error', message: payload.message || 'Connection test failed' });
    } catch (e) {
      setTestStatus({ kind: 'error', message: errorMessageFromUnknown(e) });
    }
  };

  return (
    <form onSubmit={onSubmit}>
      <FieldSet label="dot-ai API Settings">
        <Field
          label="Auth Token"
          description="Bearer token for the dot-ai REST API (stored encrypted). Use a no-apply token — analysis only."
        >
          <SecretInput
            width={60}
            id="config-api-key"
            data-testid={testIds.appConfig.apiKey}
            name="apiKey"
            value={state.apiKey}
            isConfigured={state.isApiKeySet}
            placeholder="Dot-ai auth token"
            onChange={onChange}
            onReset={onResetApiKey}
          />
        </Field>

        <Field
          label="MCP Server URL"
          description="Dot-ai REST base URL (e.g. http://dot-ai.namespace.svc:3456). No /api/v1 suffix required."
          className={s.marginTop}
        >
          <Input
            width={60}
            name="apiUrl"
            id="config-api-url"
            data-testid={testIds.appConfig.apiUrl}
            value={state.apiUrl}
            placeholder="http://dot-ai:3456"
            onChange={onChange}
          />
        </Field>

        <Field
          label="Debug Log"
          description="Write one JSON line per query/remediate hop to /var/lib/grafana/dotai-ask.log (no tokens). Off by default."
          className={s.marginTop}
        >
          <span>
            <Switch
              data-testid={testIds.appConfig.debugLog}
              value={state.debugLog}
              onChange={(event) => {
                setState({ ...state, debugLog: event.currentTarget.checked });
              }}
            />
          </span>
        </Field>

        <Field
          label="Show context"
          description="Show Current, Map, and History on the page. Packing still runs when this is off. On by default."
          className={s.marginTop}
        >
          <span>
            <Switch
              data-testid={testIds.appConfig.showContext}
              value={state.showContext}
              onChange={(event) => {
                setState({ ...state, showContext: event.currentTarget.checked });
              }}
            />
          </span>
        </Field>

        <Field
          label="Send Grafana evidence"
          description="When on, Query reads Loki/Prometheus/Tempo/Alertmanager and packs those facts into the Ask. When off, no datasource is read — the question, the session Current summary, Map of resource names, and the condensed Prior block (up to 240 chars of earlier questions and answers, where the question side can also carry follow-up instructions this page adds automatically) are still sent. On by default."
          className={s.marginTop}
        >
          <span>
            <Switch
              data-testid={testIds.appConfig.sendGrafanaEvidence}
              value={state.sendGrafanaEvidence}
              onChange={(event) => {
                setState({ ...state, sendGrafanaEvidence: event.currentTarget.checked });
              }}
            />
          </span>
        </Field>

        {testStatus.kind === 'success' && (
          <Alert title="Connection OK" severity="success" className={s.marginTop} data-testid={testIds.appConfig.testStatus}>
            {testStatus.message}
          </Alert>
        )}
        {testStatus.kind === 'error' && (
          <Alert title="Connection failed" severity="error" className={s.marginTop} data-testid={testIds.appConfig.testStatus}>
            {testStatus.message}
          </Alert>
        )}

        <div className={s.buttonRow}>
          <Button type="submit" data-testid={testIds.appConfig.submit} disabled={isSubmitDisabled}>
            Save API settings
          </Button>
          <Button
            type="button"
            variant="secondary"
            data-testid={testIds.appConfig.testConnection}
            disabled={isTestDisabled}
            onClick={onTestConnection}
          >
            {testStatus.kind === 'loading' ? 'Testing…' : 'Test connection'}
          </Button>
        </div>
      </FieldSet>

      <FieldSet label="GitOps PR credentials">
        <p className={s.colorWeak}>
          Optional. Query and Remediate keep using the no-apply analysis token and work when these
          fields are empty. The PR-create token is stored separately and is not used to call
          dot-ai. Execute stays off until owner, repo, and a distinct PR-create token are set. This
          version does not open pull requests yet.
        </p>
        <Alert title="GitOps execute" severity="info" className={s.marginTop} data-testid={testIds.appConfig.gitopsStatus}>
          {gitopsStatusCopy(state)}
        </Alert>
        <Field label="Provider" description="GitHub only in this version (GitLab is undecided).">
          <Input
            width={60}
            id="config-gitops-provider"
            data-testid={testIds.appConfig.gitopsProvider}
            name="gitopsProvider"
            value="github"
            disabled
            readOnly
          />
        </Field>
        <Field label="Owner" description="GitHub org or user that owns the GitOps repo." className={s.marginTop}>
          <Input
            width={60}
            id="config-gitops-owner"
            data-testid={testIds.appConfig.gitopsOwner}
            name="gitopsOwner"
            value={state.gitopsOwner}
            placeholder="acme"
            onChange={onChange}
          />
        </Field>
        <Field label="Repository" description="GitOps repository name (not owner/repo combined)." className={s.marginTop}>
          <Input
            width={60}
            id="config-gitops-repo"
            data-testid={testIds.appConfig.gitopsRepo}
            name="gitopsRepo"
            value={state.gitopsRepo}
            placeholder="gitops-prod"
            onChange={onChange}
          />
        </Field>
        <Field label="Base branch" description="Branch PRs will target. Defaults to main when other GitOps fields are set." className={s.marginTop}>
          <Input
            width={60}
            id="config-gitops-base-branch"
            data-testid={testIds.appConfig.gitopsBaseBranch}
            name="gitopsBaseBranch"
            value={state.gitopsBaseBranch}
            placeholder="main"
            onChange={onChange}
          />
        </Field>
        <Field
          label="GitHub API URL"
          description="Leave empty for api.github.com. Reserved for GitHub Enterprise (used when PR create lands)."
          className={s.marginTop}
        >
          <Input
            width={60}
            id="config-gitops-api-url"
            data-testid={testIds.appConfig.gitopsApiUrl}
            name="gitopsApiUrl"
            value={state.gitopsApiUrl}
            placeholder="https://api.github.com"
            onChange={onChange}
          />
        </Field>
        <Field
          label="PR-create token"
          description="GitHub token with contents and pull-requests write on the GitOps repo only. Must not be the analysis token. Stored encrypted. Unused until PR create is implemented."
          className={s.marginTop}
        >
          <SecretInput
            width={60}
            id="config-gitops-pr-token"
            data-testid={testIds.appConfig.gitopsPrToken}
            name="gitopsPrToken"
            value={state.gitopsPrToken}
            isConfigured={state.isGitopsPrTokenSet}
            placeholder="GitHub PR-create token"
            onChange={onChange}
            onReset={onResetGitopsPrToken}
          />
        </Field>
      </FieldSet>
    </form>
  );
};

export default AppConfig;

const getStyles = (theme: GrafanaTheme2) => ({
  colorWeak: css`
    color: ${theme.colors.text.secondary};
  `,
  marginTop: css`
    margin-top: ${theme.spacing(3)};
  `,
  buttonRow: css`
    display: flex;
    gap: ${theme.spacing(1)};
    margin-top: ${theme.spacing(3)};
  `,
});

const updatePluginAndReload = async (pluginId: string, data: Partial<PluginMeta<AppPluginSettings>>) => {
  try {
    await updatePlugin(pluginId, data);

    // Reloading the page as the changes made here wouldn't be propagated to the actual plugin otherwise.
    // This is not ideal, however unfortunately currently there is no supported way for updating the plugin state.
    window.location.reload();
  } catch (e) {
    console.error('Error while updating the plugin', e);
  }
};

const updatePlugin = async (pluginId: string, data: Partial<PluginMeta>) => {
  const response = await getBackendSrv().fetch({
    url: `/api/plugins/${pluginId}/settings`,
    method: 'POST',
    data,
  });

  // Cast: @grafana/data@11.4 nests its own rxjs types; dual-package with root rxjs breaks tsc.
  return lastValueFrom(response as unknown as Parameters<typeof lastValueFrom>[0]);
};
