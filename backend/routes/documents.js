const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { logAction } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate);

const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } }); // 20MB cap

// POST /api/documents/:caseId - upload a document to a case
router.post('/:caseId', upload.single('file'), async (req, res) => {
  const { caseId } = req.params;
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const caseCheck = await pool.query('SELECT id FROM cases WHERE id = $1', [caseId]);
    if (caseCheck.rows.length === 0) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Case not found' });
    }

    const result = await pool.query(
      `INSERT INTO case_documents (case_id, file_name, file_path, file_type, file_size_bytes, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [caseId, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size, req.user.id]
    );

    await logAction({
      caseId, userId: req.user.id, action: 'DOCUMENT_UPLOADED', details: req.file.originalname,
    });

    res.status(201).json({ message: 'Document uploaded successfully', document: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error while uploading document' });
  }
});

// GET /api/documents/download/:id - download a document
router.get('/download/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM case_documents WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Document not found' });

    const doc = result.rows[0];
    const filePath = path.join(uploadDir, doc.file_path);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing from storage' });

    res.download(filePath, doc.file_name);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error while downloading document' });
  }
});

module.exports = router;
