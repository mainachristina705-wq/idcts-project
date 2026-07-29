-- Internal Document and Case Tracking System (IDCTS)
-- Kenya Revenue Authority Case Study
-- Database schema

DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS case_feedback CASCADE;
DROP TABLE IF EXISTS case_movements CASCADE;
DROP TABLE IF EXISTS case_documents CASCADE;
DROP TABLE IF EXISTS cases CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS departments CASCADE;

-- Departments a case/document can move between
CREATE TABLE departments (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Users / staff accounts. Five roles per Ch. 4.6 Use Case Diagram:
--   kra_officer          - KRA Officer (Investigator): initiates, reviews, updates cases
--   investigations_dept  - Investigations Dept: assigned to specific cases, reviews and acts
--   registry_dept        - Registry Department: confirms registration, archives closed cases
--   commissioner         - Commissioner: final closure authority on high-priority cases
--   taxpayer             - Taxpayer: external, view-only access to own case status
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(30) NOT NULL CHECK (role IN (
        'kra_officer', 'investigations_dept', 'registry_dept', 'commissioner', 'taxpayer'
    )),
    department_id INTEGER REFERENCES departments(id),
    phone VARCHAR(30),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Cases (excise duty files, audits, investigations, objections, enforcement actions)
CREATE TABLE cases (
    id SERIAL PRIMARY KEY,
    case_number VARCHAR(30) NOT NULL UNIQUE, -- auto-generated e.g. KRA-2026-000123
    title VARCHAR(255) NOT NULL,
    description TEXT,
    case_type VARCHAR(50) NOT NULL DEFAULT 'general', -- audit, investigation, objection, enforcement, general
    priority VARCHAR(20) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','critical')),
    status VARCHAR(30) NOT NULL DEFAULT 'new' CHECK (status IN (
        'new', 'under_review', 'assigned', 'in_progress', 'pending_closure', 'closed', 'archived'
    )),
    taxpayer_pin VARCHAR(30), -- KRA PIN of the taxpayer this case concerns
    taxpayer_user_id INTEGER REFERENCES users(id), -- linked taxpayer account, if any
    created_by INTEGER NOT NULL REFERENCES users(id), -- KRA officer who registered the case
    assigned_to INTEGER REFERENCES users(id), -- currently assigned officer/investigator
    current_department_id INTEGER REFERENCES departments(id),
    file_location VARCHAR(255), -- physical file location (registry shelf/box) or digital path
    due_date DATE,
    closed_by INTEGER REFERENCES users(id), -- normally the Commissioner for high-priority cases
    closed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Documents attached to a case
CREATE TABLE case_documents (
    id SERIAL PRIMARY KEY,
    case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_type VARCHAR(50),
    file_size_bytes INTEGER,
    uploaded_by INTEGER NOT NULL REFERENCES users(id),
    uploaded_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Movement history: tracks a case/file moving between officers/departments
CREATE TABLE case_movements (
    id SERIAL PRIMARY KEY,
    case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    from_department_id INTEGER REFERENCES departments(id),
    to_department_id INTEGER REFERENCES departments(id),
    from_user_id INTEGER REFERENCES users(id),
    to_user_id INTEGER REFERENCES users(id),
    reason TEXT,
    moved_by INTEGER NOT NULL REFERENCES users(id),
    moved_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Feedback / comments / decisions on a case (time-stamped, per Ch 4.6 "Submit Feedback")
CREATE TABLE case_feedback (
    id SERIAL PRIMARY KEY,
    case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    author_id INTEGER NOT NULL REFERENCES users(id),
    comment TEXT NOT NULL,
    is_internal BOOLEAN NOT NULL DEFAULT TRUE, -- internal comments hidden from taxpayer
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Immutable audit trail: every critical action (per Ch 4.6 "Manage Audit Trail")
CREATE TABLE audit_logs (
    id SERIAL PRIMARY KEY,
    case_id INTEGER REFERENCES cases(id) ON DELETE SET NULL,
    user_id INTEGER REFERENCES users(id),
    action VARCHAR(100) NOT NULL, -- e.g. CASE_CREATED, STATUS_UPDATED, CASE_ASSIGNED, CASE_CLOSED, DOCUMENT_UPLOADED
    details TEXT,
    ip_address VARCHAR(50),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cases_status ON cases(status);
CREATE INDEX idx_cases_assigned_to ON cases(assigned_to);
CREATE INDEX idx_cases_taxpayer ON cases(taxpayer_user_id);
CREATE INDEX idx_audit_case ON audit_logs(case_id);
CREATE INDEX idx_movements_case ON case_movements(case_id);

-- Seed departments
INSERT INTO departments (name, description) VALUES
    ('Registry', 'Handles case registration confirmation and archiving of closed cases'),
    ('Investigations', 'Conducts case investigations and enforcement actions'),
    ('Audit', 'Handles excise duty audits and assessments'),
    ('Legal & Objections', 'Handles objections and legal disputes'),
    ('Commissioner Office', 'Final review and closure authority for high-priority cases');
