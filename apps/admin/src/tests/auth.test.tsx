import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { RequireAuth } from '../auth/RequireAuth';
import { AppLayout } from '../components/layout/AppLayout';
import { emptyPage, mockFetch, renderWith } from './utils';

const tree = (
  <Routes>
    <Route path="/login" element={<p>login page</p>} />
    <Route
      path="/secret"
      element={
        <RequireAuth roles={['ADMIN', 'SUPERVISOR']}>
          <p>secret content</p>
        </RequireAuth>
      }
    />
  </Routes>
);

describe('route guards and role-based visibility', () => {
  it('redirects anonymous users to sign-in', () => {
    renderWith(tree, { role: null, route: '/secret' });
    expect(screen.getByText('login page')).toBeInTheDocument();
    expect(screen.queryByText('secret content')).not.toBeInTheDocument();
  });
  it('blocks roles that are not allowed', () => {
    renderWith(tree, { role: 'REVIEWER', route: '/secret' });
    expect(screen.getByRole('alert')).toHaveTextContent('Not authorised');
  });
  it('allows permitted roles', () => {
    renderWith(tree, { role: 'SUPERVISOR', route: '/secret' });
    expect(screen.getByText('secret content')).toBeInTheDocument();
  });
  it('hides audit navigation from reviewers', () => {
    mockFetch({ '/api/v1/': emptyPage });
    renderWith(
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="*" element={<p>x</p>} />
        </Route>
      </Routes>,
      { role: 'REVIEWER' },
    );
    expect(screen.queryByRole('link', { name: 'Audit history' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Alerts' })).toBeInTheDocument();
  });
});
