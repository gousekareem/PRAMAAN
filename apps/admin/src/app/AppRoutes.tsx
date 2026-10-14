import { Route, Routes } from 'react-router-dom';
import { RequireAuth } from '../auth/RequireAuth';
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

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth roles={['ADMIN', 'SUPERVISOR', 'REVIEWER']}>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<OverviewPage />} />
        <Route path="map" element={<MapPage />} />
        <Route path="officers" element={<OfficersPage />} />
        <Route path="officers/:id" element={<OfficerDetailPage />} />
        <Route path="duties" element={<DutiesPage />} />
        <Route path="evidence" element={<EvidencePage />} />
        <Route path="evidence/:id" element={<EvidenceDetailPage />} />
        <Route path="alerts" element={<AlertsPage />} />
        <Route path="devices" element={<DevicesPage />} />
        <Route
          path="audit"
          element={
            <RequireAuth roles={['ADMIN', 'SUPERVISOR']}>
              <AuditPage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
