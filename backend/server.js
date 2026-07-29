const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const caseRoutes = require('./routes/cases');
const documentRoutes = require('./routes/documents');
const reportRoutes = require('./routes/reports');
const userRoutes = require('./routes/users');
const departmentRoutes = require('./routes/departments');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok', system: 'IDCTS - KRA Case Tracking System' }));

app.use('/api/auth', authRoutes);
app.use('/api/cases', caseRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/users', userRoutes);
app.use('/api/departments', departmentRoutes);

// Serve the frontend from the same server/port as the API.
// The frontend folder sits alongside "backend" in the project root.
const frontendPath = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendPath));

// Any request that isn't an API call and isn't a real static file falls back to login.html.
// This lets the login page load at "/" too, without touching the frontend's own routing.
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(frontendPath, 'login.html'));
});

// Fallback error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong on the server' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`IDCTS running at http://localhost:${PORT}/login.html`);
});
