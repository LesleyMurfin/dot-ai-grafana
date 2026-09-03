import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { testIds } from '../testIds';

describe('Components/App', () => {
  test('renders the DotAI tools page as default route', async () => {
    render(
      <App
        meta={{} as never}
        basename=""
        onNavChanged={() => undefined}
        query={{} as never}
        path=""
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId(testIds.dotai.container)).toBeInTheDocument();
    });
  });
});
