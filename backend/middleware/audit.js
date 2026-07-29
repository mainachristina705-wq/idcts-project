const pool = require('../config/db');

// Records an entry in the immutable audit trail.
// Never throws to the caller - a failed audit write should not break the main action,
// but it is logged to the server console for visibility.
async function logAction({ caseId = null, userId = null, action, details = '', ipAddress = null }) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (case_id, user_id, action, details, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [caseId, userId, action, details, ipAddress]
    );
  } catch (err) {
    console.error('Failed to write audit log:', err.message);
  }
}

module.exports = { logAction };
