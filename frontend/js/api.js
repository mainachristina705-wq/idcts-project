// Centralized API client for the IDCTS frontend.
// Relative path: works automatically since the backend now serves this frontend
// from the same host/port. Override window.IDCTS_API_BASE only if you split them again.
const API_BASE = window.IDCTS_API_BASE || '/api';

const Auth = {
  getToken() { return localStorage.getItem('idcts_token'); },
  setToken(t) { localStorage.setItem('idcts_token', t); },
  getUser() {
    const raw = localStorage.getItem('idcts_user');
    return raw ? JSON.parse(raw) : null;
  },
  setUser(u) { localStorage.setItem('idcts_user', JSON.stringify(u)); },
  clear() { localStorage.removeItem('idcts_token'); localStorage.removeItem('idcts_user'); },
  isLoggedIn() { return !!this.getToken(); },
};

async function apiRequest(path, { method = 'GET', body = null, isForm = false } = {}) {
  const headers = {};
  const token = Auth.getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!isForm) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });

  let data;
  try { data = await res.json(); } catch { data = {}; }

  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const Api = {
  login: (email, password) => apiRequest('/auth/login', { method: 'POST', body: { email, password } }),
  register: (payload) => apiRequest('/auth/register', { method: 'POST', body: payload }),
  me: () => apiRequest('/users/me'),
  staff: () => apiRequest('/users/staff'),
  departments: () => apiRequest('/departments'),

  listCases: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiRequest(`/cases${qs ? '?' + qs : ''}`);
  },
  getCase: (id) => apiRequest(`/cases/${id}`),
  createCase: (payload) => apiRequest('/cases', { method: 'POST', body: payload }),
  assignCase: (id, assigned_to) => apiRequest(`/cases/${id}/assign`, { method: 'PATCH', body: { assigned_to } }),
  updateStatus: (id, status) => apiRequest(`/cases/${id}/status`, { method: 'PATCH', body: { status } }),
  moveCase: (id, payload) => apiRequest(`/cases/${id}/move`, { method: 'POST', body: payload }),
  addFeedback: (id, comment, is_internal = true) => apiRequest(`/cases/${id}/feedback`, { method: 'POST', body: { comment, is_internal } }),

  uploadDocument: (caseId, file) => {
    const form = new FormData();
    form.append('file', file);
    return apiRequest(`/documents/${caseId}`, { method: 'POST', body: form, isForm: true });
  },
  downloadDocumentUrl: (id) => `${API_BASE}/documents/download/${id}`,

  reportSummary: () => apiRequest('/reports/summary'),
  auditTrail: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiRequest(`/reports/audit-trail${qs ? '?' + qs : ''}`);
  },
};

const ROLE_LABELS = {
  kra_officer: 'KRA Officer',
  investigations_dept: 'Investigations Dept.',
  registry_dept: 'Registry Dept.',
  commissioner: 'Commissioner',
  taxpayer: 'Taxpayer',
};

function requireAuth() {
  if (!Auth.isLoggedIn()) {
    window.location.href = 'login.html';
  }
}
