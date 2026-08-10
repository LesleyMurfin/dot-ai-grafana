import React from 'react';
import { render, screen } from '@testing-library/react';
import { PluginType } from '@grafana/data';
import AppConfig, { AppConfigProps } from './AppConfig';
import { testIds } from 'components/testIds';

describe('Components/AppConfig', () => {
  let props: AppConfigProps;

  beforeEach(() => {
    jest.resetAllMocks();

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
});
