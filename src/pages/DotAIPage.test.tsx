import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import DotAIPage from './DotAIPage';
import { testIds } from '../components/testIds';
import { ASK_TIMEOUT_MESSAGE, callDotAITool } from '../utils/dotaiApi';

jest.mock('../utils/dotaiApi', () => ({
  ...jest.requireActual('../utils/dotaiApi'),
  callDotAITool: jest.fn(),
}));

const mockCallDotAITool = callDotAITool as jest.MockedFunction<typeof callDotAITool>;

const ok = (summary: string) => ({
  ok: true,
  status: 200,
  summary,
  raw: {},
  errorMessage: '',
});

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
    mockCallDotAITool.mockReset();
  });

  test('query POSTs a single plain-language intent', async () => {
    mockCallDotAITool.mockResolvedValue(ok('3 failing pods'));

    render(<DotAIPage />);
    typeIntent('list failing pods');
    clickSubmit();

    await waitFor(() => expect(mockCallDotAITool).toHaveBeenCalledTimes(1));
    expect(mockCallDotAITool).toHaveBeenCalledWith('query', 'list failing pods');
    expect(await screen.findByTestId(testIds.dotai.response)).toHaveTextContent('3 failing pods');
    expect(screen.queryByTestId(testIds.dotai.current)).not.toBeInTheDocument();
    expect(screen.queryByTestId(testIds.dotai.history)).not.toBeInTheDocument();
  });

  test('remediate is analysis-only and shows the banner', async () => {
    mockCallDotAITool.mockResolvedValue(ok('CrashLoop likely OOM'));

    render(<DotAIPage />);
    await selectTool('Remediate (analysis only)');
    expect(screen.getByText(/never executes changes/i)).toBeInTheDocument();
    typeIntent('CrashLoopBackOff on api');
    clickSubmit();

    await waitFor(() => expect(mockCallDotAITool).toHaveBeenCalledTimes(1));
    expect(mockCallDotAITool).toHaveBeenCalledWith('remediate', 'CrashLoopBackOff on api');
    expect(screen.queryByRole('button', { name: /execute/i })).not.toBeInTheDocument();
  });

  test('maps tool errors into the alert', async () => {
    mockCallDotAITool.mockResolvedValue({
      ok: false,
      status: 502,
      summary: '',
      raw: {},
      errorMessage: 'dot-ai unreachable (502)',
    });

    render(<DotAIPage />);
    typeIntent('list pods');
    clickSubmit();

    expect(await screen.findByTestId(testIds.dotai.error)).toHaveTextContent('dot-ai unreachable (502)');
  });

  test('timeout result shows the 120s plugin-limit message', async () => {
    mockCallDotAITool.mockResolvedValue({
      ok: false,
      status: 504,
      summary: '',
      raw: {},
      errorMessage: ASK_TIMEOUT_MESSAGE,
    });

    render(<DotAIPage />);
    typeIntent('why is this slow');
    clickSubmit();

    expect(await screen.findByTestId(testIds.dotai.error)).toHaveTextContent(ASK_TIMEOUT_MESSAGE);
  });
});
