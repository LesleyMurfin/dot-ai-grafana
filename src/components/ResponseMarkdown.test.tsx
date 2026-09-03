import React from 'react';
import { render, screen } from '@testing-library/react';
import { ResponseMarkdown } from './ResponseMarkdown';

describe('ResponseMarkdown', () => {
  test('renders GFM list and emphasis', () => {
    render(<ResponseMarkdown text={'## Top issues\n\n1. **CrashLoop** on api\n2. OOM'} />);
    expect(screen.getByRole('heading', { name: /top issues/i })).toBeInTheDocument();
    expect(screen.getByText('CrashLoop')).toBeInTheDocument();
    expect(screen.getByText(/OOM/)).toBeInTheDocument();
    expect(document.querySelector('ol')).toBeTruthy();
    expect(document.querySelector('strong')).toBeTruthy();
  });
});
