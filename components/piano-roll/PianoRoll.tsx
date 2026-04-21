"use client";
// ── Canvas-based piano roll ────────────────────────────────────────────────
// Sticky keyboard: redrawn at scrollLeft on every frame so it never scrolls.
// Ball: fixed at 1/3 of visible roll width; appears when livePitchMidi is set.
// Scroll: driven by currentNoteIndex (smooth scroll to keep target at 1/3).
// Green notes: target notes whose index appears in a sung-note's noteIndex.

import React, { useEffect, useRef, useCallback } from "react";
import type { NoteEvent } from "@/types/music";
import type { NoteGrade } from "@/types/scoring";

export interface SungNote {
  midi: number;
  startSec: number;
  endSec: number;
  grade: NoteGrade;
  noteIndex?: number;    // index in deduplicated pitchNotes (for scroll)
  noteIndices?: number[]; // indices in melody.notes to color green (whole group)
}

interface Props {
  targetNotes: NoteEvent[];
  sungNotes: SungNote[];
  currentSec: number;
  totalSec: number;
  pxPerSec?: number;
  livePitchMidi?: number | null;
  currentNoteIndex?: number;
  scrollVersion?: number;
  className?: string;
}

const MIDI_MIN = 36; // C2 — extended for male voice range
const MIDI_MAX = 84; // C6
const MIDI_RANGE = MIDI_MAX - MIDI_MIN;
const NOTE_HEIGHT = 10;
const PIANO_KEY_WIDTH = 28;
const LABEL_NOTES = ["C", "E", "G", "B"];
// Lead-in space before note 0 so the first note can sit to the right of the cursor.
// Must be > (maxContainerWidth - PIANO_KEY_WIDTH) / 3 + CURSOR_GAP ≈ 500 covers up to ~1450px wide.
const LEAD_IN_PX = 500;
const CURSOR_GAP = 0; // px between cursor line and current note's left edge

const GRADE_COLORS: Record<NoteGrade, string> = {
  green:     "#548235",
  yellow:    "#eab308",
  red:       "#ef4444",
  darkred:   "#991b1b",
  unmatched: "#94a3b8",
};

const NOTE_NAMES_12 = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

function noteNameFromMidi(midi: number): string {
  return NOTE_NAMES_12[midi % 12];
}

function midiToY(midi: number): number {
  return (MIDI_MAX - midi) * NOTE_HEIGHT;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
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

export default function PianoRoll({
  targetNotes, sungNotes, currentSec, totalSec,
  pxPerSec = 80, livePitchMidi, currentNoteIndex, scrollVersion, className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const W = canvas.width / dpr;   // logical CSS pixels
    const H = canvas.height / dpr;
    const sl = container.scrollLeft;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    // ── Background row stripes ──────────────────────────────────
    for (let midi = MIDI_MIN; midi <= MIDI_MAX; midi++) {
      const y = midiToY(midi);
      const isBlack = noteNameFromMidi(midi).includes("#");
      ctx.fillStyle = isBlack ? "#f1f5f9" : "#ffffff";
      ctx.fillRect(PIANO_KEY_WIDTH, y, W - PIANO_KEY_WIDTH, NOTE_HEIGHT);
    }

    // ── Beat grid lines ─────────────────────────────────────────
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 0.5;
    for (let x = PIANO_KEY_WIDTH; x < W; x += pxPerSec) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let midi = MIDI_MIN; midi <= MIDI_MAX; midi += 12) {
      const y = midiToY(midi);
      ctx.strokeStyle = "#cbd5e1";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PIANO_KEY_WIDTH, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // ── Build set of passed melody.notes indices ────────────────
    const passedSet = new Set<number>();
    for (const n of sungNotes) {
      if (n.noteIndices) {
        for (const idx of n.noteIndices) passedSet.add(idx);
      } else if (n.noteIndex != null) {
        passedSet.add(n.noteIndex); // fallback for other modes
      }
    }

    // ── Target notes ────────────────────────────────────────────
    for (let i = 0; i < targetNotes.length; i++) {
      const note = targetNotes[i];
      if (note.isRest) continue;
      if (note.midi < MIDI_MIN || note.midi > MIDI_MAX) continue;
      const x = PIANO_KEY_WIDTH + LEAD_IN_PX + note.startSec * pxPerSec;
      const w = Math.max(4, note.durationSec * pxPerSec - 2);
      const y = midiToY(note.midi) + 1;
      const passed = passedSet.has(i);
      ctx.fillStyle = passed ? "#d4e9b5" : "#c2d4fb";
      ctx.strokeStyle = passed ? "#6da040" : "#5c90f8";
      ctx.lineWidth = 1;
      roundRect(ctx, x, y, w, NOTE_HEIGHT - 2, 2);
      ctx.fill(); ctx.stroke();
    }

    // ── Sung notes ──────────────────────────────────────────────
    for (const sung of sungNotes) {
      if (sung.midi < MIDI_MIN || sung.midi > MIDI_MAX) continue;
      const x = PIANO_KEY_WIDTH + LEAD_IN_PX + sung.startSec * pxPerSec;
      const w = Math.max(4, (sung.endSec - sung.startSec) * pxPerSec - 2);
      const y = midiToY(sung.midi) + 2;
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = GRADE_COLORS[sung.grade];
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 1;
      roundRect(ctx, x, y, w, NOTE_HEIGHT - 4, 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // ── Sticky piano keys — drawn at scrollLeft so they don't scroll ─
    for (let midi = MIDI_MIN; midi <= MIDI_MAX; midi++) {
      const y = midiToY(midi);
      const name = noteNameFromMidi(midi);
      const isBlack = name.includes("#");
      ctx.fillStyle = isBlack ? "#334155" : "#f8fafc";
      ctx.strokeStyle = "#cbd5e1";
      ctx.lineWidth = 0.5;
      ctx.fillRect(sl, y, PIANO_KEY_WIDTH - 1, NOTE_HEIGHT);
      ctx.strokeRect(sl, y, PIANO_KEY_WIDTH - 1, NOTE_HEIGHT);
      if (LABEL_NOTES.includes(name) && !isBlack) {
        ctx.fillStyle = "#64748b";
        ctx.font = "7px Inter, sans-serif";
        ctx.textAlign = "right";
        ctx.fillText(`${name}${Math.floor(midi / 12) - 1}`, sl + PIANO_KEY_WIDTH - 3, y + NOTE_HEIGHT - 2);
      }
    }

    // ── Cursor line — always visible at 1/3 of visible roll width ─
    const effectiveW = container.clientWidth - PIANO_KEY_WIDTH;
    const ballX = sl + PIANO_KEY_WIDTH + effectiveW / 3;
    ctx.save();
    ctx.strokeStyle = "rgba(107, 114, 128, 0.4)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(ballX, 0);
    ctx.lineTo(ballX, H);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // ── Live pitch ball — two balls: actual pitch + octave higher ─
    if (livePitchMidi != null && !isNaN(livePitchMidi)) {
      const candidates = [livePitchMidi, livePitchMidi + 12];
      for (const midi of candidates) {
        if (midi < MIDI_MIN || midi > MIDI_MAX + 1) continue;
        const ballY = midiToY(midi) + NOTE_HEIGHT / 2;
        ctx.beginPath();
        ctx.arc(ballX, ballY, 7, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(107, 114, 128, 0.85)";
        ctx.fill();
        ctx.strokeStyle = "#374151";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // ── Playhead ────────────────────────────────────────────────
    // Skip at t=0 (nothing sung yet) — otherwise a stray blue line sits in
    // the lead-in area before the first note at load time.
    if (currentSec > 0) {
      const playX = PIANO_KEY_WIDTH + LEAD_IN_PX + currentSec * pxPerSec;
      ctx.strokeStyle = "#0061f4";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playX, 0);
      ctx.lineTo(playX, H);
      ctx.stroke();
    }

    ctx.restore();
  }, [targetNotes, sungNotes, currentSec, pxPerSec, livePitchMidi]);

  // Init vertical scroll to center on the melody's pitch range
  useEffect(() => {
    const container = containerRef.current;
    if (!container || targetNotes.length === 0) return;
    const midiVals = targetNotes
      .filter((n) => !n.isRest && n.midi >= MIDI_MIN && n.midi <= MIDI_MAX)
      .map((n) => n.midi);
    if (midiVals.length === 0) return;
    const avg = midiVals.reduce((a, b) => a + b, 0) / midiVals.length;
    const centerY = midiToY(avg) + NOTE_HEIGHT / 2;
    container.scrollTop = Math.max(0, centerY - container.clientHeight / 2);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetNotes]); // intentionally run only when notes change (not on every render)

  // Auto-scroll vertically to keep the live pitch ball in view
  useEffect(() => {
    if (livePitchMidi == null || isNaN(livePitchMidi)) return;
    const container = containerRef.current;
    if (!container) return;
    const ballY = midiToY(livePitchMidi) + NOTE_HEIGHT / 2;
    const viewTop = container.scrollTop;
    const viewBottom = viewTop + container.clientHeight;
    if (ballY < viewTop + 30 || ballY > viewBottom - 30) {
      container.scrollTop = ballY - container.clientHeight / 2;
    }
  }, [livePitchMidi]);

  // Scroll so the current note sits just to the right of the cursor line.
  // Extracted as a callback so ResizeObserver can re-fire it on viewport changes.
  const scrollToCurrent = useCallback((smooth = true) => {
    if (currentNoteIndex == null) return;
    const container = containerRef.current;
    if (!container) return;
    const note = targetNotes[currentNoteIndex];
    if (!note) return;
    const noteX = PIANO_KEY_WIDTH + LEAD_IN_PX + note.startSec * pxPerSec;
    const effectiveW = container.clientWidth - PIANO_KEY_WIDTH;
    const target = Math.max(0, noteX - PIANO_KEY_WIDTH - effectiveW / 3 - CURSOR_GAP);
    container.scrollTo({ left: target, behavior: smooth ? "smooth" : "instant" });
  }, [currentNoteIndex, targetNotes, pxPerSec]);

  useEffect(() => { scrollToCurrent(); }, [scrollToCurrent, scrollVersion]);

  // Re-scroll when the container is resized (e.g. window resize, layout shift)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => scrollToCurrent(false));
    ro.observe(container);
    return () => ro.disconnect();
  }, [scrollToCurrent]);

  // Redraw on scroll so the sticky keyboard tracks new scrollLeft
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener("scroll", draw, { passive: true });
    return () => container.removeEventListener("scroll", draw);
  }, [draw]);

  // Auto-scroll for modes that don't use currentNoteIndex (follows playhead)
  useEffect(() => {
    if (currentNoteIndex != null) return;
    const container = containerRef.current;
    if (!container) return;
    const playX = PIANO_KEY_WIDTH + currentSec * pxPerSec;
    const viewLeft = container.scrollLeft;
    const viewRight = viewLeft + container.clientWidth;
    if (playX > viewRight - 60 || playX < viewLeft + PIANO_KEY_WIDTH + 20) {
      container.scrollLeft = playX - container.clientWidth / 2;
    }
  }, [currentSec, pxPerSec, currentNoteIndex]);

  // Resize canvas to fit full melody width, scaled for device pixel ratio
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const logicalH = (MIDI_RANGE + 1) * NOTE_HEIGHT;
    const logicalW = Math.max(container.clientWidth, PIANO_KEY_WIDTH + LEAD_IN_PX + totalSec * pxPerSec + 80);
    canvas.width = logicalW * dpr;
    canvas.height = logicalH * dpr;
    canvas.style.width = `${logicalW}px`;
    canvas.style.height = `${logicalH}px`;
    draw();
  }, [totalSec, pxPerSec, draw]);

  useEffect(() => { draw(); }, [draw]);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-x-auto overflow-y-auto border border-zinc-200 rounded-xl bg-white ${className ?? ""}`}
    >
      <canvas ref={canvasRef} style={{ display: "block" }} />
    </div>
  );
}
