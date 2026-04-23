"use client";
// ── Melody-mode measure card ──────────────────────────────────────────────
// Left: target measure as sheet music. Right: per-measure piano roll with
// real-time pitch line and post-singing colour grades. The pitch line is
// driven imperatively through `rollRef` — the parent forwards a ref to the
// inner MeasurePianoRoll so the hot path (one update per audio frame) can
// bypass React reconciliation.

import React, { forwardRef, useEffect, useRef, useState } from "react";
import ScoreRenderer, { type ScoreRendererHandle } from "@/components/score/ScoreRenderer";
import MeasurePianoRoll, {
  type MeasurePianoRollHandle,
} from "@/components/piano-roll/MeasurePianoRoll";
import type { NoteEvent } from "@/types/music";
import type { MeasureGrade } from "@/components/piano-roll/MeasurePianoRoll";

// Notehead colours mirror the piano-roll grade palette so the student sees
// the same colour language on both target score and target roll.
const SCORE_GRADE_COLORS: Record<MeasureGrade, string> = {
  green:  "#16a34a",
  yellow: "#ca8a04",
  red:    "#dc2626",
};

interface Props {
  measureLabel:   string;
  targetXml:      string;
  measureNotes:   NoteEvent[];
  measureDuration: number;
  noteGrades:     Map<number, MeasureGrade>;
  /** Grades to apply to the target score's noteheads. Usually matches
   *  `noteGrades`, but the parent can pass a different map when the score
   *  has already advanced to the next measure while the roll lags behind. */
  scoreGrades?:   Map<number, MeasureGrade>;
  isRecording:    boolean;
  className?:     string;
}

const MelodyMeasureCard = forwardRef<MeasurePianoRollHandle, Props>(
  function MelodyMeasureCard(
    { measureLabel, targetXml, measureNotes, measureDuration,
      noteGrades, scoreGrades, isRecording, className },
    ref,
  ) {
    const scoreRef = useRef<ScoreRendererHandle>(null);
    // Bumped by ScoreRenderer after each render finishes — lets the colour
    // effect re-fire once the note DOM map has been rebuilt. Without this the
    // effect could call colorNote before the SVG is in place and silently
    // no-op.
    const [renderTick, setRenderTick] = useState(0);
    const gradesForScore = scoreGrades ?? noteGrades;

    useEffect(() => {
      const handle = scoreRef.current;
      if (!handle) return;
      handle.clearNoteColors();
      gradesForScore.forEach((grade, idx) => {
        handle.colorNote(idx, SCORE_GRADE_COLORS[grade]);
      });
    }, [renderTick, gradesForScore]);

    return (
      <div className={`rounded-2xl border border-zinc-100 p-4 ${className ?? ""}`}>
        <p className="mb-3 text-base font-semibold uppercase tracking-wide text-zinc-500">
          Measure by Measure Practice — {measureLabel}
        </p>
        <div className="flex flex-col gap-4">

          {/* Target score — full width on mobile, two-thirds ≥ sm, half ≥ xl */}
          <div className="w-full sm:w-2/3 xl:w-1/2 overflow-hidden">
            <div className="px-3 pt-2 pb-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">Target</p>
            </div>
            <ScoreRenderer
              ref={scoreRef}
              musicXml={targetXml}
              className="w-full"
              onContentHeightChange={() => setRenderTick((t) => t + 1)}
            />
          </div>

          {/* Piano roll with live pitch line (driven via ref) */}
          <div className="rounded-xl border border-zinc-100 overflow-hidden">
            <div className="px-3 pt-2 pb-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
                Sing along
              </p>
            </div>
            <MeasurePianoRoll
              ref={ref}
              targetNotes={measureNotes}
              measureDuration={measureDuration}
              noteGrades={noteGrades}
              isRecording={isRecording}
              className="w-full"
            />
          </div>

        </div>
      </div>
    );
  },
);

export default MelodyMeasureCard;
