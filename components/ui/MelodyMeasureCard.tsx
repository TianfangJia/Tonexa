"use client";
// ── Melody-mode measure card ──────────────────────────────────────────────
// Left: target measure as sheet music. Right: per-measure piano roll with
// real-time pitch line and post-singing colour grades. The pitch line is
// driven imperatively through `rollRef` — the parent forwards a ref to the
// inner MeasurePianoRoll so the hot path (one update per audio frame) can
// bypass React reconciliation.

import React, { forwardRef } from "react";
import ScoreRenderer from "@/components/score/ScoreRenderer";
import MeasurePianoRoll, {
  type MeasurePianoRollHandle,
} from "@/components/piano-roll/MeasurePianoRoll";
import type { NoteEvent } from "@/types/music";
import type { MeasureGrade } from "@/components/piano-roll/MeasurePianoRoll";

interface Props {
  measureLabel:   string;
  targetXml:      string;
  measureNotes:   NoteEvent[];
  measureDuration: number;
  noteGrades:     Map<number, MeasureGrade>;
  isRecording:    boolean;
  className?:     string;
}

const MelodyMeasureCard = forwardRef<MeasurePianoRollHandle, Props>(
  function MelodyMeasureCard(
    { measureLabel, targetXml, measureNotes, measureDuration,
      noteGrades, isRecording, className },
    ref,
  ) {
    return (
      <div className={`rounded-2xl border border-zinc-100 p-4 ${className ?? ""}`}>
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-400">
          Measure by Measure Practice — {measureLabel}
        </p>
        <div className="flex flex-col gap-4">

          {/* Target score */}
          <div className="overflow-hidden">
            <div className="px-3 pt-2 pb-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">Target</p>
            </div>
            <ScoreRenderer musicXml={targetXml} className="w-full" />
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
