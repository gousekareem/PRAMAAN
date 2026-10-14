import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AlertsPage } from '../pages/AlertsPage';
import { DevicesPage } from '../pages/DevicesPage';
import { OverviewPage } from '../pages/OverviewPage';
import { emptyPage, mockFetch, renderWith } from './utils';
import type { Flag } from '../services/types';

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="map">{children}</div>
  ),
  TileLayer: () => null,
  GeoJSON: () => null,
  Circle: () => null,
  CircleMarker: ({
    children,
    eventHandlers,
  }: {
    children: React.ReactNode;
    eventHandlers: { click: () => void };
  }) => (
    <button type="button" data-testid="marker" onClick={eventHandlers.click}>
      {children}
    </button>
  ),
  Popup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const flag: Flag = {
  id: '11111111-1111-4111-8111-111111111111',
  flagType: 'CHECKIN_MISSED',
  severity: 'LOW',
  status: 'OPEN',
  title: 'Check-in not acknowledged',
  description: 'A missed check-in is a prompt for review, not evidence of misconduct.',
  officerId: null,
  officerName: 'DEMO Constable',
  deviceId: null,
  dutySessionId: null,
  eventId: null,
  evidenceId: null,
  inputs: { reasonCode: 'NO_RESPONSE' },
  assignedTo: null,
  assignedToName: null,
  resolutionNote: null,
  createdAt: '2026-10-01T08:00:00Z',
  isDemo: true,
};

describe('Alerts page', () => {
  it('lets a supervisor acknowledge a flag after confirmation', async () => {
    const calls = mockFetch({
      '/api/v1/dashboard/alerts': { ...emptyPage, items: [flag], total: 1 },
      '/api/v1/users/reviewers': { items: [] },
      [`/api/v1/alerts/${flag.id}`]: { id: flag.id, status: 'ACKNOWLEDGED' },
    });
    renderWith(<AlertsPage />, { role: 'SUPERVISOR' });
    expect(await screen.findByText('Check-in not acknowledged')).toBeInTheDocument();
    expect(screen.getByText('DEMO')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'PATCH')).toBe(true));
    const patch = calls.find((c) => c.init?.method === 'PATCH')!;
    expect(JSON.parse(String(patch.init!.body))).toEqual({ action: 'ACKNOWLEDGE' });
    expect(await screen.findByText(/recorded in the audit trail/)).toBeInTheDocument();
  });
  it('requires a note before resolving', async () => {
    mockFetch({
      '/api/v1/dashboard/alerts': { ...emptyPage, items: [flag], total: 1 },
      '/api/v1/users/reviewers': { items: [] },
    });
    renderWith(<AlertsPage />, { role: 'SUPERVISOR' });
    await userEvent.click(await screen.findByRole('button', { name: 'Resolve' }));
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Review note/), 'Officer attending incident (demo)');
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
  });
  it('shows no action controls to read-only reviewers', async () => {
    mockFetch({ '/api/v1/dashboard/alerts': { ...emptyPage, items: [flag], total: 1 } });
    renderWith(<AlertsPage />, { role: 'REVIEWER' });
    expect(await screen.findByText('Check-in not acknowledged')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).not.toBeInTheDocument();
  });
  it('shows API errors with the request id', async () => {
    mockFetch({
      '/api/v1/dashboard/alerts': () =>
        new Response(
          JSON.stringify({
            error: { code: 'DATABASE_UNAVAILABLE', message: 'Database down', requestId: 'req-9' },
          }),
          { status: 503 },
        ),
    });
    renderWith(<AlertsPage />, { role: 'SUPERVISOR' });
    expect(await screen.findByRole('alert')).toHaveTextContent('req-9');
  });
});

describe('Devices page', () => {
  const device = {
    id: 'd1',
    officerName: 'DEMO',
    label: 'Phone',
    platform: 'ANDROID',
    status: 'PENDING',
    keyFingerprint: 'f'.repeat(64),
    keyHardwareBacked: true,
    appVersion: '1.0.0',
    isDemo: true,
    registeredAt: '2026-10-01T00:00:00Z',
    approvedAt: null,
    revokedAt: null,
    revocationReason: null,
    lastSyncAt: null,
    lastSequence: null,
    lastEventHash: null,
  };
  it('shows approve/revoke only to administrators', async () => {
    mockFetch({ '/api/v1/devices': { ...emptyPage, items: [device], total: 1 } });
    const { unmount } = renderWith(<DevicesPage />, { role: 'SUPERVISOR' });
    expect(await screen.findByText('Phone')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    unmount();
    renderWith(<DevicesPage />, { role: 'ADMIN' });
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });
});

describe('Overview page', () => {
  it('renders loading then metrics', async () => {
    mockFetch({
      '/api/v1/dashboard/summary': {
        activeDutySessions: 2,
        devicesSeen30m: 1,
        activeDevices: 3,
        pendingDevices: 0,
        evidenceAwaitingUpload: 4,
        missedCheckins24h: 1,
        openFlags: 5,
        evidenceRequiringReview: 1,
        spatialExceptions: 2,
        lastBatchReceivedAt: null,
        systemHealth: { api: 'ok', database: 'ok' },
        generatedAt: '2026-10-01T00:00:00Z',
      },
      '/api/v1/dashboard/alerts': emptyPage,
    });
    renderWith(<OverviewPage />);
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('Loading');
    expect(await screen.findByText('1 / 3')).toBeInTheDocument();
    expect(screen.getByText('Evidence awaiting upload').nextSibling).toHaveTextContent('4');
    expect(await screen.findByText('No open review flags')).toBeInTheDocument();
  });
});

describe('Map page', () => {
  it('renders observations with explicit freshness and accuracy labels', async () => {
    const { MapPage } = await import('../pages/MapPage');
    mockFetch({
      '/api/v1/zones': { type: 'FeatureCollection', features: [] },
      '/api/v1/dashboard/observations': {
        generatedAt: '2026-10-01T10:00:00Z',
        items: [
          {
            officerId: 'o1',
            officerName: 'DEMO Constable',
            isDemo: true,
            eventId: 'e1',
            eventType: 'LOCATION_OBSERVED',
            latitude: 16.3004,
            longitude: 80.4505,
            horizontalAccuracyM: null,
            recordedDeviceTime: '2026-10-01T06:00:00Z',
            trustedTimeEstimate: null,
            serverReceivedAt: '2026-10-01T09:55:00Z',
            spatialResult: 'INSIDE_ASSIGNED_ZONE',
            mockIndicator: null,
            dutySessionId: null,
            verificationStatus: 'SIGNATURE_VALID',
            freshness: { label: 'DELAYED_SYNC', ageMs: 4 * 3600_000, syncDelayMs: 3.9 * 3600_000 },
          },
        ],
      },
    });
    renderWith(<MapPage />);
    const marker = await screen.findByTestId('marker');
    expect(marker).toHaveTextContent('Delayed synchronization');
    expect(marker).toHaveTextContent('Location accuracy unavailable');
    await userEvent.click(marker);
    expect(screen.getAllByText('Delayed synchronization').length).toBeGreaterThan(1);
    expect(screen.getAllByText('Inside assigned zone').length).toBeGreaterThanOrEqual(2); // filter option + detail badge
    expect(document.body.textContent).not.toMatch(/\blive\b/i);
  });
});
