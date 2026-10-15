import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { DutyAssignmentsPage } from '../pages/DutyAssignmentsPage';
import { DutyDetailPage } from '../pages/DutyDetailPage';
import { RosterPage } from '../pages/RosterPage';
import { CheckinsPage } from '../pages/CheckinsPage';
import { ReportsPage } from '../pages/ReportsPage';
import { MyDutiesPage } from '../pages/MyDutiesPage';
import { SystemStatusPage } from '../pages/SystemStatusPage';
import { emptyPage, mockFetch, renderWith } from './utils';
import type { DutyDetail, DutyListItem } from '../services/types';
import { t, tCode } from '../i18n';

const listItem: DutyListItem = {
  id: 'c0000000-0000-4000-8000-000000000007',
  referenceCode: 'DEMO-VE-20261016-001',
  category: 'VIP_ESCORT',
  categoryLabel: 'VIP Escort',
  isRestricted: true,
  detailsVisible: false,
  title: 'VIP Escort (restricted details)',
  unitId: 'u1',
  unitName: 'DEMO Guntur Circle (fictional unit)',
  plannedStart: '2026-10-16T03:30:00Z',
  plannedEnd: '2026-10-16T09:30:00Z',
  status: 'ASSIGNED',
  reportingLocation: null,
  trainRef: null,
  stationName: null,
  escortLabel: null,
  incidentRef: null,
  supervisorName: 'Ravuri Suresh Babu',
  isDemo: true,
  personnel: [
    { personnelId: 'p1', officerId: 'o1', name: 'Pasupuleti Divya', personnelClass: 'PC_AR', roleInDuty: 'MEMBER', status: 'ASSIGNED' },
    { personnelId: 'p2', officerId: 'o2', name: 'Bandaru Sravani', personnelClass: 'HG', roleInDuty: 'MEMBER', status: 'ASSIGNED' },
  ],
  openExceptions: 1,
  openConflicts: 1,
  checkinsAcknowledged: 0,
  checkinsMissed: 0,
};

const detail: DutyDetail = {
  ...listItem,
  category: 'TRAIN_BEAT',
  isRestricted: false,
  detailsVisible: true,
  title: 'DEMO train beat',
  trainRef: 'DEMO-TRN-205 (synthetic)',
  notes: null,
  acceptRequired: false,
  supervisorOfficerId: null,
  stationUnitId: null,
  completionNote: null,
  completedAt: null,
  cancelledReason: null,
  createdByName: 'Ravuri Suresh Babu',
  version: 3,
  checkinPolicy: { minIntervalMin: 60, maxIntervalMin: 120, responseWindowSec: 180, reportingWindowMin: 30, graceMin: 10 },
  personnelHistory: [
    {
      personnelId: 'p1', officerId: 'o1', name: 'Vemuri Anil Kumar', personnelRef: 'DEMO-PC-0021', personnelClass: 'PC_AR', roleInDuty: 'LEAD', status: 'ASSIGNED',
      assignedAt: '2026-10-15T00:00:00Z', acceptedAt: null, removedAt: null, removalReason: null, conflictOverrideReason: null, isActive: true,
      dutySessionId: 's1', sessionStatus: 'ACTIVE', deviceReportedStart: '2026-10-15T02:35:00Z', serverReceivedStart: '2026-10-15T02:41:00Z',
      deviceReportedEnd: null, checkinsAcknowledged: 2, checkinsLate: 0, checkinsMissed: 1, lastDeviceSyncAt: '2026-10-15T05:00:00Z',
    },
    {
      personnelId: 'p9', officerId: 'o9', name: 'Kotha Sirisha', personnelRef: 'DEMO-PC-0022', personnelClass: 'PC_AR', roleInDuty: 'MEMBER', status: 'REPLACED',
      assignedAt: '2026-10-15T00:00:00Z', acceptedAt: null, removedAt: '2026-10-15T01:00:00Z', removalReason: 'Shift swap requested', conflictOverrideReason: null,
      isActive: true, dutySessionId: null, sessionStatus: 'CANCELLED', deviceReportedStart: null, serverReceivedStart: null, deviceReportedEnd: null,
      checkinsAcknowledged: 0, checkinsLate: 0, checkinsMissed: 0, lastDeviceSyncAt: null,
    },
  ],
  instructions: [
    { id: 'i2', version: 2, body: 'Report to the synthetic Platform 3 marker.', bodySha256: 'a'.repeat(64), publishedAt: '2026-10-15T01:00:00Z', publishedByName: 'SI', acknowledgements: [] },
  ],
  handovers: [],
  changes: [
    { id: 'ch1', changeType: 'PERSONNEL_REPLACED', before: { status: 'ASSIGNED' }, after: { status: 'REPLACED' }, reason: 'Shift swap requested', occurredAt: '2026-10-15T01:00:00Z', actorName: 'Ravuri Suresh Babu' },
  ],
  exceptions: [],
  evidence: [],
  warnings: ['No supervising officer recorded (configured as expected for Train Beat).'],
  myAssignment: null,
  actions: {
    allowedTransitions: ['IN_PROGRESS', 'EXCEPTION_REPORTED', 'CANCELLED'],
    canEdit: true,
    canAssign: true,
    canPublishInstructions: true,
    canRecordHandover: true,
    canAccept: false,
    canOverrideConflicts: true,
  },
};

describe('duty assignments list', () => {
  it('shows category, restricted placeholder title, personnel classes and exceptions', async () => {
    mockFetch({ '/api/v1/duty-assignments': { ...emptyPage, items: [listItem], total: 1 }, '/api/v1/units': { items: [] } });
    renderWith(
      <Routes>
        <Route path="/duties/category/:slug" element={<DutyAssignmentsPage />} />
      </Routes>,
      { role: 'DSP', route: '/duties/category/vip-escorts' },
    );
    expect(await screen.findByText('DEMO-VE-20261016-001')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'VIP escort duties' })).toBeInTheDocument();
    expect(screen.getByText('VIP Escort (restricted details)')).toBeInTheDocument();
    expect(screen.getByText(tCode('class', 'PC_AR'))).toBeInTheDocument();
    expect(screen.getByText(/1 open exception/)).toBeInTheDocument();
    // DSP cannot create duties: no “New duty” button.
    expect(screen.queryByRole('link', { name: t('duty.new') })).not.toBeInTheDocument();
  });
});

describe('duty detail', () => {
  it('shows history-preserving changes, device vs server times and permitted actions only', async () => {
    mockFetch({ [`/api/v1/duty-assignments/${detail.id}`]: detail, '/api/v1/personnel': emptyPage });
    renderWith(
      <Routes>
        <Route path="/duties/:id" element={<DutyDetailPage />} />
      </Routes>,
      { role: 'SI', route: `/duties/${detail.id}` },
    );
    expect(await screen.findByText('DEMO-TRN-205 (synthetic)')).toBeInTheDocument();
    expect(screen.getByText(/No supervising officer recorded/)).toBeInTheDocument();
    expect(screen.getByText(/not, on their own, proof of physical attendance/)).toBeInTheDocument();
    expect(screen.getAllByText('(device clock)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('(server)').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Shift swap requested/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Mark in progress' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Complete duty' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel duty' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Cancel duty' })).toBeDisabled(); // reason required
  });
});

describe('roster', () => {
  it('marks conflicts and unavailability', async () => {
    const now = new Date();
    const at = (h: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), h).toISOString();
    mockFetch({
      '/api/v1/roster': {
        from: at(0),
        to: at(24),
        personnel: [{ id: 'o1', personnelRef: 'DEMO-PC-0021', displayName: 'Vemuri Anil Kumar', personnelCategory: 'POLICE', rank: 'PC', constableCategory: 'AR', isActive: true, unitName: 'DEMO' }],
        duties: [
          { officerId: 'o1', assignmentId: 'a1', referenceCode: 'TB-1', category: 'TRAIN_BEAT', status: 'ASSIGNED', personnelStatus: 'ASSIGNED', roleInDuty: 'LEAD', plannedStart: at(8), plannedEnd: at(16), title: 'Beat' },
          { officerId: 'o1', assignmentId: 'a2', referenceCode: 'SW-1', category: 'STATION_WATCH', status: 'ASSIGNED', personnelStatus: 'ASSIGNED', roleInDuty: 'MEMBER', plannedStart: at(9), plannedEnd: at(15), title: 'Watch' },
        ],
        unavailability: [],
        conflicts: [{ officerId: 'o1', kind: 'OVERLAPPING_DUTIES', a: 'a1', b: 'a2' }],
      },
      '/api/v1/units': { items: [] },
    });
    renderWith(<RosterPage />, { role: 'SI' });
    expect(await screen.findByText('Vemuri Anil Kumar')).toBeInTheDocument();
    expect(screen.getByText(/1 conflict in this period/)).toBeInTheDocument();
    expect(screen.getAllByTitle(/CONFLICT/).length).toBe(2);
  });
});

describe('check-ins & presence', () => {
  it('states that GPS and check-ins are not proof of presence', async () => {
    mockFetch({ '/api/v1/checkins': emptyPage });
    renderWith(<CheckinsPage />, { role: 'HG' });
    expect(await screen.findByText(/not proof of\s+physical presence/)).toBeInTheDocument();
  });
});

describe('reports', () => {
  it('offers exports only to accounts with reports.export', async () => {
    const summary = { reports: Object.fromEntries(['roster', 'assignments', 'completion', 'exceptions', 'evidence-verification'].map((k) => [k, { title: k, rows: 3 }])) };
    mockFetch({ '/api/v1/reports/summary': summary, '/api/v1/units': { items: [] } });
    renderWith(<ReportsPage />, { role: 'DSP' });
    expect((await screen.findAllByRole('button', { name: 'Download CSV' })).length).toBe(5);
    mockFetch({ '/api/v1/reports/summary': summary, '/api/v1/units': { items: [] } });
    renderWith(<ReportsPage />, { role: 'REVIEWER' });
    expect((await screen.findAllByText('Exporting requires reports.export.')).length).toBe(5);
  });
});

describe('my duties', () => {
  it('lets assigned personnel accept and see instructions pending acknowledgement', async () => {
    const calls = mockFetch({
      '/api/v1/me/summary': {
        personnel: { personnelRef: 'DEMO-PC-0021', displayName: 'Vemuri Anil Kumar', personnelCategory: 'POLICE', rank: 'PC', constableCategory: 'AR', unitName: 'DEMO' },
        duties: [
          { id: 'a7', referenceCode: 'DEMO-VE-1', category: 'VIP_ESCORT', title: 'Escort', status: 'ASSIGNED', plannedStart: '2026-10-16T03:30:00Z', plannedEnd: '2026-10-16T09:30:00Z', reportingLocation: 'DEMO R-1', personnelStatus: 'ASSIGNED', acceptRequired: true, sessionStatus: 'PLANNED', instructionsVersion: 1, instructionsUnacknowledged: true },
        ],
        pendingAcknowledgements: 1,
        devices: [],
        checkins: { acknowledged: 0, late: 0, missed: 0 },
        evidence: { verified: 0, awaitingUpload: 0, failed: 0 },
        handovers: [],
        note: '',
      },
      '/api/v1/duty-assignments/a7/accept': { assignmentStatus: 'ASSIGNED' },
    });
    renderWith(<MyDutiesPage />, { role: 'PC' });
    expect(await screen.findByText(/waiting for your acknowledgement/)).toBeInTheDocument();
    expect(screen.getByText(tCode('class', 'PC_AR'), { exact: false })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Accept assignment' }));
    expect(calls.some((c) => c.url.endsWith('/api/v1/duty-assignments/a7/accept') && c.init?.method === 'POST')).toBe(true);
  });
});

describe('system status', () => {
  it('shows backup status as not available unless a verification result exists', async () => {
    mockFetch({
      '/api/v1/system/status': {
        generatedAt: '2026-10-15T00:00:00Z',
        api: { status: 'ok', uptimeSeconds: 600, node: 'v22', environment: 'development' },
        database: { status: 'ok', latencyMs: 2, pg: '16', postgis: '3.4', migrations: 7, latest: '0007_duty_operations.sql' },
        evidenceStorage: { status: 'ok', writable: true, freeBytes: 1e10, totalBytes: 2e10 },
        synchronisation: { lastBatchReceivedAt: null, batches24h: 0, rejections24h: 0, evidenceAwaitingUpload: 0, evidenceQuarantined: 0, activeDevices: 0, openSyncFailures: 0 },
        auditChain: { ok: true, checked: 10, issues: 0 },
        backup: { status: 'NOT_AVAILABLE', detail: 'No backup verification result has been recorded on this server.' },
        demoLoginAllowed: true,
      },
    });
    renderWith(<SystemStatusPage />, { role: 'ADMIN' });
    expect(await screen.findByText('not available')).toBeInTheDocument();
    expect(screen.getByText(/No backup verification result/)).toBeInTheDocument();
  });
});
