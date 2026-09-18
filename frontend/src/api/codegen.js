// CodeGen subsystem API client - workflow-centric.
import { codegenApi } from './serviceClients';

// ----------------------------------------------------------------------
// Mock flag - flip to false when backend is live
// ----------------------------------------------------------------------
const USE_MOCK = false;

const MOCK_WORKFLOWS = [
  {
    id: 'wf-001', owner_id: 'user1', name: 'Customer Migration Service',
    description: 'Generate Spring Boot microservice from customer migration PDD',
    primary_usage: 'Risk Management', business_unit: 'Finance, Risk & Control',
    notes: '', status: 'completed',
    source: { type: 'upload' }, created_at: '2026-06-25T10:00:00Z',
    updated_at: '2026-06-26T14:30:00Z', created_by: 'user1',
    file_count: 2, run_count: 1, latest_run_id: 'run-001', latest_run_status: 'completed',
  },
  {
    id: 'wf-002', owner_id: 'user1', name: 'Payment Processing Pipeline',
    description: 'PySpark ETL pipeline from payment reconciliation workbook',
    primary_usage: 'Financial Reporting', business_unit: 'Treasury',
    notes: 'Priority: high', status: 'generating',
    source: { type: 'upload' }, created_at: '2026-06-27T09:00:00Z',
    updated_at: '2026-06-29T11:00:00Z', created_by: 'user1',
    file_count: 3, run_count: 2, latest_run_id: 'run-003', latest_run_status: 'running',
  },
  {
    id: 'wf-003', owner_id: 'user1', name: 'Report Generator API',
    description: 'FastAPI service replacing Excel report macros',
    primary_usage: 'Regulatory Compliance', business_unit: 'Compliance',
    notes: '', status: 'waiting_for_answers',
    source: { type: 'upload' }, created_at: '2026-06-28T15:00:00Z',
    updated_at: '2026-06-29T08:00:00Z', created_by: 'user1',
    file_count: 1, run_count: 1, latest_run_id: 'run-004', latest_run_status: 'paused',
  },
  {
    id: 'wf-004', owner_id: 'user1', name: 'Inventory Dashboard',
    description: 'React dashboard replacing inventory tracking spreadsheet',
    primary_usage: 'Management Information', business_unit: 'Operations',
    notes: '', status: 'failed',
    source: { type: 'upload' }, created_at: '2026-06-20T12:00:00Z',
    updated_at: '2026-06-21T09:00:00Z', created_by: 'user1',
    file_count: 1, run_count: 1, latest_run_id: 'run-005', latest_run_status: 'failed',
  },
];

function mockDelay(ms = 300) {
  return new Promise((r) => setTimeout(r, ms));
}

// ----------------------------------------------------------------------
// Dashboard
// ----------------------------------------------------------------------

export async function getDashboardSummary() {
  if (USE_MOCK) {
    await mockDelay();
    const statuses = MOCK_WORKFLOWS.map((w) => w.status);
    return {
      total: statuses.length,
      running: statuses.filter((s) => s === 'generating').length,
      completed: statuses.filter((s) => s === 'completed').length,
      failed: statuses.filter((s) => s === 'failed').length,
      pending_input: statuses.filter((s) => ['waiting_for_answers', 'questions_generated'].includes(s)).length,
    };
  }
  const { data } = await codegenApi.get('/api/codegen/dashboard/summary');
  return data;
}

export async function getRecentRuns() {
  if (USE_MOCK) { await mockDelay(); return MOCK_WORKFLOWS.slice(0, 5); }
  const { data } = await codegenApi.get('/api/codegen/dashboard/recent-runs');
  return data?.runs ?? [];
}

export async function getActionRequired() {
  if (USE_MOCK) {
    await mockDelay();
    return MOCK_WORKFLOWS.filter((w) => ['waiting_for_answers', 'questions_generated'].includes(w.status));
  }
  const { data } = await codegenApi.get('/api/codegen/dashboard/action-required');
  return data?.workflows ?? [];
}

// ----------------------------------------------------------------------
// Workflows
// ----------------------------------------------------------------------

export async function createWorkflow(body) {
  if (USE_MOCK) {
    await mockDelay(500);
    const id = 'wf-' + Math.random().toString(36).slice(2, 8);
    const now = new Date().toISOString();
    const wf = { id, owner_id: 'user1', ...body, status: 'created', source: { type: 'upload' }, created_at: now, updated_at: now, created_by: 'user1', file_count: 0, run_count: 0, latest_run_id: null, latest_run_status: null };
    MOCK_WORKFLOWS.unshift(wf);
    return wf;
  }
  const { data } = await codegenApi.post('/api/codegen/workflows', body);
  return data?.workflow;
}

export async function listWorkflows({ status } = {}) {
  if (USE_MOCK) {
    await mockDelay();
    let items = [...MOCK_WORKFLOWS];
    if (status) items = items.filter((w) => w.status === status);
    return items;
  }
  const params = {};
  if (status) params.status = status;
  const { data } = await codegenApi.get('/api/codegen/workflows', { params });
  return data?.workflows ?? [];
}

export async function getWorkflow(workflowId) {
  if (USE_MOCK) { await mockDelay(); return MOCK_WORKFLOWS.find((w) => w.id === workflowId) || null; }
  const { data } = await codegenApi.get(`/api/codegen/workflows/${workflowId}`);
  return data?.workflow ?? null;
}

export async function updateWorkflow(workflowId, body) {
  if (USE_MOCK) {
    await mockDelay();
    const wf = MOCK_WORKFLOWS.find((w) => w.id === workflowId);
    if (wf) Object.assign(wf, body, { updated_at: new Date().toISOString() });
    return wf;
  }
  const { data } = await codegenApi.patch(`/api/codegen/workflows/${workflowId}`, body);
  return data?.workflow;
}

export async function deleteWorkflow(workflowId) {
  if (USE_MOCK) {
    await mockDelay();
    const idx = MOCK_WORKFLOWS.findIndex((w) => w.id === workflowId);
    if (idx !== -1) MOCK_WORKFLOWS.splice(idx, 1);
    return true;
  }
  await codegenApi.delete(`/api/codegen/workflows/${workflowId}`);
  return true;
}

// ----------------------------------------------------------------------
// Files (Phase 2)
// ----------------------------------------------------------------------

export async function uploadFile(workflowId, file) {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await codegenApi.post(
    `/api/codegen/workflows/${workflowId}/files/upload`, formData,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  );
  return data?.file;
}

export async function listFiles(workflowId) {
  const { data } = await codegenApi.get(`/api/codegen/workflows/${workflowId}/files`);
  return data?.files ?? [];
}

export async function deleteFile(workflowId, fileId) {
  await codegenApi.delete(`/api/codegen/workflows/${workflowId}/files/${fileId}`);
  return true;
}

// ----------------------------------------------------------------------
// Runs (Phase 4)
// ----------------------------------------------------------------------

export async function startGeneration(workflowId, stage = null) {
  const body = stage ? { stage } : {};
  const { data } = await codegenApi.post(`/api/codegen/workflows/${workflowId}/runs`, body);
  return data?.run;
}

export async function listRuns(workflowId) {
  const { data } = await codegenApi.get(`/api/codegen/workflows/${workflowId}/runs`);
  return data?.runs ?? [];
}

export async function cancelRun(runId) {
  const { data } = await codegenApi.post(`/api/codegen/runs/${runId}/cancel`);
  return data?.run;
}

// ----------------------------------------------------------------------
// Gap Analysis & SDD
// ----------------------------------------------------------------------

export async function getQuestions(workflowId) {
  const { data } = await codegenApi.get(`/api/codegen/workflows/${workflowId}/questions`);
  return data;
}

export async function submitAnswers(workflowId, answers) {
  const { data } = await codegenApi.post(`/api/codegen/workflows/${workflowId}/questions/answers`, { answers });
  return data;
}

export async function approveSdd(workflowId) {
  const { data } = await codegenApi.post(`/api/codegen/workflows/${workflowId}/sdd/approve`);
  return data;
}


// ----------------------------------------------------------------------
// Artifacts (Phase 6)
// ----------------------------------------------------------------------

export async function getArtifactTree(runId) {
  const { data } = await codegenApi.get(`/api/codegen/runs/${runId}/artifacts/tree`);
  return data?.tree ?? [];
}

export async function getArtifactFile(runId, path) {
  const { data } = await codegenApi.get(`/api/codegen/runs/${runId}/artifacts/file`, { params: { path } });
  return data?.content ?? '';
}

export async function exportZip(runId) {
  const response = await codegenApi.post(`/api/codegen/runs/${runId}/export/zip`, null, { responseType: 'blob' });
  return response.data;
}

// SDD pipeline server-side, so allow a generous timeout.
export async function downloadSdd(runId) {
  const response = await codegenApi.post(`/api/codegen/runs/${runId}/export/sdd`, null, {
    responseType: 'blob',
    timeout: 900_000,
  });
  return response.data;
}

// ----------------------------------------------------------------------
// Health
// ----------------------------------------------------------------------

export async function getCodegenHealth() {
  const { data } = await codegenApi.get('/api/health');
  return data;
}

// ----------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------

export const TARGET_TECHNOLOGIES = [
  { value: 'java_spring_boot', label: 'Java Spring Boot' },
  { value: 'python_fastapi', label: 'Python FastAPI' },
  { value: 'pyspark', label: 'PySpark' },
  { value: 'react_ui', label: 'React UI' },
  { value: 'angular_ui', label: 'Angular UI' },
  { value: 'sql_procedure', label: 'SQL Procedure' },
  { value: 'dotnet', label: '.NET' },
  { value: 'other', label: 'Other' },
];

export const WORKFLOW_STATUS_META = {
  created: { label: 'Created', color: 'bg-gray-500', textColor: 'text-gray-400' },
  files_uploaded: { label: 'Files Uploaded', color: 'bg-blue-500', textColor: 'text-blue-400' },
  summary_generated: { label: 'Summary Ready', color: 'bg-indigo-500', textColor: 'text-indigo-400' },
  questions_generated: { label: 'Questions Ready', color: 'bg-amber-500', textColor: 'text-amber-400' },
  waiting_for_answers: { label: 'Pending Input', color: 'bg-amber-500', textColor: 'text-amber-400' },
  plan_generated: { label: 'Plan Ready', color: 'bg-purple-500', textColor: 'text-purple-400' },
  plan_approved: { label: 'Plan Approved', color: 'bg-purple-600', textColor: 'text-purple-400' },
  generating: { label: 'Generating', color: 'bg-sky-500', textColor: 'text-sky-400' },
  uploading_artifacts: { label: 'Uploading', color: 'bg-sky-600', textColor: 'text-sky-400' },
  completed: { label: 'Completed', color: 'bg-emerald-500', textColor: 'text-emerald-400' },
  failed: { label: 'Failed', color: 'bg-red-500', textColor: 'text-red-400' },
  cancelled: { label: 'Cancelled', color: 'bg-orange-500', textColor: 'text-orange-400' },
};