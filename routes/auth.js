const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { logAction } = require('../middleware/audit');
require('dotenv').config();

const router = express.Router();

const VALID_ROLES = ['kra_officer', 'investigations_dept', 'registry_dept', 'commissioner', 'taxpayer'];

// POST /api/auth/register
// Open registration is only sensible for taxpayers in a real deployment; staff accounts
// would normally be created by an admin. We keep one endpoint but flag that in the response.
router.post('/register', async (req, res) => {
  const { full_name, email, password, role, department_id, phone } = req.body;

  if (!full_name || !email || !password || !role) {
    return res.status(400).json({ error: 'full_name, email, password and role are required' });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (full_name, email, password_hash, role, department_id, phone)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, full_name, email, role, department_id, created_at`,
      [full_name, email, password_hash, role, department_id || null, phone || null]
    );

    const user = result.rows[0];
    await logAction({ userId: user.id, action: 'USER_REGISTERED', details: `Role: ${role}` });

    res.status(201).json({ message: 'Account created successfully', user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error while registering user' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];
    if (!user.is_active) {
      return res.status(403).json({ error: 'This account has been deactivated' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      {
        id: user.id,
        full_name: user.full_name,
        role: user.role,
        department_id: user.department_id,
      },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    await logAction({ userId: user.id, action: 'USER_LOGIN', details: `Email: ${email}` });

    res.json({
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        department_id: user.department_id,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error while logging in' });
  }
});

module.exports = router;
