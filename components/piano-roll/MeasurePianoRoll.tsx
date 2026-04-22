"use client";
// ── Per-measure piano roll ─────────────────────────────────────────────────
// Fixed-width (no scrolling). Shows target MIDI notes as blue blocks that
// turn green / yellow / red after the student sings. Overlays a continuous
// orange pitch line drawn in real time during recording.

import React, { useEffect, useRef, useCallback } from "react";
import type { NoteEvent } from "@/types/music";

export interface PitchPoint {
  timeSec: number; // aligned to measure time (0 = first target note onset)
  midi: number;    // continuous float, not snapped
}

export type MeasureGrade = "green" | "yellow" | "red";

interface Props {
  targetNotes: NoteEvent[];                // measure notes with startSec relative to measure start
  measureDuration: number;                 // seconds
  pitchLine: PitchPoint[];
  noteGrades: Map<number, MeasureGrade>;   // index into targetNotes → grade
  isRecording?: boolean;
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

export default function MeasurePianoRoll({
  targetNotes, measureDuration, pitchLine, noteGrades, isRecording, className,
}: Props) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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
    const pxPerSec = rollW / dur;
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
      const x = KEY_WIDTH + note.startSec * pxPerSec;
      const w = Math.max(6, note.durationSec * pxPerSec - 2);
      const y = midiY(note.midi) + 1;
      ctx.fillStyle   = colors.fill;
      ctx.strokeStyle = colors.stroke;
      ctx.lineWidth   = 1.5;
      roundRect(ctx, x, y, w, NOTE_HEIGHT - 2, 3);
      ctx.fill();
      ctx.stroke();
    }

    // ── Pitch line (actual + octave-up double) ───────────────
    if (pitchLine.length >= 2) {
      for (const octaveShift of [0, 12]) {
        ctx.strokeStyle = octaveShift === 0 ? "#f97316" : "#fb923c";
        ctx.lineWidth   = octaveShift === 0 ? 2.5 : 1.5;
        ctx.lineCap     = "round";
        ctx.lineJoin    = "round";
        ctx.beginPath();
        let started = false;
        for (const pt of pitchLine) {
          const midi = pt.midi + octaveShift;
          if (midi < minMidi - 3 || midi > maxMidi + 3) {
            started = false;
            continue;
          }
          const x = KEY_WIDTH + pt.timeSec * pxPerSec;
          const y = midiY(midi) + NOTE_HEIGHT / 2;
          if (!started) { ctx.moveTo(x, y); started = true; }
          else            ctx.lineTo(x, y);
        }
        ctx.stroke();
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
  }, [targetNotes, measureDuration, pitchLine, noteGrades, getPitchRange]);

  const resize = useCallback(() => {
    const canvas    = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const { minMidi, maxMidi } = getPitchRange();
    const dpr      = window.devicePixelRatio || 1;
    const logicalW = container.clientWidth  || 300;
    const logicalH = (maxMidi - minMidi + 1) * NOTE_HEIGHT;
    canvas.width        = logicalW * dpr;
    canvas.height       = logicalH * dpr;
    canvas.style.width  = `${logicalW}px`;
    canvas.style.height = `${logicalH}px`;
    draw();
  }, [getPitchRange, draw]);

  useEffect(() => { resize(); }, [resize]);
  useEffect(() => { draw();   }, [draw]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, [resize]);

  return (
    <div
      ref={containerRef}
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
}
