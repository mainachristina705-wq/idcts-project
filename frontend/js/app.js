requireAuth();

const state = {
  user: Auth.getUser(),
  departments: [],
  staff: [],
  cases: [],
  currentCaseId: null,
};

const isTaxpayer = () => state.user.role === 'taxpayer';
const isStaff = () => !isTaxpayer();
const canRegisterCase = () => ['kra_officer', 'registry_dept'].includes(state.user.role);
const canAssign = () => ['kra_officer', 'registry_dept', 'commissioner'].includes(state.user.role);
const canUpdateStatus = () => ['kra_officer', 'investigations_dept', 'registry_dept', 'commissioner'].includes(state.user.role);
const canClose = () => ['commissioner', 'registry_dept'].includes(state.user.role);
const canMove = () => ['kra_officer', 'investigations_dept', 'registry_dept', 'commissioner'].includes(state.user.role);
const canComment = () => isStaff();
const canSeeAudit = () => ['commissioner', 'registry_dept'].includes(state.user.role);

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function statusLabel(s) { return s.replace(/_/g, ' '); }
function initials(name) {
  return (name || '?').split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

// ---------- Init ----------
async function init() {
  document.getElementById('user-name').textContent = state.user.full_name;
  document.getElementById('user-role').textContent = ROLE_LABELS[state.user.role] || state.user.role;
  document.getElementById('user-avatar').textContent = initials(state.user.full_name);

  if (isTaxpayer()) {
    document.getElementById('cases-nav-label').textContent = 'My Cases';
    document.getElementById('cases-title').textContent = 'My Cases';
    document.getElementById('cases-sub').textContent = 'Track the status of your cases with KRA.';
    document.getElementById('filter-bar').hidden = true;
    document.getElementById('th-assigned').hidden = true;
    document.getElementById('th-department').hidden = true;
    // Overview (staff dashboard) is not relevant to a taxpayer — jump straight to their cases
    document.querySelector('.nav-item[data-view="overview"]').hidden = true;
    switchView('cases');
  } else {
    document.getElementById('new-case-btn').hidden = !canRegisterCase();
    if (canSeeAudit()) document.getElementById('audit-nav-item').hidden = false;
    await loadOverview();
  }

  try {
    const deptRes = await Api.departments();
    state.departments = deptRes.departments;
    populateDepartmentSelects();
  } catch (e) { /* non-fatal */ }

  if (isStaff()) {
    try {
      const staffRes = await Api.staff();
      state.staff = staffRes.staff;
    } catch (e) { /* non-fatal */ }
  }

  await loadCases();
}

function populateDepartmentSelects() {
  const filterSel = document.getElementById('filter-department');
  const ncSel = document.getElementById('nc-department');
  state.departments.forEach(d => {
    const opt1 = document.createElement('option');
    opt1.value = d.id; opt1.textContent = d.name;
    filterSel.appendChild(opt1);

    const opt2 = document.createElement('option');
    opt2.value = d.id; opt2.textContent = d.name;
    ncSel.appendChild(opt2);
  });
}

// ---------- Navigation ----------
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

function switchView(view) {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.hidden = true);
  document.getElementById(`view-${view}`).hidden = false;
  if (view === 'audit') loadAuditTrail();
}

// ---------- Overview ----------
async function loadOverview() {
  try {
    const summary = await Api.reportSummary();
    renderStats(summary);
  } catch (e) {
    console.error(e);
  }
}

function renderStats(summary) {
  const grid = document.getElementById('stat-grid');
  const closedCount = (summary.by_status.find(s => s.status === 'closed') || {}).count || 0;
  grid.innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${summary.total_cases}</div>
      <div class="stat-label">Total cases</div>
    </div>
    <div class="stat-card stat-card--warn">
      <div class="stat-value">${summary.overdue_cases}</div>
      <div class="stat-label">Overdue</div>
    </div>
    <div class="stat-card stat-card--accent">
      <div class="stat-value">${closedCount}</div>
      <div class="stat-label">Closed</div>
    </div>
  `;

  const maxStatus = Math.max(1, ...summary.by_status.map(s => s.count));
  document.getElementById('status-breakdown').innerHTML = summary.by_status.map(s => `
    <div class="breakdown-row">
      <div class="breakdown-label">${statusLabel(s.status)}</div>
      <div class="breakdown-bar-track"><div class="breakdown-bar-fill" style="width:${(s.count / maxStatus) * 100}%"></div></div>
      <div class="breakdown-count">${s.count}</div>
    </div>
  `).join('') || '<p style="color:var(--slate); font-size:13px;">No cases yet.</p>';

  const maxDept = Math.max(1, ...summary.by_department.map(d => d.count));
  document.getElementById('dept-breakdown').innerHTML = summary.by_department.map(d => `
    <div class="breakdown-row">
      <div class="breakdown-label">${d.name}</div>
      <div class="breakdown-bar-track"><div class="breakdown-bar-fill" style="width:${(d.count / maxDept) * 100}%"></div></div>
      <div class="breakdown-count">${d.count}</div>
    </div>
  `).join('');
}

// ---------- Cases list ----------
async function loadCases(filters = {}) {
  try {
    const res = await Api.listCases(filters);
    state.cases = res.cases;
    renderCasesTable();
  } catch (e) {
    console.error(e);
  }
}

function renderCasesTable() {
  const tbody = document.getElementById('case-table-body');
  const empty = document.getElementById('cases-empty');

  if (state.cases.length === 0) {
    tbody.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  tbody.innerHTML = state.cases.map(c => `
    <tr data-id="${c.id}">
      <td><span class="stamp" style="color:var(--red)">${c.case_number}</span></td>
      <td class="case-title-cell">${escapeHtml(c.title)}</td>
      <td><span class="priority-tag priority-tag--${c.priority}">${c.priority}</span></td>
      <td><span class="pill pill--${c.status}">${statusLabel(c.status)}</span></td>
      ${isTaxpayer() ? '' : `<td class="case-meta-cell">${c.assigned_to_name || '—'}</td>`}
      ${isTaxpayer() ? '' : `<td class="case-meta-cell">${c.current_department_name || '—'}</td>`}
      <td class="case-meta-cell">${fmtDate(c.due_date)}</td>
    </tr>
  `).join('');

  tbody.querySelectorAll('tr').forEach(row => {
    row.addEventListener('click', () => openCaseDrawer(row.dataset.id));
  });
}

document.getElementById('filter-apply').addEventListener('click', () => {
  const status = document.getElementById('filter-status').value;
  const department_id = document.getElementById('filter-department').value;
  const filters = {};
  if (status) filters.status = status;
  if (department_id) filters.department_id = department_id;
  loadCases(filters);
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ---------- Case detail drawer ----------
const drawerOverlay = document.getElementById('drawer-overlay');
document.getElementById('drawer-close').addEventListener('click', closeDrawer);
drawerOverlay.addEventListener('click', (e) => { if (e.target === drawerOverlay) closeDrawer(); });

function closeDrawer() { drawerOverlay.hidden = true; state.currentCaseId = null; }

async function openCaseDrawer(id) {
  state.currentCaseId = id;
  try {
    const data = await Api.getCase(id);
    renderDrawer(data);
    drawerOverlay.hidden = false;
  } catch (e) {
    alert(e.message);
  }
}

function renderDrawer(data) {
  const c = data.case;
  const content = document.getElementById('drawer-content');

  const staffOptions = state.staff.map(s => `<option value="${s.id}">${s.full_name} (${ROLE_LABELS[s.role]})</option>`).join('');
  const deptOptions = state.departments.map(d => `<option value="${d.id}">${d.name}</option>`).join('');

  content.innerHTML = `
    <div class="drawer-eyebrow">
      <span class="stamp" style="color:var(--red)">${c.case_number}</span>
      <span class="pill pill--${c.status}">${statusLabel(c.status)}</span>
      <span class="priority-tag priority-tag--${c.priority}">${c.priority}</span>
    </div>
    <h2 class="drawer-case-title">${escapeHtml(c.title)}</h2>
    <p class="drawer-case-desc">${escapeHtml(c.description) || 'No description provided.'}</p>

    <div class="detail-grid">
      <div class="detail-item"><div class="dlabel">Case type</div><div class="dvalue">${c.case_type}</div></div>
      <div class="detail-item"><div class="dlabel">Due date</div><div class="dvalue">${fmtDate(c.due_date)}</div></div>
      ${isTaxpayer() ? '' : `<div class="detail-item"><div class="dlabel">Assigned to</div><div class="dvalue">${c.assigned_to_name || '—'}</div></div>`}
      ${isTaxpayer() ? '' : `<div class="detail-item"><div class="dlabel">Department</div><div class="dvalue">${c.current_department_name || '—'}</div></div>`}
      ${isTaxpayer() ? '' : `<div class="detail-item"><div class="dlabel">File location</div><div class="dvalue">${c.file_location || '—'}</div></div>`}
      ${isTaxpayer() ? '' : `<div class="detail-item"><div class="dlabel">Registered by</div><div class="dvalue">${c.created_by_name || '—'}</div></div>`}
      <div class="detail-item"><div class="dlabel">Created</div><div class="dvalue">${fmtDate(c.created_at)}</div></div>
      ${c.closed_at ? `<div class="detail-item"><div class="dlabel">Closed</div><div class="dvalue">${fmtDate(c.closed_at)}</div></div>` : ''}
    </div>

    ${isStaff() ? `
    <div class="action-row">
      ${canAssign() ? `<button class="btn btn--ghost btn--sm" id="act-assign">Assign / reassign</button>` : ''}
      ${canUpdateStatus() ? `<button class="btn btn--ghost btn--sm" id="act-status">Update status</button>` : ''}
      ${canMove() ? `<button class="btn btn--ghost btn--sm" id="act-move">Move department</button>` : ''}
      <button class="btn btn--ghost btn--sm" id="act-upload">Upload document</button>
      <input type="file" id="file-input" hidden />
    </div>
    <div id="action-panel"></div>
    ` : ''}

    <div class="drawer-section">
      <h4>Movement history</h4>
      <div class="timeline">
        ${data.movements.length === 0 ? '<p style="font-size:13px; color:var(--slate);">No movements recorded yet.</p>' : data.movements.map(m => `
          <div class="timeline-item">
            <div class="timeline-action">${m.from_department_name || 'Unassigned'} → ${m.to_department_name || 'Unassigned'}</div>
            <div class="timeline-meta">${fmtDateTime(m.moved_at)} · moved by ${m.moved_by_name || '—'}</div>
            ${m.reason ? `<div class="timeline-detail">${escapeHtml(m.reason)}</div>` : ''}
          </div>
        `).join('')}
      </div>
    </div>

    <div class="drawer-section">
      <h4>Documents</h4>
      ${data.documents.length === 0 ? '<p style="font-size:13px; color:var(--slate);">No documents uploaded yet.</p>' : data.documents.map(d => `
        <div class="doc-item">
          <div>
            <div class="doc-name">${escapeHtml(d.file_name)}</div>
            <div class="doc-meta">Uploaded ${fmtDateTime(d.uploaded_at)} by ${d.uploaded_by_name || '—'}</div>
          </div>
          <a class="btn btn--ghost btn--sm" href="${Api.downloadDocumentUrl(d.id)}" target="_blank">Download</a>
        </div>
      `).join('')}
    </div>

    <div class="drawer-section">
      <h4>${isTaxpayer() ? 'Updates' : 'Feedback & decisions'}</h4>
      ${data.feedback.length === 0 ? '<p style="font-size:13px; color:var(--slate);">No feedback yet.</p>' : data.feedback.map(f => `
        <div class="feedback-item">
          <div class="feedback-head">
            <span>${f.author_name || '—'} · ${fmtDateTime(f.created_at)}</span>
            ${f.is_internal ? '<span class="feedback-internal-tag">Internal</span>' : ''}
          </div>
          <div class="feedback-body">${escapeHtml(f.comment)}</div>
        </div>
      `).join('')}
      ${canComment() ? `
        <div class="inline-form">
          <textarea id="feedback-input" placeholder="Add a comment or decision…"></textarea>
        </div>
        <div style="display:flex; align-items:center; gap:10px; margin-top:8px;">
          <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:var(--slate); text-transform:none; font-weight:500;">
            <input type="checkbox" id="feedback-internal" checked style="width:auto;" /> Internal only
          </label>
          <button class="btn btn--primary btn--sm" id="submit-feedback">Submit</button>
        </div>
      ` : ''}
    </div>
  `;

  if (isStaff()) wireDrawerActions(c);
  if (canComment()) {
    document.getElementById('submit-feedback').addEventListener('click', async () => {
      const comment = document.getElementById('feedback-input').value.trim();
      if (!comment) return;
      const isInternal = document.getElementById('feedback-internal').checked;
      try {
        await Api.addFeedback(c.id, comment, isInternal);
        openCaseDrawer(c.id);
      } catch (e) { alert(e.message); }
    });
  }
}

function wireDrawerActions(c) {
  const panel = document.getElementById('action-panel');

  const assignBtn = document.getElementById('act-assign');
  if (assignBtn) assignBtn.addEventListener('click', () => {
    const staffOptions = state.staff.map(s => `<option value="${s.id}" ${s.id === c.assigned_to ? 'selected' : ''}>${s.full_name} (${ROLE_LABELS[s.role]})</option>`).join('');
    panel.innerHTML = `
      <div class="inline-form">
        <select id="assign-select">${staffOptions}</select>
        <button class="btn btn--primary btn--sm" id="confirm-assign">Assign</button>
      </div>`;
    document.getElementById('confirm-assign').addEventListener('click', async () => {
      const val = document.getElementById('assign-select').value;
      try { await Api.assignCase(c.id, val); openCaseDrawer(c.id); loadCases(); }
      catch (e) { alert(e.message); }
    });
  });

  const statusBtn = document.getElementById('act-status');
  if (statusBtn) statusBtn.addEventListener('click', () => {
    const statuses = ['new', 'under_review', 'assigned', 'in_progress', 'pending_closure', 'closed', 'archived'];
    const options = statuses.map(s => `<option value="${s}" ${s === c.status ? 'selected' : ''} ${(s === 'closed' || s === 'archived') && !canClose() ? 'disabled' : ''}>${statusLabel(s)}</option>`).join('');
    panel.innerHTML = `
      <div class="inline-form">
        <select id="status-select">${options}</select>
        <button class="btn btn--primary btn--sm" id="confirm-status">Update</button>
      </div>
      ${!canClose() ? '<p style="font-size:11.5px; color:var(--slate-dim); margin-top:6px;">Only the Commissioner or Registry Department can close/archive a case.</p>' : ''}
    `;
    document.getElementById('confirm-status').addEventListener('click', async () => {
      const val = document.getElementById('status-select').value;
      try { await Api.updateStatus(c.id, val); openCaseDrawer(c.id); loadCases(); }
      catch (e) { alert(e.message); }
    });
  });

  const moveBtn = document.getElementById('act-move');
  if (moveBtn) moveBtn.addEventListener('click', () => {
    const deptOptions = state.departments.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
    panel.innerHTML = `
      <div class="inline-form" style="flex-wrap:wrap;">
        <select id="move-dept">${deptOptions}</select>
        <textarea id="move-reason" placeholder="Reason for movement…" style="flex-basis:100%;"></textarea>
        <button class="btn btn--primary btn--sm" id="confirm-move">Record movement</button>
      </div>`;
    document.getElementById('confirm-move').addEventListener('click', async () => {
      const to_department_id = document.getElementById('move-dept').value;
      const reason = document.getElementById('move-reason').value.trim();
      try { await Api.moveCase(c.id, { to_department_id, reason }); openCaseDrawer(c.id); loadCases(); }
      catch (e) { alert(e.message); }
    });
  });

  const uploadBtn = document.getElementById('act-upload');
  const fileInput = document.getElementById('file-input');
  if (uploadBtn) uploadBtn.addEventListener('click', () => fileInput.click());
  if (fileInput) fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try { await Api.uploadDocument(c.id, file); openCaseDrawer(c.id); }
    catch (e) { alert(e.message); }
  });
}

// ---------- New case modal ----------
const newCaseOverlay = document.getElementById('new-case-overlay');
document.getElementById('new-case-btn').addEventListener('click', () => { newCaseOverlay.hidden = false; });
document.getElementById('new-case-close').addEventListener('click', () => { newCaseOverlay.hidden = true; });
newCaseOverlay.addEventListener('click', (e) => { if (e.target === newCaseOverlay) newCaseOverlay.hidden = true; });

document.getElementById('new-case-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorBox = document.getElementById('new-case-error');
  errorBox.hidden = true;

  const payload = {
    title: document.getElementById('nc-title').value.trim(),
    description: document.getElementById('nc-description').value.trim(),
    case_type: document.getElementById('nc-type').value,
    priority: document.getElementById('nc-priority').value,
    taxpayer_pin: document.getElementById('nc-pin').value.trim(),
    due_date: document.getElementById('nc-due').value || null,
    current_department_id: document.getElementById('nc-department').value || null,
    file_location: document.getElementById('nc-location').value.trim(),
  };

  try {
    await Api.createCase(payload);
    newCaseOverlay.hidden = true;
    document.getElementById('new-case-form').reset();
    loadCases();
    if (isStaff()) loadOverview();
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.hidden = false;
  }
});

// ---------- Audit trail ----------
async function loadAuditTrail() {
  if (!canSeeAudit()) return;
  try {
    const res = await Api.auditTrail({ limit: 200 });
    const tbody = document.getElementById('audit-table-body');
    tbody.innerHTML = res.audit_trail.map(a => `
      <tr>
        <td class="case-meta-cell">${fmtDateTime(a.created_at)}</td>
        <td>${a.case_number ? `<span class="stamp" style="color:var(--red)">${a.case_number}</span>` : '—'}</td>
        <td>${a.user_name || '—'}</td>
        <td><strong>${a.action.replace(/_/g, ' ')}</strong></td>
        <td class="case-meta-cell">${escapeHtml(a.details || '')}</td>
      </tr>
    `).join('');
  } catch (e) { console.error(e); }
}

// ---------- Logout ----------
document.getElementById('logout-btn').addEventListener('click', () => {
  Auth.clear();
  window.location.href = 'login.html';
});

init();
