// ── Core music data types ──────────────────────────────────────────────────

/** A single parsed note from MusicXML, with absolute timing. */
export interface NoteEvent {
  /** MIDI note number (60 = C4, 69 = A4). -1 for rests. */
  midi: number;
  /** Start time in seconds from beginning of piece. */
  startSec: number;
  /** Duration in seconds. */
  durationSec: number;
  /** 1-indexed measure number. */
  measure: number;
  /** 0-indexed note position within the measure. */
  indexInMeasure: number;
  /** Whether this event is a rest. */
  isRest: boolean;
}

/** Parsed melody ready for practice. */
export interface ParsedMelody {
  notes: NoteEvent[];
  tempo: number;
  beatsPerMeasure: number;
  beatUnit: number;
  /** Total number of measures. */
  measureCount: number;
  /** Beat duration in seconds. */
  beatDurationSec: number;
  /** Measure duration in seconds. */
  measureDurationSec: number;
  /** Key detected from the XML key signature (e.g. "G", "Bb"). */
  defaultKey?: TranspositionKey;
}

/** Melody record as stored in the database. */
export interface MelodyRecord {
  id: string;
  title: string;
  musicxml_content: string;
  tempo: number;
  beats_per_measure: number;
  beat_unit: number;
  default_key: string;
  created_at: string;
}

/** Available transposition keys shown to the user. */
export const TRANSPOSITION_KEYS = [
  "C", "C#", "Db", "D", "D#", "Eb",
  "E", "F", "F#", "Gb", "G", "G#",
  "Ab", "A", "A#", "Bb", "B",
] as const;

export type TranspositionKey = typeof TRANSPOSITION_KEYS[number];

/** Semitone offset from C for each key name. */
export const KEY_TO_SEMITONES: Record<TranspositionKey, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3,
  E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8,
  Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};

/** Supported time signatures. */
export type TimeSignature = "4/4" | "3/4" | "2/4" | "6/8";
