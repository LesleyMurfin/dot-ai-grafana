import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DotAIPage from './DotAIPage';
import { testIds } from '../components/testIds';
import { callDotAITool } from '../utils/dotaiApi';

jest.mock('../utils/dotaiApi', () => ({
  callDotAITool: jest.fn(),
}));

const mockCallDotAITool = callDotAITool as jest.MockedFunction<typeof callDotAITool>;

async function selectTool(label: string) {
  const combobox = screen.getByRole('combobox');
  fireEvent.keyDown(combobox, { key: 'ArrowDown', code: 'ArrowDown' });
  const option = await screen.findByText(label);
  fireEvent.click(option);
}

function typeIntent(value: string) {
  fireEvent.change(screen.getByTestId(testIds.dotai.intent), { target: { value } });
}

function clickSubmit() {
  fireEvent.click(screen.getByTestId(testIds.dotai.submit));
}

describe('Pages/DotAIPage', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('renders intent field and submit button', () => {
    render(<DotAIPage />);

    expect(screen.getByTestId(testIds.dotai.container)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.dotai.intent)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.dotai.submit)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.dotai.submit)).toBeDisabled();
    expect(screen.getByRole('button', { name: /ask/i })).toBeInTheDocument();
  });

  test('can switch tool selection to Remediate (analysis only)', async () => {
    render(<DotAIPage />);

    await selectTool('Remediate (analysis only)');

    expect(screen.getByText(/analysis only — this plugin never executes changes/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /analyze/i })).toBeInTheDocument();
  });

  test('submit calls query with trimmed intent', async () => {
    mockCallDotAITool.mockResolvedValue({
      ok: true,
      status: 200,
      summary: '3 pods failing',
      raw: {},
    });

    render(<DotAIPage />);
    typeIntent('  show failing pods  ');
    clickSubmit();

    await waitFor(() => {
      expect(mockCallDotAITool).toHaveBeenCalledTimes(1);
    });
    expect(mockCallDotAITool).toHaveBeenCalledWith('query', 'show failing pods');
  });

  test('success path renders response summary', async () => {
    mockCallDotAITool.mockResolvedValue({
      ok: true,
      status: 200,
      summary: 'cluster looks healthy',
      raw: {},
    });

    render(<DotAIPage />);
    typeIntent('how is the cluster?');
    clickSubmit();

    expect(await screen.findByTestId(testIds.dotai.response)).toHaveTextContent('cluster looks healthy');
    expect(screen.queryByTestId(testIds.dotai.error)).not.toBeInTheDocument();
  });

  test('error path shows error message', async () => {
    mockCallDotAITool.mockResolvedValue({
      ok: false,
      status: 500,
      summary: '',
      raw: {},
      errorMessage: 'llm unavailable',
    });

    render(<DotAIPage />);
    typeIntent('why are pods crashing?');
    clickSubmit();

    expect(await screen.findByTestId(testIds.dotai.error)).toHaveTextContent('llm unavailable');
  });

  test('loading state shows spinner and disables double-submit', async () => {
    let resolve!: (value: {
      ok: boolean;
      status: number;
      summary: string;
      raw: unknown;
    }) => void;
    const promise = new Promise<{
      ok: boolean;
      status: number;
      summary: string;
      raw: unknown;
    }>((r) => {
      resolve = r;
    });

    mockCallDotAITool.mockReturnValue(promise);

    render(<DotAIPage />);
    typeIntent('show nodes');
    clickSubmit();

    expect(await screen.findByTestId(testIds.dotai.loading)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.dotai.submit)).toBeDisabled();
    expect(screen.getByTestId(testIds.dotai.intent)).toBeDisabled();

    // Attempt a second submit while loading — guarded by disabled button + onSubmit loading check
    clickSubmit();
    expect(mockCallDotAITool).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve({ ok: true, status: 200, summary: 'ok', raw: {} });
    });


    await waitFor(() => {
      expect(screen.queryByTestId(testIds.dotai.loading)).not.toBeInTheDocument();
    });
    expect(await screen.findByTestId(testIds.dotai.response)).toHaveTextContent('ok');
  });

  test('remediate submit calls analysis-only tool without execute', async () => {
    mockCallDotAITool.mockResolvedValue({
      ok: true,
      status: 200,
      summary: 'restart deployment suggested',
      raw: {},
    });

    render(<DotAIPage />);
    await selectTool('Remediate (analysis only)');
    typeIntent('checkout-api CrashLooping');
    clickSubmit();

    await waitFor(() => {
      expect(mockCallDotAITool).toHaveBeenCalledTimes(1);
    });

    expect(mockCallDotAITool).toHaveBeenCalledWith('remediate', 'checkout-api CrashLooping');
    const [tool, intent] = mockCallDotAITool.mock.calls[0];
    expect(tool).toBe('remediate');
    expect(intent).not.toMatch(/execute/i);
    expect(JSON.stringify(mockCallDotAITool.mock.calls[0])).not.toMatch(/execute/i);

    expect(await screen.findByTestId(testIds.dotai.response)).toHaveTextContent(
      'restart deployment suggested'
    );
  });
});
