"use client";
// ── Tonal Warmup ──────────────────────────────────────────────────────────
// Under the Overview score, this panel shows the major scale of the current
// key as a tiny reference staff and lets the student play it back. The idea
// is to warm up the ear on the tonal center before practicing — hearing
// do-re-mi-fa-sol-la-ti-do in the target key centres the listener.

import React, { useMemo, useRef, useState, useCallback } from "react";
import ScoreRenderer, { type ScoreRendererHandle } from "@/components/score/ScoreRenderer";
import { buildScaleXml, buildScaleMidis, type ScaleDirection } from "@/lib/musicxml/keyScale";
import { playNote, stopPiano } from "@/lib/playback/piano";
import type { TranspositionKey } from "@/types/music";

interface Props {
  musicKey: TranspositionKey;
  /** Seconds per scale note during playback. */
  noteSec?: number;
}

export default function TonalWarmup({ musicKey, noteSec = 0.5 }: Props) {
  const scoreRef = useRef<ScoreRendererHandle>(null);
  const [playing, setPlaying] = useState(false);
  const [direction, setDirection] = useState<ScaleDirection>("up");
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const xml = useMemo(() => buildScaleXml(musicKey, direction), [musicKey, direction]);
  const midis = useMemo(() => buildScaleMidis(musicKey, direction), [musicKey, direction]);

  const stop = useCallback(() => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
    stopPiano();
    setPlaying(false);
  }, []);

  const toggleDirection = useCallback(() => {
    stop();
    setDirection((d) => (d === "up" ? "down" : "up"));
  }, [stop]);

  const play = useCallback(() => {
    if (playing) { stop(); return; }
    setPlaying(true);
    const gap = noteSec * 1000;
    midis.forEach((midi, i) => {
      timeoutsRef.current.push(
        setTimeout(() => void playNote(midi, noteSec), i * gap),
      );
    });
    timeoutsRef.current.push(
      setTimeout(() => setPlaying(false), midis.length * gap + 200),
    );
  }, [midis, noteSec, playing, stop]);

  return (
    <div className="relative rounded-2xl border border-zinc-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <p className="text-base font-semibold uppercase tracking-wide text-zinc-500">
            Tonal Warmup
          </p>
          <p className="text-sm text-zinc-600">
            {musicKey} major — play through to settle into the key
          </p>
          {/* Mobile-only copy of the Downward switch — tucked directly
              under the helper text below sm. The sm+ copy lives next to
              Play to the right; both share the same toggleDirection handler. */}
          <button
            onClick={toggleDirection}
            aria-label={`Downward scale ${direction === "down" ? "on" : "off"}`}
            title={`Downward scale ${direction === "down" ? "on" : "off"}`}
            className="mt-2 flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 active:scale-95 transition-all sm:hidden"
          >
            <span className={`relative inline-flex h-3.5 w-6 flex-shrink-0 rounded-full transition-colors duration-200 ${direction === "down" ? "bg-indigo-500" : "bg-zinc-300"}`}>
              <span className={`inline-block h-2.5 w-2.5 translate-y-[1px] rounded-full bg-white shadow transition-transform duration-200 ${direction === "down" ? "translate-x-[13px]" : "translate-x-[1px]"}`} />
            </span>
            Downward
          </button>
        </div>
        <div className="flex items-center gap-2">
          {/* "Downward" switch — off = ascending, on = descending. Hidden
              below sm (the mobile copy above replaces it there). */}
          <button
            onClick={toggleDirection}
            aria-label={`Downward scale ${direction === "down" ? "on" : "off"}`}
            title={`Downward scale ${direction === "down" ? "on" : "off"}`}
            className="hidden items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 active:scale-95 transition-all sm:flex"
          >
            <span className={`relative inline-flex h-3.5 w-6 flex-shrink-0 rounded-full transition-colors duration-200 ${direction === "down" ? "bg-indigo-500" : "bg-zinc-300"}`}>
              <span className={`inline-block h-2.5 w-2.5 translate-y-[1px] rounded-full bg-white shadow transition-transform duration-200 ${direction === "down" ? "translate-x-[13px]" : "translate-x-[1px]"}`} />
            </span>
            Downward
          </button>
          <button
            onClick={play}
            aria-label={playing ? "Stop" : "Play scale"}
            title={playing ? "Stop" : "Play scale"}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-600 text-white shadow-sm hover:bg-indigo-500 active:scale-95 transition-all"
          >
          {playing ? (
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
              <rect x="6"  y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4 translate-x-[1px]">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
          </button>
        </div>
      </div>
      <ScoreRenderer
        ref={scoreRef}
        musicXml={xml}
        className="w-full"
        spacingSystem={2}
        justificationSystem={0}
      />
    </div>
  );
}
