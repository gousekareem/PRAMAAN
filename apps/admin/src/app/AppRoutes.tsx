import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from '../auth/RequireAuth';
import { useAuth } from '../auth/AuthContext';
import { AppLayout } from '../components/layout/AppLayout';
import { LoginPage } from '../pages/LoginPage';
import { OverviewPage } from '../pages/OverviewPage';
import { MapPage } from '../pages/MapPage';
import { OfficersPage } from '../pages/OfficersPage';
import { OfficerDetailPage } from '../pages/OfficerDetailPage';
import { DutiesPage } from '../pages/DutiesPage';
import { EvidencePage } from '../pages/EvidencePage';
import { EvidenceDetailPage } from '../pages/EvidenceDetailPage';
import { AlertsPage } from '../pages/AlertsPage';
import { AuditPage } from '../pages/AuditPage';
import { DevicesPage } from '../pages/DevicesPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { DutyAssignmentsPage } from '../pages/DutyAssignmentsPage';
import { DutyDetailPage } from '../pages/DutyDetailPage';
import { DutyFormPage } from '../pages/DutyFormPage';
import { RosterPage } from '../pages/RosterPage';
import { CheckinsPage } from '../pages/CheckinsPage';
import { PersonnelPage } from '../pages/PersonnelPage';
import { PersonnelDetailPage } from '../pages/PersonnelDetailPage';
import { MyDutiesPage } from '../pages/MyDutiesPage';
import { ReportsPage } from '../pages/ReportsPage';
import { CorrectionsPage } from '../pages/CorrectionsPage';
import { AccountPage } from '../pages/AccountPage';
import { AccountsPage } from '../pages/AccountsPage';
import { PolicyPage } from '../pages/PolicyPage';
import { SystemStatusPage } from '../pages/SystemStatusPage';

/** Page-level guard: hides pages the account cannot use. The API enforces the same permissions. */
function Guard({ anyOf, children }: { anyOf: string[]; children: ReactNode }) {
  return <RequireAuth anyOf={anyOf}>{children}</RequireAuth>;
}

/** Supervisory roles land on the overview; field personnel land on their own duties. */
function Home() {
  const { can } = useAuth();
  return can('dashboard.view') ? <OverviewPage /> : <Navigate to="/my" replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth anyOf={['web.login']}>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Home />} />
        <Route path="my" element={<MyDutiesPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="duties" element={<Guard anyOf={['duty.view']}><DutyAssignmentsPage /></Guard>} />
        <Route path="duties/category/:slug" element={<Guard anyOf={['duty.view']}><DutyAssignmentsPage /></Guard>} />
        <Route path="duties/new" element={<Guard anyOf={['duty.create']}><DutyFormPage /></Guard>} />
        <Route path="duties/:id" element={<Guard anyOf={['duty.view']}><DutyDetailPage /></Guard>} />
        <Route path="duties/:id/edit" element={<Guard anyOf={['duty.assign']}><DutyFormPage /></Guard>} />
        <Route path="duty-sessions" element={<Guard anyOf={['duty.create']}><DutiesPage /></Guard>} />
        <Route path="roster" element={<Guard anyOf={['roster.view']}><RosterPage /></Guard>} />
        <Route path="checkins" element={<Guard anyOf={['checkin.view']}><CheckinsPage /></Guard>} />
        <Route path="map" element={<Guard anyOf={['map.view']}><MapPage /></Guard>} />
        <Route path="personnel" element={<Guard anyOf={['personnel.view']}><PersonnelPage /></Guard>} />
        <Route path="personnel/:id" element={<PersonnelDetailPage />} />
        <Route path="officers" element={<Guard anyOf={['personnel.view']}><OfficersPage /></Guard>} />
        <Route path="officers/:id" element={<OfficerDetailPage />} />
        <Route path="evidence" element={<Guard anyOf={['evidence.view']}><EvidencePage /></Guard>} />
        <Route path="evidence/:id" element={<Guard anyOf={['evidence.view']}><EvidenceDetailPage /></Guard>} />
        <Route path="alerts" element={<Guard anyOf={['exception.view']}><AlertsPage /></Guard>} />
        <Route path="corrections" element={<Guard anyOf={['correction.request', 'correction.approve']}><CorrectionsPage /></Guard>} />
        <Route path="reports" element={<Guard anyOf={['reports.view']}><ReportsPage /></Guard>} />
        <Route path="devices" element={<Guard anyOf={['device.view']}><DevicesPage /></Guard>} />
        <Route path="audit" element={<Guard anyOf={['audit.view']}><AuditPage /></Guard>} />
        <Route path="admin/accounts" element={<Guard anyOf={['users.manage']}><AccountsPage /></Guard>} />
        <Route path="admin/policy" element={<Guard anyOf={['policy.manage', 'users.manage']}><PolicyPage /></Guard>} />
        <Route path="admin/system" element={<Guard anyOf={['system.health']}><SystemStatusPage /></Guard>} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
