const express = require('express');
const pool = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { logAction } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate);

// Generates a case number like KRA-2026-000123
async function generateCaseNumber() {
  const year = new Date().getFullYear();
  const result = await pool.query(
    `SELECT COUNT(*) FROM cases WHERE case_number LIKE $1`,
    [`KRA-${year}-%`]
  );
  const nextSeq = parseInt(result.rows[0].count, 10) + 1;
  return `KRA-${year}-${String(nextSeq).padStart(6, '0')}`;
}

// POST /api/cases  - register a new case
// Allowed: kra_officer (per Ch 4.6, the officer initiates a case), registry_dept (confirms registration)
router.post('/', authorize('kra_officer', 'registry_dept'), async (req, res) => {
  const {
    title, description, case_type, priority, taxpayer_pin,
    taxpayer_user_id, current_department_id, file_location, due_date,
  } = req.body;

  if (!title) {
    return res.status(400).json({ error: 'title is required' });
  }

  try {
    const case_number = await generateCaseNumber();
    const result = await pool.query(
      `INSERT INTO cases
        (case_number, title, description, case_type, priority, taxpayer_pin,
         taxpayer_user_id, created_by, current_department_id, file_location, due_date, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'new')
       RETURNING *`,
      [
        case_number, title, description || null, case_type || 'general', priority || 'normal',
        taxpayer_pin || null, taxpayer_user_id || null, req.user.id,
        current_department_id || null, file_location || null, due_date || null,
      ]
    );
    const newCase = result.rows[0];

    await logAction({
      caseId: newCase.id, userId: req.user.id, action: 'CASE_CREATED',
      details: `Case ${case_number} registered: "${title}"`,
    });

    res.status(201).json({ message: 'Case registered successfully', case: newCase });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error while creating case' });
  }
});

// GET /api/cases - list cases, scoped by role
// - taxpayer: only their own cases, limited fields (no internal detail)
// - everyone else: all cases (KRA is a shared internal workload); can filter via query params
router.get('/', async (req, res) => {
  const { status, assigned_to, department_id } = req.query;

  try {
    if (req.user.role === 'taxpayer') {
      const result = await pool.query(
        `SELECT id, case_number, title, case_type, status, created_at, updated_at
         FROM cases WHERE taxpayer_user_id = $1 ORDER BY created_at DESC`,
        [req.user.id]
      );
      return res.json({ cases: result.rows });
    }

    const conditions = [];
    const values = [];
    let idx = 1;

    if (status) { conditions.push(`status = $${idx++}`); values.push(status); }
    if (assigned_to) { conditions.push(`assigned_to = $${idx++}`); values.push(assigned_to); }
    if (department_id) { conditions.push(`current_department_id = $${idx++}`); values.push(department_id); }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query(
      `SELECT c.*, u1.full_name AS created_by_name, u2.full_name AS assigned_to_name,
              d.name AS current_department_name
       FROM cases c
       LEFT JOIN users u1 ON c.created_by = u1.id
       LEFT JOIN users u2 ON c.assigned_to = u2.id
       LEFT JOIN departments d ON c.current_department_id = d.id
       ${whereClause}
       ORDER BY c.created_at DESC`,
      values
    );
    res.json({ cases: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error while fetching cases' });
  }
});

// GET /api/cases/:id - case detail with movements, feedback, documents
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const caseResult = await pool.query(
      `SELECT c.*, u1.full_name AS created_by_name, u2.full_name AS assigned_to_name,
              d.name AS current_department_name
       FROM cases c
       LEFT JOIN users u1 ON c.created_by = u1.id
       LEFT JOIN users u2 ON c.assigned_to = u2.id
       LEFT JOIN departments d ON c.current_department_id = d.id
       WHERE c.id = $1`,
      [id]
    );
    if (caseResult.rows.length === 0) {
      return res.status(404).json({ error: 'Case not found' });
    }
    const caseData = caseResult.rows[0];

    if (req.user.role === 'taxpayer' && caseData.taxpayer_user_id !== req.user.id) {
      return res.status(403).json({ error: 'You do not have access to this case' });
    }

    const movements = await pool.query(
      `SELECT m.*, d1.name AS from_department_name, d2.name AS to_department_name,
              u1.full_name AS from_user_name, u2.full_name AS to_user_name,
              u3.full_name AS moved_by_name
       FROM case_movements m
       LEFT JOIN departments d1 ON m.from_department_id = d1.id
       LEFT JOIN departments d2 ON m.to_department_id = d2.id
       LEFT JOIN users u1 ON m.from_user_id = u1.id
       LEFT JOIN users u2 ON m.to_user_id = u2.id
       LEFT JOIN users u3 ON m.moved_by = u3.id
       WHERE m.case_id = $1 ORDER BY m.moved_at ASC`,
      [id]
    );

    // Taxpayers never see internal feedback
    const feedbackQuery = req.user.role === 'taxpayer'
      ? `SELECT f.*, u.full_name AS author_name FROM case_feedback f
         LEFT JOIN users u ON f.author_id = u.id
         WHERE f.case_id = $1 AND f.is_internal = FALSE ORDER BY f.created_at ASC`
      : `SELECT f.*, u.full_name AS author_name FROM case_feedback f
         LEFT JOIN users u ON f.author_id = u.id
         WHERE f.case_id = $1 ORDER BY f.created_at ASC`;
    const feedback = await pool.query(feedbackQuery, [id]);

    const documents = await pool.query(
      `SELECT cd.*, u.full_name AS uploaded_by_name FROM case_documents cd
       LEFT JOIN users u ON cd.uploaded_by = u.id
       WHERE cd.case_id = $1 ORDER BY cd.uploaded_at DESC`,
      [id]
    );

    res.json({
      case: caseData,
      movements: movements.rows,
      feedback: feedback.rows,
      documents: documents.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error while fetching case detail' });
  }
});

// PATCH /api/cases/:id/assign - assign/reassign a case to an officer
// Allowed: kra_officer, registry_dept, commissioner
router.patch('/:id/assign', authorize('kra_officer', 'registry_dept', 'commissioner'), async (req, res) => {
  const { id } = req.params;
  const { assigned_to } = req.body;
  if (!assigned_to) return res.status(400).json({ error: 'assigned_to (user id) is required' });

  try {
    const userCheck = await pool.query('SELECT id, full_name, role FROM users WHERE id = $1', [assigned_to]);
    if (userCheck.rows.length === 0) {
      return res.status(400).json({ error: 'assigned_to user does not exist' });
    }

    const result = await pool.query(
      `UPDATE cases SET assigned_to = $1, status = CASE WHEN status = 'new' THEN 'assigned' ELSE status END,
       updated_at = NOW() WHERE id = $2 RETURNING *`,
      [assigned_to, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Case not found' });

    await logAction({
      caseId: id, userId: req.user.id, action: 'CASE_ASSIGNED',
      details: `Assigned to ${userCheck.rows[0].full_name} (${userCheck.rows[0].role})`,
    });

    res.json({ message: 'Case assigned successfully', case: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error while assigning case' });
  }
});

// PATCH /api/cases/:id/status - update case status
router.patch('/:id/status', authorize('kra_officer', 'investigations_dept', 'registry_dept', 'commissioner'), async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const validStatuses = ['new', 'under_review', 'assigned', 'in_progress', 'pending_closure', 'closed', 'archived'];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
  }
  // Closing/archiving a case is a Commissioner-only decision (final closure authority, Ch 4.6)
  if ((status === 'closed' || status === 'archived') && req.user.role !== 'commissioner' && req.user.role !== 'registry_dept') {
    return res.status(403).json({ error: 'Only the Commissioner or Registry Department can close or archive a case' });
  }

  try {
    const result = await pool.query(
      `UPDATE cases SET status = $1::varchar, updated_at = NOW(),
       closed_by = CASE WHEN $1::varchar = 'closed' THEN $2::int ELSE closed_by END,
       closed_at = CASE WHEN $1::varchar = 'closed' THEN NOW() ELSE closed_at END
       WHERE id = $3 RETURNING *`,
      [status, req.user.id, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Case not found' });

    await logAction({
      caseId: id, userId: req.user.id, action: 'STATUS_UPDATED', details: `New status: ${status}`,
    });

    res.json({ message: 'Case status updated', case: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error while updating status' });
  }
});

// POST /api/cases/:id/move - record movement between departments/officers
router.post('/:id/move', authorize('kra_officer', 'investigations_dept', 'registry_dept', 'commissioner'), async (req, res) => {
  const { id } = req.params;
  const { to_department_id, to_user_id, reason } = req.body;

  try {
    const caseResult = await pool.query('SELECT current_department_id, assigned_to FROM cases WHERE id = $1', [id]);
    if (caseResult.rows.length === 0) return res.status(404).json({ error: 'Case not found' });
    const current = caseResult.rows[0];

    await pool.query(
      `INSERT INTO case_movements (case_id, from_department_id, to_department_id, from_user_id, to_user_id, reason, moved_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, current.current_department_id, to_department_id || null, current.assigned_to, to_user_id || null, reason || null, req.user.id]
    );

    await pool.query(
      `UPDATE cases SET current_department_id = COALESCE($1, current_department_id),
       assigned_to = COALESCE($2, assigned_to), updated_at = NOW() WHERE id = $3`,
      [to_department_id || null, to_user_id || null, id]
    );

    await logAction({
      caseId: id, userId: req.user.id, action: 'CASE_MOVED',
      details: reason || 'Case moved between departments/officers',
    });

    res.json({ message: 'Case movement recorded' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error while recording movement' });
  }
});

// POST /api/cases/:id/feedback - add a time-stamped comment/decision
router.post('/:id/feedback', authorize('kra_officer', 'investigations_dept', 'registry_dept', 'commissioner'), async (req, res) => {
  const { id } = req.params;
  const { comment, is_internal } = req.body;
  if (!comment) return res.status(400).json({ error: 'comment is required' });

  try {
    const result = await pool.query(
      `INSERT INTO case_feedback (case_id, author_id, comment, is_internal)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [id, req.user.id, comment, is_internal !== false]
    );

    await logAction({ caseId: id, userId: req.user.id, action: 'FEEDBACK_SUBMITTED', details: comment.slice(0, 200) });

    res.status(201).json({ message: 'Feedback submitted', feedback: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error while submitting feedback' });
  }
});

module.exports = router;
