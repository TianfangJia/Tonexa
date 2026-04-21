// ── Rhythm / onset scoring ─────────────────────────────────────────────────

import type { RhythmGrade } from "@/types/scoring";
import { RHYTHM_THRESHOLDS } from "@/types/scoring";

export interface OnsetAlignment {
  expectedSec: number;
  detectedSec: number | null;
  offsetMs: number | null;
  grade: RhythmGrade;
}

/**
 * Align detected onsets to expected onsets using nearest-neighbor matching.
 *
 * @param expectedOnsetsSec  Sorted list of expected onset times (seconds)
 * @param detectedOnsetsSec  Detected onset times from the student (seconds)
 * @returns One alignment per expected onset (unmatched = null detected)
 */
export function alignOnsets(
  expectedOnsetsSec: number[],
  detectedOnsetsSec: number[]
): OnsetAlignment[] {
  const used = new Set<number>();

  return expectedOnsetsSec.map((expected) => {
    // Find the closest unused detected onset within a search window (500ms)
    let bestIdx = -1;
    let bestDiff = Infinity;

    for (let i = 0; i < detectedOnsetsSec.length; i++) {
      if (used.has(i)) continue;
      const diff = Math.abs(detectedOnsetsSec[i] - expected);
      if (diff < bestDiff && diff < 0.5) {
        bestDiff = diff;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) {
      return { expectedSec: expected, detectedSec: null, offsetMs: null, grade: "unmatched" };
    }

    used.add(bestIdx);
    const offsetMs = (detectedOnsetsSec[bestIdx] - expected) * 1000;
    const absMs = Math.abs(offsetMs);

    const grade: RhythmGrade =
      absMs <= RHYTHM_THRESHOLDS.green
        ? "green"
        : absMs <= RHYTHM_THRESHOLDS.yellow
        ? "yellow"
        : "red";

    return {
      expectedSec: expected,
      detectedSec: detectedOnsetsSec[bestIdx],
      offsetMs,
      grade,
    };
  });
}

/** Returns true if the rhythm grade counts as a pass. */
export function rhythmPasses(grade: RhythmGrade): boolean {
  return grade === "green" || grade === "yellow";
}

/** Map rhythm grade to CSS color. */
export function rhythmGradeColor(grade: RhythmGrade): string {
  switch (grade) {
    case "green":  return "#22c55e";
    case "yellow": return "#eab308";
    case "red":    return "#ef4444";
    default:       return "#94a3b8";
  }
}
