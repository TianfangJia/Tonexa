-- ============================================================
-- Ear Training App – initial schema
-- Run via: supabase db push  OR  paste into Supabase SQL editor
-- ============================================================

-- Melodies uploaded by admin
CREATE TABLE IF NOT EXISTS melodies (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title                 TEXT NOT NULL,
  musicxml_content      TEXT NOT NULL,
  tempo                 INTEGER NOT NULL DEFAULT 120,
  beats_per_measure     INTEGER NOT NULL DEFAULT 4,
  beat_unit             INTEGER NOT NULL DEFAULT 4,
  default_key           TEXT NOT NULL DEFAULT 'C',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Students (created when they type their name)
CREATE TABLE IF NOT EXISTS students (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One session per student × melody × practice sitting
CREATE TABLE IF NOT EXISTS sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  melody_id     UUID NOT NULL REFERENCES melodies(id) ON DELETE CASCADE,
  transposition TEXT NOT NULL DEFAULT 'C',
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-mode results (one row per mode per session)
CREATE TABLE IF NOT EXISTS practice_results (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  mode        INTEGER NOT NULL CHECK (mode BETWEEN 1 AND 4),
  completed   BOOLEAN NOT NULL DEFAULT FALSE,
  score_pct   NUMERIC(5,2),
  details     JSONB,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, mode)
);

-- Mode 4 raw audio recordings
CREATE TABLE IF NOT EXISTS recordings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  storage_path     TEXT NOT NULL,
  duration_seconds NUMERIC(10,2),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Storage bucket for recordings ──────────────────────────
-- Run this in Supabase dashboard Storage tab, or via CLI:
-- supabase storage create recordings --public=false

-- ── Row-level security (minimal for MVP) ───────────────────
ALTER TABLE melodies          ENABLE ROW LEVEL SECURITY;
ALTER TABLE students          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_results  ENABLE ROW LEVEL SECURITY;
ALTER TABLE recordings        ENABLE ROW LEVEL SECURITY;

-- All reads/writes go through the service-role key (server-side only)
-- or the anon key with these permissive policies for the MVP.
-- TODO: tighten to per-user policies when auth is added.

CREATE POLICY "anon_read_melodies"   ON melodies  FOR SELECT USING (true);
CREATE POLICY "anon_insert_students" ON students  FOR INSERT WITH CHECK (true);
CREATE POLICY "anon_read_students"   ON students  FOR SELECT USING (true);
CREATE POLICY "anon_all_sessions"    ON sessions  FOR ALL  USING (true);
CREATE POLICY "anon_all_results"     ON practice_results FOR ALL USING (true);
CREATE POLICY "anon_read_recordings" ON recordings FOR SELECT USING (true);
CREATE POLICY "anon_insert_recordings" ON recordings FOR INSERT WITH CHECK (true);

-- Melodies insert/update requires service role (admin only via API)
CREATE POLICY "service_manage_melodies" ON melodies
  FOR ALL USING (auth.role() = 'service_role');
