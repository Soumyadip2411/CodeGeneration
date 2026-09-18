// Multi-backend API clients for the RAID admin / codegen / enduser subsystems.
//
// The analyzer subsystem keeps its own client in ./client.js (unchanged).
// Each subsystem here has its own axios instance and its own
// VITE_*_API_BASE_URL so the new pages don't have to know URL shapes.
//
// Headers sent on every request (header stub-auth mode):
//   X-User-Id   - stub auth identifier (localStorage 'euc_userid')
//   X-User-Role - currently selected role (RoleContext / localStorage 'euc_role')
//   X-Tenant-Id - active tenant (localStorage 'euc_tenantid', default 'default')
// When Entra auth is enabled the Authorization bearer token is sent instead.
import axios from 'axios';

import { getCurrentRole } from '../contexts/RoleContext';
import { getRequestHeaders, isEntraAuthEnabled } from '../auth/entraAuth';
import { getUserId, getTenantId } from './client';

const ENV = import.meta.env || {};

// Per-subsystem defaults - match the local port allocation used by the
// scaffolded backends. Override via .env in any environment.
const DEFAULTS = {
  admin: ENV.VITE_ADMIN_API_BASE_URL || 'http://localhost:7072',
  codegen: ENV.VITE_CODEGEN_API_BASE_URL || 'http://localhost:7073',
  enduser: ENV.VITE_ENDUSER_API_BASE_URL || 'http://localhost:7074',
};

const STORAGE_OVERRIDES = {
  admin: 'euc_adminApiBaseUrl',
  codegen: 'euc_codegenApiBaseUrl',
  enduser: 'euc_enduserApiBaseUrl',
};

function readOverride(subsystem) {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage?.getItem(STORAGE_OVERRIDES[subsystem]) || null;
  } catch { return null; }
}

export function getServiceBaseUrl(subsystem) {
  return readOverride(subsystem) || DEFAULTS[subsystem] || DEFAULTS.admin;
}

function mergeHeaders(target, source) {
  const headers = typeof target?.toJSON === 'function'
    ? target.toJSON()
    : { ...(target || {}) };
  if (!source) return headers;
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== 'undefined' && value !== null) {
      headers[key] = value;
    }
  }
  return headers;
}

function makeClient(subsystem) {
  const instance = axios.create({
    baseURL: getServiceBaseUrl(subsystem),
    timeout: 60_000,
  });
  instance.interceptors.request.use(async (config) => {
    config.baseURL = getServiceBaseUrl(subsystem);
    const headers = await getRequestHeaders();
    config.headers = mergeHeaders(config.headers || {}, headers);
    if (!isEntraAuthEnabled()) {
      config.headers['X-User-Id'] = getUserId();
      config.headers['X-User-Role'] = getCurrentRole();
      config.headers['X-Tenant-Id'] = getTenantId();
    }
    return config;
  });
  return instance;
}

export const adminApi = makeClient('admin');
export const codegenApi = makeClient('codegen');
export const enduserApi = makeClient('enduser');

/** Pick the axios client for a given subsystem (admin | codegen | enduser). */
export function pickServiceClient(subsystem) {
  switch (subsystem) {
    case 'codegen': return codegenApi;
    case 'enduser': return enduserApi;
    case 'admin':
    default:
      return adminApi;
  }
}