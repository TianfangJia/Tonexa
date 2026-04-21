// ── HMM Score Follower ─────────────────────────────────────────────────────
// Online Markov score following for Mode 4.
//
// States: each non-rest note in the melody is one HMM state.
// Transitions: stay | advance | skip-one (error recovery).
// Emissions: Gaussian likelihood via gradePitch (KL-divergence flavoured).
//
// Call update() on every pitch sample; it returns the most-likely score position.

import type { NoteEvent } from "@/types/music";
import { gradePitch, gradeToEmissionProb } from "./pitchScoring";

export interface ScorePosition {
  noteIndex: number;       // most likely current note index
  confidence: number;      // probability mass at most likely state (0-1)
  probs: Float64Array;     // full distribution over all states
}

export class ScoreFollower {
  private readonly notes: NoteEvent[];
  private alpha: Float64Array;

  // Transition probabilities (rows = from, cols = to relative offset)
  private readonly pStay    = 0.55;
  private readonly pAdvance = 0.38;
  private readonly pSkip    = 0.07; // skip one note (missed note recovery)

  constructor(melodyNotes: NoteEvent[]) {
    this.notes = melodyNotes.filter((n) => !n.isRest);
    const N = this.notes.length;
    this.alpha = new Float64Array(N);
    this.alpha[0] = 1.0; // begin at first note
  }

  /** Feed one pitch observation; returns updated score position. */
  update(frequencyHz: number, clarity: number): ScorePosition {
    const N = this.notes.length;

    // ── Emission probabilities ─────────────────────────────────
    const emission = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const { grade } = gradePitch(frequencyHz, this.notes[i].midi, clarity);
      emission[i] = gradeToEmissionProb(grade);
    }

    // ── Markov transition step ─────────────────────────────────
    const next = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      next[i] += this.alpha[i]       * this.pStay;
      if (i > 0) next[i] += this.alpha[i - 1] * this.pAdvance;
      if (i > 1) next[i] += this.alpha[i - 2] * this.pSkip;
    }

    // ── Apply emission ─────────────────────────────────────────
    for (let i = 0; i < N; i++) next[i] *= emission[i];

    // ── Normalise ──────────────────────────────────────────────
    const sum = next.reduce((a, b) => a + b, 0);
    if (sum > 1e-12) {
      for (let i = 0; i < N; i++) next[i] /= sum;
    } else {
      // Pitch completely unclear — spread probability forward from current peak
      const peak = this.getMostLikelyIndex();
      next.fill(0);
      next[peak] = 0.7;
      if (peak + 1 < N) next[peak + 1] = 0.3;
    }

    this.alpha = next;

    const noteIndex = this.getMostLikelyIndex();
    return { noteIndex, confidence: this.alpha[noteIndex], probs: new Float64Array(this.alpha) };
  }

  /** Call when the student stops singing (silence / end of phrase). */
  onSilence(): void {
    // Let probability diffuse slightly forward — silence often precedes an advance
    const N = this.notes.length;
    const next = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      next[i]           += this.alpha[i] * 0.65;
      if (i + 1 < N) next[i + 1] += this.alpha[i] * 0.35;
    }
    const sum = next.reduce((a, b) => a + b, 0);
    if (sum > 0) for (let i = 0; i < N; i++) next[i] /= sum;
    this.alpha = next;
  }

  /** Reset to beginning of score. */
  reset(): void {
    this.alpha.fill(0);
    this.alpha[0] = 1.0;
  }

  getNotes(): NoteEvent[] { return this.notes; }

  private getMostLikelyIndex(): number {
    let best = 0;
    for (let i = 1; i < this.alpha.length; i++) {
      if (this.alpha[i] > this.alpha[best]) best = i;
    }
    return best;
  }
}
