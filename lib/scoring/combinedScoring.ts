// ── Combined pitch + rhythm scoring for Modes 3 & 4 ───────────────────────

import type {
  NoteEvent,
  ParsedMelody,
} from "@/types/music";
import type {
  NoteResult,
  MeasureResult,
  PerformanceSummary,
  PitchGrade,
  RhythmGrade,
  NoteGrade,
} from "@/types/scoring";
import { MEASURE_PASS_THRESHOLD } from "@/types/scoring";
import { gradePitch, pitchPasses } from "./pitchScoring";
import { alignOnsets, rhythmPasses } from "./rhythmScoring";

export interface DetectedNote {
  frequencyHz: number | null;
  onsetSec: number;
}

/**
 * Score a complete performance against the ground-truth melody.
 * Matches detected notes to expected notes by onset proximity.
 */
export function scorePerformance(
  melody: ParsedMelody,
  detected: DetectedNote[]
): PerformanceSummary {
  const targetNotes = melody.notes.filter((n) => !n.isRest);
  const detectedOnsets = detected.map((d) => d.onsetSec);
  const expectedOnsets = targetNotes.map((n) => n.startSec);

  const alignments = alignOnsets(expectedOnsets, detectedOnsets);

  const noteResults: NoteResult[] = targetNotes.map((target, i) => {
    const alignment = alignments[i];
    const detectedSec = alignment.detectedSec;
    const matchedDetected =
      detectedSec !== null
        ? detected.find((d) => Math.abs(d.onsetSec - detectedSec) < 0.01) ?? null
        : null;

    let pitchGrade: PitchGrade = "unmatched";
    let centsDeviation: number | null = null;
    let detectedMidi: number | null = null;

    if (matchedDetected?.frequencyHz) {
      const pe = gradePitch(matchedDetected.frequencyHz, target.midi);
      pitchGrade = pe.grade;
      centsDeviation = pe.centsDeviation;
      detectedMidi = pe.detectedMidi;
    }

    const rhythmGrade: RhythmGrade = alignment.grade as RhythmGrade;
    const combinedGrade: NoteGrade = combinedWorstGrade(pitchGrade, rhythmGrade);

    return {
      targetMidi: target.midi,
      detectedFrequency: matchedDetected?.frequencyHz ?? null,
      detectedMidi,
      centsDeviation,
      pitchGrade,
      expectedOnsetSec: target.startSec,
      detectedOnsetSec: alignment.detectedSec,
      onsetOffsetMs: alignment.offsetMs,
      rhythmGrade,
      combinedGrade,
    };
  });

  // Group into measures
  const measureMap = new Map<number, NoteResult[]>();
  targetNotes.forEach((target, i) => {
    if (!measureMap.has(target.measure)) measureMap.set(target.measure, []);
    measureMap.get(target.measure)!.push(noteResults[i]);
  });

  const measureResults: MeasureResult[] = Array.from(measureMap.entries()).map(
    ([measureNumber, results]) => {
      const passPct =
        results.filter(
          (r) => pitchPasses(r.pitchGrade) && rhythmPasses(r.rhythmGrade)
        ).length / results.length;
      return {
        measureNumber,
        noteResults: results,
        passPct,
        passed: passPct >= MEASURE_PASS_THRESHOLD,
      };
    }
  );

  const totalNotes = noteResults.length;
  const passedNotes = noteResults.filter(
    (r) => pitchPasses(r.pitchGrade) && rhythmPasses(r.rhythmGrade)
  ).length;

  return {
    totalNotes,
    passedNotes,
    scorePct: totalNotes > 0 ? (passedNotes / totalNotes) * 100 : 0,
    measureResults,
  };
}

/** Score a single measure for Modes 3. */
export function scoreMeasure(
  measureNotes: NoteEvent[],
  detected: DetectedNote[],
  melody: ParsedMelody
): MeasureResult {
  const partial: ParsedMelody = { ...melody, notes: measureNotes };
  const summary = scorePerformance(partial, detected);
  return summary.measureResults[0] ?? {
    measureNumber: measureNotes[0]?.measure ?? 1,
    noteResults: [],
    passPct: 0,
    passed: false,
  };
}

/** Worst-case combined grade (pitch + rhythm). */
function combinedWorstGrade(pitch: PitchGrade, rhythm: RhythmGrade): NoteGrade {
  const ORDER: NoteGrade[] = ["green", "yellow", "red", "darkred", "unmatched"];
  const pitchRank = ORDER.indexOf(pitch as NoteGrade);
  const rhythmRank = ORDER.indexOf(rhythm as NoteGrade);
  return ORDER[Math.max(pitchRank, rhythmRank)];
}
