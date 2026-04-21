"use client";
// ── Melody-mode measure card ──────────────────────────────────────────────
// Two-column layout mirroring RhythmMode's drill card: target (left) vs the
// student's sung melody for the current measure (right). Expects parent to
// supply the single-measure target XML and a pre-built transcription XML
// (or null if no transcription is available yet).

import React from "react";
import ScoreRenderer from "@/components/score/ScoreRenderer";

interface Props {
  /** Label for the header — usually "M{n} ({i}/{N})". */
  measureLabel: string;
  /** MusicXML for the target measure (one-measure standalone). */
  targetXml: string;
  /** MusicXML for the student's transcription (one-measure standalone).
   *  Pass null / undefined to show the empty-state placeholder. */
  yourXml?: string | null;
  /** Which status overlay to show over the "Your melody" pane. `null` lets
   *  the transcription (or empty placeholder) render normally. */
  status?: "recording" | "transcribing" | null;
  className?: string;
}

export default function MelodyMeasureCard({
  measureLabel, targetXml, yourXml, status = null, className,
}: Props) {
  return (
    <div className={`rounded-2xl border border-zinc-100 p-4 ${className ?? ""}`}>
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-400">
        Measure by Measure Practice — {measureLabel}
      </p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-zinc-100 overflow-hidden">
          <div className="px-3 pt-2 pb-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
              Target
            </p>
          </div>
          <ScoreRenderer musicXml={targetXml} className="w-full" />
        </div>

        <div className="relative rounded-xl border border-zinc-100 overflow-hidden">
          <div className="px-3 pt-2 pb-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
              Your melody
            </p>
          </div>
          {yourXml ? (
            <ScoreRenderer musicXml={yourXml} className="w-full" />
          ) : (
            <div className="flex h-28 items-center justify-center text-xs text-zinc-400">
              Sing the measure to see your melody here.
            </div>
          )}

          {status !== null && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/85 backdrop-blur-[1px]">
              {status === "recording" ? (
                <span className="flex items-center gap-3 text-2xl font-semibold text-red-500">
                  <span className="inline-block h-3 w-3 rounded-full bg-red-500 animate-pulse" />
                  Recording
                </span>
              ) : (
                <span className="flex items-center gap-3 text-xl font-medium text-indigo-600">
                  <span className="inline-block h-3 w-3 rounded-full bg-indigo-500 animate-pulse" />
                  Transcribing…
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
