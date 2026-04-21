// ── Pitch scoring ──────────────────────────────────────────────────────────

import type { PitchGrade } from "@/types/scoring";
import { freqToMidi, midiToFreq, centsBetween } from "@/lib/utils/midiUtils";

export interface PitchEvaluation {
  centsDeviation: number;
  grade: PitchGrade;
  detectedMidi: number;
  isOctaveOff: boolean;
  likelihood: number;
}

/**
 * Grade a detected frequency against a target MIDI note using Gaussian
 * likelihood in cents space. Clarity widens the acceptance window so
 * uncertain detections are penalised less than confident wrong ones.
 *
 * Octave tolerance: correct pitch class but wrong octave → capped at yellow.
 */
export function gradePitch(
  frequencyHz: number,
  targetMidi: number,
  clarity: number = 0.9
): PitchEvaluation {
  const detectedMidi = freqToMidi(frequencyHz);

  // Find closest octave match
  let bestCents = Infinity;
  let bestOctave = 0;
  for (let octave = -2; octave <= 2; octave++) {
    const candidate = midiToFreq(targetMidi + octave * 12);
    const cents = Math.abs(centsBetween(candidate, frequencyHz));
    if (cents < bestCents) {
      bestCents = cents;
      bestOctave = octave;
    }
  }

  const isOctaveOff = bestOctave !== 0;

  // Gaussian likelihood: sigma shrinks as clarity increases
  // → confident detections are graded strictly; uncertain ones leniently
  const sigma = 60 / Math.max(0.5, clarity);
  const likelihood = Math.exp(-(bestCents * bestCents) / (2 * sigma * sigma));

  let grade: PitchGrade;
  if (likelihood > 0.80) grade = "green";
  else if (likelihood > 0.35) grade = "yellow";
  else if (likelihood > 0.10) grade = "red";
  else grade = "darkred";

  // Octave tolerance: if same pitch class but wrong octave, allow it as yellow
  if (isOctaveOff && (grade === "red" || grade === "darkred")) {
    grade = "yellow";
  }

  return { centsDeviation: bestCents, grade, detectedMidi, isOctaveOff, likelihood };
}

/** Returns true if the pitch grade counts as a pass. */
export function pitchPasses(grade: PitchGrade): boolean {
  return grade === "green" || grade === "yellow";
}

/** Map grade to a CSS hex color. */
export function pitchGradeColor(grade: PitchGrade): string {
  switch (grade) {
    case "green":   return "#22c55e";
    case "yellow":  return "#eab308";
    case "red":     return "#ef4444";
    case "darkred": return "#991b1b";
    default:        return "#94a3b8";
  }
}

/** Convert a PitchGrade to an emission probability for HMM score following. */
export function gradeToEmissionProb(grade: PitchGrade): number {
  switch (grade) {
    case "green":   return 0.90;
    case "yellow":  return 0.55;
    case "red":     return 0.15;
    case "darkred": return 0.04;
    default:        return 0.10;
  }
}
