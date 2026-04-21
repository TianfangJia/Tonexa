// ── Session and DB record types ────────────────────────────────────────────

export type PracticeMode = 1 | 2 | 3 | 4;

export interface StudentRecord {
  id: string;
  name: string;
  created_at: string;
}

export interface SessionRecord {
  id: string;
  student_id: string;
  melody_id: string;
  transposition: string;
  started_at: string;
  updated_at: string;
  // Joined
  students?: StudentRecord;
}

export interface PracticeResultRecord {
  id: string;
  session_id: string;
  mode: PracticeMode;
  completed: boolean;
  score_pct: number | null;
  details: Record<string, unknown> | null;
  updated_at: string;
}

export interface RecordingRecord {
  id: string;
  session_id: string;
  storage_path: string;
  duration_seconds: number | null;
  created_at: string;
}

/** Full admin row: session + student + melody + results + recording. */
export interface AdminStudentRow {
  session: SessionRecord;
  studentName: string;
  melodyTitle: string;
  results: Partial<Record<PracticeMode, PracticeResultRecord>>;
  recording: RecordingRecord | null;
}
