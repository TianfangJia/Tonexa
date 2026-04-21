// ── Scoring types ──────────────────────────────────────────────────────────

/** Pitch accuracy grade for a single sung note. */
export type PitchGrade = "green" | "yellow" | "red" | "darkred" | "unmatched";

/** Rhythm accuracy grade for a single onset. */
export type RhythmGrade = "green" | "yellow" | "red" | "unmatched";

/** Combined grade (worst of pitch + rhythm). */
export type NoteGrade = "green" | "yellow" | "red" | "darkred" | "unmatched";

/** Result for a single sung note. */
export interface NoteResult {
  targetMidi: number;
  detectedFrequency: number | null;
  detectedMidi: number | null;
  centsDeviation: number | null;
  pitchGrade: PitchGrade;
  expectedOnsetSec: number;
  detectedOnsetSec: number | null;
  onsetOffsetMs: number | null;
  rhythmGrade: RhythmGrade;
  combinedGrade: NoteGrade;
}

/** Measure-level result. */
export interface MeasureResult {
  measureNumber: number;
  noteResults: NoteResult[];
  passPct: number;
  passed: boolean;
}

/** Full performance summary. */
export interface PerformanceSummary {
  totalNotes: number;
  passedNotes: number;
  scorePct: number;
  measureResults: MeasureResult[];
}

/** Pitch tolerance thresholds (in cents). Configurable. */
export const PITCH_THRESHOLDS = {
  green: 50,    // ≤ quarter tone
  yellow: 100,  // ≤ half tone
  red: 200,     // ≤ whole tone
  // > red → darkred
} as const;

/** Rhythm onset tolerance thresholds (in milliseconds). Configurable. */
export const RHYTHM_THRESHOLDS = {
  green: 50,   // comfortable
  yellow: 100, // near threshold
  // > yellow → red (fail)
} as const;

/** Minimum percentage of notes that must pass for a measure to pass. */
export const MEASURE_PASS_THRESHOLD = 0.8; // 80%

/** Minimum pitch clarity (0-1) from pitchy to accept a detection. */
export const PITCH_CLARITY_THRESHOLD = 0.85;
