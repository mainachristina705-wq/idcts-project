const express = require('express');
const pool = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// GET /api/users/me - current user profile
router.get('/me', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, full_name, email, role, department_id, phone, created_at FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/users/staff - list staff (for assignment dropdowns). Not visible to taxpayers.
router.get('/staff', authorize('kra_officer', 'investigations_dept', 'registry_dept', 'commissioner'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, full_name, email, role, department_id FROM users
       WHERE role != 'taxpayer' AND is_active = TRUE ORDER BY full_name`
    );
    res.json({ staff: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
