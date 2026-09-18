import { Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { AuthProvider } from './contexts/AuthContext';
import { InventoryProvider } from './contexts/InventoryContext';
import { EUCProjectProvider } from './contexts/EUCProjectContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ToastProvider } from './contexts/ToastContext';
import { RoleProvider } from './contexts/RoleContext';
import { RequireAuth } from './components/auth/RequireAuth';

import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ResultsPage from './pages/ResultsPage';
import ExportCenterPage from './pages/ExportCenterPage';
import SettingsPage from './pages/SettingsPage';
import AuditLogPage from './pages/AuditLogPage';
import ProjectsPage from './pages/ProjectsPage';
import EUCDetailPage from './pages/EUCDetailPage';
import InsightsPage from './pages/InsightsPage';
import ComingSoonPage from './pages/ComingSoonPage';

import TenantConfigPage from './pages/admin/TenantConfigPage';
import UsersPage from './pages/admin/UsersPage';
import AdminAuditLogPage from './pages/admin/AdminAuditLogPage';
import InfrastructurePage from './pages/admin/InfrastructurePage';
import BulkIngestPage from './pages/admin/BulkIngestPage';

import CapabilitiesCatalogPage from './pages/enduser/CapabilitiesCatalogPage';
import EndUserChatPage from './pages/enduser/EndUserChatPage';

import CodeGenDashboardPage from './pages/codegen/CodeGenDashboardPage';
import CodeGenWorkflowsPage from './pages/codegen/CodeGenWorkflowsPage';
import WorkflowDetailPage from './pages/codegen/WorkflowDetailPage';
import ArtifactsCenterPage from './pages/codegen/ArtifactsCenterPage';

import EUCSummaryTab from './components/projects/tabs/EUCSummaryTab';
import RunWorkflowTab from './components/projects/tabs/RunWorkflowTab';
import WorkflowStatusTab from './components/projects/tabs/WorkflowStatusTab';
import ReviewTab from './components/projects/tabs/ReviewTab';
import LineageGraphTab from './components/projects/tabs/LineageGraphTab';
import ResultsTab from './components/projects/tabs/ResultsTab';
import ExportTab from './components/projects/tabs/ExportTab';
import TestCasesTab from './components/projects/tabs/TestCasesTab';

function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <RoleProvider>
          <ToastProvider>
            <EUCProjectProvider>
              <InventoryProvider>
                <Routes>
                  <Route path="/signin" element={<LoginPage />} />

                  <Route element={<RequireAuth />}>
                    <Route element={<AppLayout />}>
                      <Route path="/" element={<Navigate to="/dashboard" replace />} />
                      <Route path="/dashboard" element={<DashboardPage />} />
                      <Route path="/exports" element={<ExportCenterPage />} />
                      <Route path="/settings" element={<SettingsPage />} />
                      <Route path="/audit-log" element={<AuditLogPage />} />
                      <Route path="/insights" element={<InsightsPage />} />

                      {/* EUC Projects */}
                      <Route path="/projects" element={<ProjectsPage />} />
                      <Route path="/projects/:eucId" element={<EUCDetailPage />}>
                        <Route index element={<Navigate to="summary" replace />} />
                        <Route path="summary" element={<EUCSummaryTab />} />
                        <Route path="workflow" element={<RunWorkflowTab />} />
                        <Route path="status" element={<WorkflowStatusTab />} />
                        <Route path="results" element={<ResultsTab />} />
                        <Route path="export" element={<ExportTab />} />
                        <Route path="review" element={<ReviewTab />} />
                        <Route path="lineage" element={<LineageGraphTab />} />
                        <Route path="test-cases" element={<TestCasesTab />} />
                      </Route>

                      {/* RAID role-specific placeholders — replaced as features land. */}
                      <Route path="/admin/tenant" element={<TenantConfigPage />} />
                      <Route path="/admin/infra" element={<InfrastructurePage />} />
                      <Route path="/admin/users" element={<UsersPage />} />
                      <Route path="/admin/bulk" element={<BulkIngestPage />} />
                      <Route path="/admin/audit-log" element={<AdminAuditLogPage />} />
                      <Route path="/admin/*" element={<ComingSoonPage />} />

                      <Route path="/enduser/capabilities" element={<CapabilitiesCatalogPage />} />
                      <Route path="/enduser/chat" element={<EndUserChatPage />} />

                      <Route path="/codegen" element={<CodeGenDashboardPage />} />
                      <Route path="/codegen/workflows" element={<CodeGenWorkflowsPage />} />
                      <Route path="/codegen/workflows/:workflowId" element={<WorkflowDetailPage />} />
                      <Route path="/codegen/artifacts" element={<ArtifactsCenterPage />} />
                      <Route path="/codegen/*" element={<CodeGenDashboardPage />} />
                      <Route path="/enduser/*" element={<ComingSoonPage />} />

                      <Route path="*" element={<Navigate to="/dashboard" replace />} />
                    </Route>
                  </Route>
                </Routes>
              </InventoryProvider>
            </EUCProjectProvider>
          </ToastProvider>
        </RoleProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}

export default App;
