const express = require('express');
const pool = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);
// Reports are an internal management function - not for taxpayers
router.use(authorize('kra_officer', 'investigations_dept', 'registry_dept', 'commissioner'));

// GET /api/reports/summary - dashboard counts
router.get('/summary', async (req, res) => {
  try {
    const byStatus = await pool.query(
      `SELECT status, COUNT(*)::int AS count FROM cases GROUP BY status`
    );
    const byPriority = await pool.query(
      `SELECT priority, COUNT(*)::int AS count FROM cases GROUP BY priority`
    );
    const overdue = await pool.query(
      `SELECT COUNT(*)::int AS count FROM cases
       WHERE due_date IS NOT NULL AND due_date < CURRENT_DATE AND status NOT IN ('closed','archived')`
    );
    const byDepartment = await pool.query(
      `SELECT d.name, COUNT(c.id)::int AS count
       FROM departments d LEFT JOIN cases c ON c.current_department_id = d.id
       GROUP BY d.name ORDER BY d.name`
    );
    const totalCases = await pool.query(`SELECT COUNT(*)::int AS count FROM cases`);

    res.json({
      total_cases: totalCases.rows[0].count,
      overdue_cases: overdue.rows[0].count,
      by_status: byStatus.rows,
      by_priority: byPriority.rows,
      by_department: byDepartment.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error while generating report' });
  }
});

// GET /api/reports/audit-trail?case_id=&user_id=&limit=
router.get('/audit-trail', authorize('commissioner', 'registry_dept'), async (req, res) => {
  const { case_id, user_id, limit } = req.query;
  const conditions = [];
  const values = [];
  let idx = 1;

  if (case_id) { conditions.push(`a.case_id = $${idx++}`); values.push(case_id); }
  if (user_id) { conditions.push(`a.user_id = $${idx++}`); values.push(user_id); }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const lim = Math.min(parseInt(limit, 10) || 100, 500);

  try {
    const result = await pool.query(
      `SELECT a.*, u.full_name AS user_name, c.case_number
       FROM audit_logs a
       LEFT JOIN users u ON a.user_id = u.id
       LEFT JOIN cases c ON a.case_id = c.id
       ${whereClause}
       ORDER BY a.created_at DESC LIMIT ${lim}`,
      values
    );
    res.json({ audit_trail: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error while fetching audit trail' });
  }
});

module.exports = router;
