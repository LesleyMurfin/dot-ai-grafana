import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PluginType } from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { of } from 'rxjs';
import AppConfig, { AppConfigProps } from './AppConfig';
import { testIds } from 'components/testIds';

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: jest.fn(),
}));

const mockGetBackendSrv = getBackendSrv as jest.MockedFunction<typeof getBackendSrv>;

describe('Components/AppConfig', () => {
  let props: AppConfigProps;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    jest.resetAllMocks();

    mockFetch = jest.fn();
    mockGetBackendSrv.mockReturnValue({ fetch: mockFetch } as never);

    props = {
      plugin: {
        meta: {
          id: 'sample-app',
          name: 'Sample App',
          type: PluginType.app,
          enabled: true,
          jsonData: {},
        },
      },
      query: {},
    } as unknown as AppConfigProps;
  });

  test('renders API settings with auth token, URL, save and test connection', () => {
    const plugin = { meta: { ...props.plugin.meta, enabled: false } };

    // @ts-ignore - We don't need to provide `addConfigPage()` and `setChannelSupport()` for these tests
    render(<AppConfig plugin={plugin} query={props.query} />);

    expect(screen.queryByRole('group', { name: /dot-ai api settings/i })).toBeInTheDocument();
    expect(screen.queryByTestId(testIds.appConfig.apiKey)).toBeInTheDocument();
    expect(screen.queryByTestId(testIds.appConfig.apiUrl)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save api settings/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /test connection/i })).toBeInTheDocument();
    expect(screen.queryByTestId(testIds.appConfig.testConnection)).toBeInTheDocument();
  });

  test('disables test connection until url and token are present', () => {
    const plugin = { meta: { ...props.plugin.meta, enabled: true, jsonData: {} } };

    // @ts-ignore
    render(<AppConfig plugin={plugin} query={props.query} />);

    expect(screen.getByTestId(testIds.appConfig.testConnection)).toBeDisabled();
  });

  test('error status without message shows Connection test failed, not Connection successful', async () => {
    mockFetch.mockReturnValue(of({ data: { status: 'error' } }));

    const plugin = {
      meta: {
        ...props.plugin.meta,
        enabled: true,
        jsonData: { apiUrl: 'http://dot-ai:3456' },
        secureJsonFields: { apiKey: true },
      },
    };

    // @ts-ignore
    render(<AppConfig plugin={plugin} query={props.query} />);

    fireEvent.click(screen.getByTestId(testIds.appConfig.testConnection));

    const status = await screen.findByTestId(testIds.appConfig.testStatus);
    expect(status).toHaveTextContent('Connection test failed');
    expect(status).not.toHaveTextContent('Connection successful');
    expect(screen.getByText('Connection failed')).toBeInTheDocument();
  });

  test('ok status with empty message falls back to Connection successful', async () => {
    mockFetch.mockReturnValue(of({ data: { status: 'ok' } }));

    const plugin = {
      meta: {
        ...props.plugin.meta,
        enabled: true,
        jsonData: { apiUrl: 'http://dot-ai:3456' },
        secureJsonFields: { apiKey: true },
      },
    };

    // @ts-ignore
    render(<AppConfig plugin={plugin} query={props.query} />);

    fireEvent.click(screen.getByTestId(testIds.appConfig.testConnection));

    const status = await screen.findByTestId(testIds.appConfig.testStatus);
    expect(status).toHaveTextContent('Connection successful');
    expect(screen.getByText('Connection OK')).toBeInTheDocument();
  });

  test('ok status with connected false keeps not-connected wording', async () => {
    mockFetch.mockReturnValue(of({ data: { status: 'ok', connected: false } }));

    const plugin = {
      meta: {
        ...props.plugin.meta,
        enabled: true,
        jsonData: { apiUrl: 'http://dot-ai:3456' },
        secureJsonFields: { apiKey: true },
      },
    };

    // @ts-ignore
    render(<AppConfig plugin={plugin} query={props.query} />);

    fireEvent.click(screen.getByTestId(testIds.appConfig.testConnection));

    await waitFor(() => {
      expect(screen.getByTestId(testIds.appConfig.testStatus)).toHaveTextContent(
        'dot-ai responded but Kubernetes reports not connected'
      );
    });
  });

  test('submit saves apiUrl and omits secureJsonData when key is already stored', async () => {
    mockFetch.mockReturnValue(of({ data: {} }));
    const reloadMock = jest.fn();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { reload: reloadMock },
    });

    const plugin = {
      meta: {
        ...props.plugin.meta,
        id: 'sample-app',
        enabled: true,
        pinned: false,
        jsonData: { apiUrl: 'http://dot-ai:3456' },
        secureJsonFields: { apiKey: true },
      },
    };

    // @ts-ignore
    render(<AppConfig plugin={plugin} query={props.query} />);

    fireEvent.click(screen.getByTestId(testIds.appConfig.submit));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.objectContaining({ url: '/api/plugins/sample-app/settings', method: 'POST' })
      );
    });

    const call = mockFetch.mock.calls.find(([opts]) => opts.url === '/api/plugins/sample-app/settings');
    expect(call).toBeDefined();
    expect(call![0].data.jsonData).toEqual({
      apiUrl: 'http://dot-ai:3456',
      debugLog: false,
      showContext: true,
    });
    expect(call![0].data.secureJsonData).toBeUndefined();

    await waitFor(() => {
      expect(reloadMock).toHaveBeenCalled();
    });
  });

  test('submit sends a newly typed auth token as secureJsonData', async () => {
    mockFetch.mockReturnValue(of({ data: {} }));
    const reloadMock = jest.fn();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { reload: reloadMock },
    });

    const plugin = {
      meta: {
        ...props.plugin.meta,
        id: 'sample-app',
        enabled: true,
        pinned: false,
        jsonData: { apiUrl: 'http://dot-ai:3456' },
      },
    };

    // @ts-ignore
    render(<AppConfig plugin={plugin} query={props.query} />);

    fireEvent.change(screen.getByTestId(testIds.appConfig.apiKey), {
      target: { value: 'new-secret-token' },
    });
    fireEvent.click(screen.getByTestId(testIds.appConfig.submit));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.objectContaining({ url: '/api/plugins/sample-app/settings', method: 'POST' })
      );
    });

    const call = mockFetch.mock.calls.find(([opts]) => opts.url === '/api/plugins/sample-app/settings');
    expect(call).toBeDefined();
    expect(call![0].data.secureJsonData).toEqual({ apiKey: 'new-secret-token' });

    await waitFor(() => {
      expect(reloadMock).toHaveBeenCalled();
    });
  });

  test('submit persists Debug Log on and Show context off', async () => {
    mockFetch.mockReturnValue(of({ data: {} }));
    const reloadMock = jest.fn();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { reload: reloadMock },
    });

    const plugin = {
      meta: {
        ...props.plugin.meta,
        id: 'sample-app',
        enabled: true,
        pinned: false,
        jsonData: { apiUrl: 'http://dot-ai:3456' },
        secureJsonFields: { apiKey: true },
      },
    };

    // @ts-ignore
    render(<AppConfig plugin={plugin} query={props.query} />);

    fireEvent.click(within(screen.getByTestId(testIds.appConfig.debugLog)).getByRole('checkbox'));
    fireEvent.click(within(screen.getByTestId(testIds.appConfig.showContext)).getByRole('checkbox'));
    fireEvent.click(screen.getByTestId(testIds.appConfig.submit));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    const call = mockFetch.mock.calls.find(([opts]) => opts.url === '/api/plugins/sample-app/settings');
    expect(call).toBeDefined();
    expect(call![0].data.jsonData).toEqual({
      apiUrl: 'http://dot-ai:3456',
      debugLog: true,
      showContext: false,
    });
  });

});
