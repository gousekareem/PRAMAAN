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
    expect(screen.getAllByRole('link', { name: 'Exceptions' }).length).toBeGreaterThan(0);
  });
  it('shows field personnel only their own areas (navigation follows permissions)', () => {
    mockFetch({ '/api/v1/': emptyPage, '/api/v1/notifications': { items: [], unread: 0 } });
    renderWith(
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="*" element={<p>x</p>} />
        </Route>
      </Routes>,
      { role: 'HG' },
    );
    for (const name of ['My duties', 'Duty assignments', 'Train beats', 'Check-ins & presence', 'Account & sessions'])
      expect(screen.getAllByRole('link', { name }).length).toBeGreaterThan(0);
    for (const name of ['Overview', 'Personnel', 'Login accounts', 'Audit history', 'Reports', 'System status', 'Exceptions'])
      expect(screen.queryByRole('link', { name })).not.toBeInTheDocument();
  });
  it('gives the system administrator the administration section', () => {
    mockFetch({ '/api/v1/': emptyPage, '/api/v1/notifications': { items: [], unread: 0 } });
    renderWith(
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="*" element={<p>x</p>} />
        </Route>
      </Routes>,
      { role: 'ADMIN' },
    );
    for (const name of ['Login accounts', 'Duty policy & roles', 'System status', 'Audit history'])
      expect(screen.getAllByRole('link', { name }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: 'My duties' })).not.toBeInTheDocument();
  });
  it('guards pages by permission', () => {
    renderWith(
      <Routes>
        <Route path="/x" element={<RequireAuth anyOf={['users.manage']}><p>accounts</p></RequireAuth>} />
      </Routes>,
      { role: 'SI', route: '/x' },
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Not authorised');
  });
});
