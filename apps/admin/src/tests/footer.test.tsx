import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { AppFooter, COPYRIGHT_NOTICE, DEVELOPER_LINKEDIN } from '../components/layout/AppFooter';
import { AppLayout } from '../components/layout/AppLayout';
import { emptyPage, mockFetch, renderWith } from './utils';

describe('AppFooter', () => {
  it('shows the exact copyright notice and a safe LinkedIn attribution link', () => {
    render(<AppFooter />);
    expect(
      screen.getByText('© 2026 SHAIK GOUSE KAREEM. All Rights Reserved.'),
    ).toBeInTheDocument();
    expect(COPYRIGHT_NOTICE).toBe('© 2026 SHAIK GOUSE KAREEM. All Rights Reserved.');
    const link = screen.getByRole('link', { name: /Developed by SHAIK GOUSE KAREEM/ });
    expect(link).toHaveAttribute('href', 'https://www.linkedin.com/in/gousekareem/');
    expect(DEVELOPER_LINKEDIN).toBe('https://www.linkedin.com/in/gousekareem/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(
      screen.getByText(/Not commissioned, endorsed or operated by Guntur Railway Police/),
    ).toBeInTheDocument();
  });

  it.each([
    '/',
    '/map',
    '/officers',
    '/duties',
    '/duties/category/train-beats',
    '/roster',
    '/checkins',
    '/personnel',
    '/reports',
    '/my',
    '/account',
    '/evidence',
    '/alerts',
    '/audit',
    '/devices',
    '/admin/system',
  ])(
    'is rendered once by the shared layout on %s',
    (route) => {
      mockFetch({ '/api/v1/': emptyPage, '/api/v1/notifications': { items: [], unread: 0 } });
      renderWith(
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="*" element={<p>page body</p>} />
          </Route>
        </Routes>,
        { route },
      );
      expect(screen.getAllByRole('contentinfo')).toHaveLength(1);
      expect(
        screen.getByText('© 2026 SHAIK GOUSE KAREEM. All Rights Reserved.'),
      ).toBeInTheDocument();
      // Footer follows <main> in document order (not fixed over content).
      const main = screen.getByRole('main');
      expect(
        main.compareDocumentPosition(screen.getByRole('contentinfo')) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    },
  );
});
