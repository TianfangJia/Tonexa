"use client";
// ── Per-measure piano roll ─────────────────────────────────────────────────
// Fixed-width (no scrolling). Shows target MIDI notes as blue blocks that
// turn green / yellow / red after the student sings. Overlays a continuous
// orange pitch line drawn in real time during recording.

import React, {
  useEffect, useRef, useCallback, forwardRef, useImperativeHandle,
} from "react";
import type { NoteEvent } from "@/types/music";

export interface PitchPoint {
  timeSec: number; // aligned to measure time (0 = first target note onset)
  midi: number;    // continuous float, not snapped
}

export type MeasureGrade = "green" | "yellow" | "red";

/**
 * Imperative handle — callers push pitch points and cursor updates through
 * these methods instead of passing them as props. This bypasses React's
 * setState + reconcile cycle for the hot path (one update per audio frame,
 * ~20 ms), saving a frame of latency per point.
 */
export interface MeasurePianoRollHandle {
  /** Append a single sung pitch point; schedules a canvas redraw. */
  pushPitchPoint: (pt: PitchPoint) => void;
  /** Wipe the pitch line (use between attempts / measure advances). */
  clearPitchLine: () => void;
  /** Move the red cursor (seconds from t=0 on the roll). */
  setCurrentSec: (sec: number | undefined) => void;
}

interface Props {
  targetNotes: NoteEvent[];                // measure notes with startSec relative to measure start
  measureDuration: number;                 // seconds
  noteGrades: Map<number, MeasureGrade>;   // index into targetNotes → grade
  isRecording?: boolean;
  /** Fixed pixels-per-second. When omitted, the roll auto-fits its parent's
   *  width (original single-measure behaviour). When set, the roll renders
   *  at `KEY_WIDTH + measureDuration * pxPerSec` and is meant to be wrapped
   *  in a horizontally-scrollable parent. */
  pxPerSec?: number;
  className?: string;
}

const NOTE_HEIGHT  = 16;
const KEY_WIDTH    = 44;
const PITCH_PAD    = 8;  // semitones above/below note range
const NOTE_NAMES   = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

const COLORS = {
  blue:   { fill: "#c2d4fb", stroke: "#5c90f8" },
  green:  { fill: "#bbf7d0", stroke: "#16a34a" },
  yellow: { fill: "#fef9c3", stroke: "#ca8a04" },
  red:    { fill: "#fee2e2", stroke: "#dc2626" },
} as const;

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  if (w < 2 * r) r = w / 2;
  if (h < 2 * r) r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

const MeasurePianoRoll = forwardRef<MeasurePianoRollHandle, Props>(function MeasurePianoRoll({
  targetNotes, measureDuration, noteGrades, isRecording,
  pxPerSec, className,
}, ref) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Pitch line + cursor live in refs so pushes don't trigger React updates.
  const pitchLineRef  = useRef<PitchPoint[]>([]);
  const currentSecRef = useRef<number | undefined>(undefined);
  const drawRafRef    = useRef<number>(0);

  const getPitchRange = useCallback(() => {
    const midis = targetNotes.filter(n => !n.isRest && n.midi > 0).map(n => n.midi);
    if (midis.length === 0) return { minMidi: 60 - PITCH_PAD, maxMidi: 72 + PITCH_PAD };
    return {
      minMidi: Math.min(...midis) - PITCH_PAD,
      maxMidi: Math.max(...midis) + PITCH_PAD,
    };
  }, [targetNotes]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr  = window.devicePixelRatio || 1;
    const W    = canvas.width  / dpr;
    const H    = canvas.height / dpr;
    const { minMidi, maxMidi } = getPitchRange();
    const rollW    = W - KEY_WIDTH;
    const dur      = measureDuration > 0 ? measureDuration : 4;
    const pxPerSecEff = pxPerSec ?? (rollW / dur);
    const midiY    = (midi: number) => (maxMidi - midi) * NOTE_HEIGHT;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    // ── Row backgrounds ─────────────────────────────────────
    for (let m = minMidi; m <= maxMidi; m++) {
      const isBlack = NOTE_NAMES[m % 12].includes("#");
      ctx.fillStyle = isBlack ? "#f1f5f9" : "#ffffff";
      ctx.fillRect(KEY_WIDTH, midiY(m), rollW, NOTE_HEIGHT);
    }

    // ── Octave lines ─────────────────────────────────────────
    for (let m = minMidi; m <= maxMidi; m++) {
      if (m % 12 === 0) {
        ctx.strokeStyle = "#cbd5e1";
        ctx.lineWidth   = 1;
        ctx.beginPath();
        ctx.moveTo(KEY_WIDTH, midiY(m));
        ctx.lineTo(W, midiY(m));
        ctx.stroke();
      }
    }

    // ── Target notes ─────────────────────────────────────────
    for (let i = 0; i < targetNotes.length; i++) {
      const note = targetNotes[i];
      if (note.isRest || note.midi < minMidi || note.midi > maxMidi) continue;
      const grade  = noteGrades.get(i);
      const colors = grade ? COLORS[grade] : COLORS.blue;
      const x = KEY_WIDTH + note.startSec * pxPerSecEff;
      const w = Math.max(6, note.durationSec * pxPerSecEff - 2);
      const y = midiY(note.midi) + 1;
      ctx.fillStyle   = colors.fill;
      ctx.strokeStyle = colors.stroke;
      ctx.lineWidth   = 1.5;
      roundRect(ctx, x, y, w, NOTE_HEIGHT - 2, 3);
      ctx.fill();
      ctx.stroke();
    }

    // ── Pitch line (single octave, auto-aligned to target register) ─────
    // The student may sing an octave above or below the written range (very
    // common for voice types that don't match the score). Rather than draw
    // both the raw pitch AND an octave-up ghost — which doubles every line
    // and is confusing — pick one octave shift for the whole line, the one
    // whose median lies closest to the centre of the target pitch band, and
    // draw only that.
    const pitchLine = pitchLineRef.current;
    if (pitchLine.length >= 2) {
      const center = (minMidi + maxMidi) / 2;
      // Median sung MIDI (robust to outlier frames).
      const sorted    = pitchLine.map((p) => p.midi).slice().sort((a, b) => a - b);
      const medianMid = sorted[Math.floor(sorted.length / 2)];
      let   bestShift = 0;
      let   bestDiff  = Math.abs(medianMid - center);
      for (const shift of [-24, -12, 12, 24]) {
        const d = Math.abs(medianMid + shift - center);
        if (d < bestDiff) { bestShift = shift; bestDiff = d; }
      }

      ctx.strokeStyle = "#f97316";
      ctx.lineWidth   = 2.5;
      ctx.lineCap     = "round";
      ctx.lineJoin    = "round";
      ctx.beginPath();
      let started = false;
      for (const pt of pitchLine) {
        const midi = pt.midi + bestShift;
        if (midi < minMidi - 3 || midi > maxMidi + 3) {
          started = false;
          continue;
        }
        const x = KEY_WIDTH + pt.timeSec * pxPerSecEff;
        const y = midiY(midi) + NOTE_HEIGHT / 2;
        if (!started) { ctx.moveTo(x, y); started = true; }
        else            ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // ── Playhead cursor ──────────────────────────────────────
    const currentSec = currentSecRef.current;
    if (typeof currentSec === "number" && currentSec >= 0) {
      const x = KEY_WIDTH + currentSec * pxPerSecEff;
      if (x >= KEY_WIDTH && x <= W) {
        ctx.save();
        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth   = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
        ctx.restore();
      }
    }

    // ── Piano keys (left strip) ──────────────────────────────
    for (let m = minMidi; m <= maxMidi; m++) {
      const name    = NOTE_NAMES[m % 12];
      const isBlack = name.includes("#");
      const y       = midiY(m);
      ctx.fillStyle   = isBlack ? "#334155" : "#f8fafc";
      ctx.strokeStyle = "#cbd5e1";
      ctx.lineWidth   = 0.5;
      ctx.fillRect  (0, y, KEY_WIDTH - 1, NOTE_HEIGHT);
      ctx.strokeRect(0, y, KEY_WIDTH - 1, NOTE_HEIGHT);
      if (name === "C") {
        ctx.fillStyle  = "#64748b";
        ctx.font       = "9px Inter, sans-serif";
        ctx.textAlign  = "right";
        ctx.fillText(`C${Math.floor(m / 12) - 1}`, KEY_WIDTH - 3, y + NOTE_HEIGHT - 2);
      }
    }

    ctx.restore();
  }, [targetNotes, measureDuration, noteGrades, getPitchRange, pxPerSec]);

  // rAF-throttled redraw triggered by imperative methods. Multiple calls
  // per frame coalesce into a single redraw.
  const scheduleDraw = useCallback(() => {
    if (drawRafRef.current) return;
    drawRafRef.current = requestAnimationFrame(() => {
      drawRafRef.current = 0;
      draw();
    });
  }, [draw]);

  useImperativeHandle(ref, () => ({
    pushPitchPoint: (pt) => {
      pitchLineRef.current.push(pt);
      scheduleDraw();
    },
    clearPitchLine: () => {
      pitchLineRef.current = [];
      scheduleDraw();
    },
    setCurrentSec: (sec) => {
      currentSecRef.current = sec;
      scheduleDraw();
    },
  }), [scheduleDraw]);

  const resize = useCallback(() => {
    const canvas    = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const { minMidi, maxMidi } = getPitchRange();
    const dpr      = window.devicePixelRatio || 1;
    // When pxPerSec is fixed, the roll has an explicit content width that
    // can exceed the container — the parent is expected to handle scroll.
    const logicalW = pxPerSec !== undefined
      ? KEY_WIDTH + Math.max(0, measureDuration) * pxPerSec
      : (container.clientWidth || 300);
    const logicalH = (maxMidi - minMidi + 1) * NOTE_HEIGHT;
    canvas.width        = logicalW * dpr;
    canvas.height       = logicalH * dpr;
    canvas.style.width  = `${logicalW}px`;
    canvas.style.height = `${logicalH}px`;
    draw();
  }, [getPitchRange, draw, pxPerSec, measureDuration]);

  useEffect(() => { resize(); }, [resize]);
  useEffect(() => { draw();   }, [draw]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, [resize]);

  // When pxPerSec is fixed, give the container an explicit width equal to
  // the canvas. Without this, inside an `overflow-x-auto` scroll parent the
  // container would stretch to 100 % of the parent's clientWidth and its
  // own `overflow-hidden` would clip the canvas — so the scroll parent
  // never sees any overflow to scroll.
  const containerStyle: React.CSSProperties | undefined =
    pxPerSec !== undefined
      ? { width: KEY_WIDTH + Math.max(0, measureDuration) * pxPerSec, flexShrink: 0 }
      : undefined;

  return (
    <div
      ref={containerRef}
      style={containerStyle}
      className={`relative overflow-hidden rounded-xl border border-zinc-200 bg-white ${className ?? ""}`}
    >
      <canvas ref={canvasRef} style={{ display: "block" }} />
      {isRecording && (
        <div className="pointer-events-none absolute right-2 top-2 flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-xs font-medium text-red-500">Recording</span>
        </div>
      )}
    </div>
  );
});

export default MeasurePianoRoll;
