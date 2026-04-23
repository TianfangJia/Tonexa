"use client";
// ── Mode 1: Pitch Practice ─────────────────────────────────────────────────
// One note at a time. Advance when detected MIDI matches target for 3 frames.
// Consecutive duplicate pitches in the melody are merged (B B A A → B A).
// Antescofo-style Gaussian/HMM scoring is commented out — using simple cents.

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import type { ParsedMelody, NoteEvent } from "@/types/music";
import type { NoteGrade } from "@/types/scoring";
import type { SungNote } from "@/components/piano-roll/PianoRoll";
import type { ScoreRendererHandle } from "@/components/score/ScoreRenderer";

import { freqToMidi, midiToNoteName } from "@/lib/utils/midiUtils";
import { playNote } from "@/lib/playback/piano";
import { useMicrophone } from "@/hooks/useMicrophone";
import { usePitchDetection } from "@/hooks/usePitchDetection";
import FeedbackBadge from "@/components/ui/FeedbackBadge";

const GRADE_NOTE_COLORS: Record<NoteGrade, string> = {
  green:     "#548235",
  yellow:    "#ca8a04",
  red:       "#dc2626",
  darkred:   "#7f1d1d",
  unmatched: "#64748b",
};

// ── Simple pitch grading ──────────────────────────────────────────────────
// Replaces the Gaussian likelihood approach.
// Returns a NoteGrade based on how many semitones off the detected pitch is.
function gradeSimple(detectedMidi: number, targetMidi: number): NoteGrade {
  // Also accept singing one octave lower (male voice range)
  const diff = Math.min(
    Math.abs(detectedMidi - targetMidi),
    Math.abs(detectedMidi + 12 - targetMidi),
  );
  if (diff <= 0.5) return "green";   // within 50 cents → pass
  if (diff <= 1.5) return "yellow";  // close
  if (diff <= 3.0) return "red";
  return "darkred";
}

// Only an exact semitone match (within 50 cents) counts as a pass.
function passesSimple(grade: NoteGrade): boolean {
  return grade === "green";
}

// ── Props ─────────────────────────────────────────────────────────────────
interface Props {
  melody: ParsedMelody;
  scoreRef: React.RefObject<ScoreRendererHandle>;
  onSungNote: (note: SungNote) => void;
  onComplete: (scorePct: number) => void;
  onLivePitch?: (midi: number | null, atSec: number) => void;
  onNoteAdvance?: (newIndex: number) => void;
  onRestart?: () => void;
  onNext?: () => void;
  sessionId: string;
}

export default function PitchMode({
  melody, scoreRef, onSungNote, onComplete, onLivePitch, onNoteAdvance, onRestart, onNext,
}: Props) {
  // Deduplicate consecutive same pitches (B B A A → B A)
  const pitchNotes = useMemo(() => {
    const raw = melody.notes.filter((n) => !n.isRest);
    return raw.filter((n, i) => i === 0 || n.midi !== raw[i - 1].midi);
  }, [melody.notes]);

  // For each pitchNotes entry, store which melody.notes indices it covers
  // e.g. [B,B,A] → group 0 covers [0,1], group 1 covers [2]
  const noteGroups = useMemo<number[][]>(() => {
    const groups: number[][] = [];
    let prev: number | null = null;
    for (let i = 0; i < melody.notes.length; i++) {
      const n = melody.notes[i];
      if (n.isRest) continue;
      if (prev === null || n.midi !== prev) {
        groups.push([i]);
      } else {
        groups[groups.length - 1].push(i);
      }
      prev = n.midi;
    }
    return groups;
  }, [melody.notes]);

  const [noteIndex, setNoteIndex] = useState(0);
  const [currentGrade, setCurrentGrade] = useState<NoteGrade | null>(null);
  const [currentFreq, setCurrentFreq] = useState<number | null>(null);
  const [passCount, setPassCount] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [done, setDone] = useState(false);
  const [autoPlay, setAutoPlay] = useState(true);
  const autoPlayRef = useRef(true);
  useEffect(() => { autoPlayRef.current = autoPlay; }, [autoPlay]);

  const completionMessage = useMemo(
    () => (done ? (Math.random() < 0.5 ? "Success!" : "Good Job!") : ""),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [done]
  );

  // Refs — keep callbacks free from stale closures
  const noteIndexRef = useRef(0);
  const passCountRef = useRef(0);
  const advancedRef = useRef(false);
  const sungStartRef = useRef<number>(Date.now() / 1000);
  const passingFramesRef = useRef(0); // consecutive frames that pass the pitch check

  useEffect(() => { noteIndexRef.current = noteIndex; }, [noteIndex]);
  useEffect(() => { passCountRef.current = passCount; }, [passCount]);

  const { start: startMic, stop: stopMic } = useMicrophone();
  const { start: startPitch, stop: stopPitch } = usePitchDetection();
  const micHandleRef = useRef<Awaited<ReturnType<typeof startMic>> | null>(null);
  const beginListeningRef = useRef<() => Promise<void>>(async () => {});

  const playTarget = useCallback(async (note: NoteEvent) => {
    await playNote(note.midi, note.durationSec);
  }, []);

  const beginListening = useCallback(async () => {
    setIsListening(true);
    advancedRef.current = false;
    passingFramesRef.current = 0;
    sungStartRef.current = Date.now() / 1000;

    // Reuse the existing mic handle — only open once per session
    let handle = micHandleRef.current;
    if (!handle) {
      handle = await startMic();
      if (!handle) return;
      micHandleRef.current = handle;
    }

    startPitch(handle, (sample) => {
      if (advancedRef.current) return;

      const note = pitchNotes[noteIndexRef.current];
      if (!note) return;

      // No signal → reset frame counter and clear ball
      if (!sample) {
        passingFramesRef.current = 0;
        onLivePitch?.(null, note.startSec);
        return;
      }

      const floatMidi = freqToMidi(sample.frequencyHz);
      setCurrentFreq(sample.frequencyHz);
      onLivePitch?.(floatMidi, note.startSec);

      const grade = gradeSimple(floatMidi, note.midi);
      setCurrentGrade(grade);

      if (passesSimple(grade)) {
        passingFramesRef.current += 1;
        // Require 3 consecutive passing frames (~140 ms) before advancing
        if (passingFramesRef.current < 3) return;
      } else {
        passingFramesRef.current = 0;
        return;
      }

      // ── Note passed ──────────────────────────────────────────
      advancedRef.current = true;
      passingFramesRef.current = 0;

      // Color noteheads in the score for this group
      const gradeColor = GRADE_NOTE_COLORS[grade];
      for (const idx of noteGroups[noteIndexRef.current] ?? []) {
        scoreRef.current?.colorNote(idx, gradeColor);
      }

      const sungMidi = Math.round(floatMidi);
      const endSec = Date.now() / 1000;
      onSungNote({
        midi: sungMidi,
        startSec: sungStartRef.current,
        endSec,
        grade,
        noteIndex: noteIndexRef.current,
        noteIndices: noteGroups[noteIndexRef.current] ?? [],
      });

      stopPitch();
      setIsListening(false);
      setCurrentFreq(null);
      onLivePitch?.(null, 0);

      setTimeout(async () => {
        const nextIndex = noteIndexRef.current + 1;
        const currentPass = passCountRef.current + 1;

        setPassCount(currentPass);
        passCountRef.current = currentPass;

        if (nextIndex >= pitchNotes.length) {
          setDone(true);
          onComplete((currentPass / pitchNotes.length) * 100);
          return;
        }

        noteIndexRef.current = nextIndex;
        setNoteIndex(nextIndex);
        const nextMelodyIdx = noteGroups[nextIndex]?.[0] ?? nextIndex;
        onNoteAdvance?.(nextMelodyIdx);
        setCurrentGrade(null);
        scoreRef.current?.setCursorIndex(nextMelodyIdx);

        if (autoPlayRef.current) {
          await playTarget(pitchNotes[nextIndex]);
          setTimeout(() => beginListeningRef.current(), 400);
        } else {
          setTimeout(() => beginListeningRef.current(), 100);
        }
      }, 600);
    });
  }, [pitchNotes, noteGroups, startMic, startPitch, stopPitch, onSungNote, onComplete, playTarget, scoreRef, onLivePitch, onNoteAdvance]);

  useEffect(() => { beginListeningRef.current = beginListening; }, [beginListening]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPitch();
      stopMic();
      onLivePitch?.(null, 0);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopPitch, stopMic]);

  const currentNote: NoteEvent | undefined = pitchNotes[noteIndex];

  const handleStart = useCallback(async () => {
    if (!currentNote) return;
    setStarted(true);
    setPaused(false);
    scoreRef.current?.showCursor(true);
    scoreRef.current?.setCursorIndex(noteGroups[0]?.[0] ?? 0);
    onNoteAdvance?.(noteGroups[0]?.[0] ?? 0);
    await playTarget(currentNote);
    setTimeout(() => beginListeningRef.current(), 500);
  }, [currentNote, playTarget, scoreRef, onNoteAdvance, noteGroups]);

  const handlePause = useCallback(() => {
    stopPitch();
    stopMic();
    micHandleRef.current = null;
    setIsListening(false);
    setPaused(true);
    setCurrentFreq(null);
    onLivePitch?.(null, 0);
  }, [stopPitch, stopMic, onLivePitch]);

  const handleResume = useCallback(async () => {
    if (!currentNote) return;
    setPaused(false);
    await playTarget(currentNote);
    setTimeout(() => beginListeningRef.current(), 400);
  }, [currentNote, playTarget]);

  const handleReplayTarget = useCallback(async () => {
    if (!currentNote) return;
    await playTarget(currentNote);
  }, [currentNote, playTarget]);

  const handleRestart = useCallback(async () => {
    stopPitch();
    passingFramesRef.current = 0;
    advancedRef.current = false;
    noteIndexRef.current = 0;
    passCountRef.current = 0;
    setNoteIndex(0);
    setPassCount(0);
    setCurrentGrade(null);
    setCurrentFreq(null);
    setIsListening(false);
    setStarted(true);
    setPaused(false);
    setDone(false);
    scoreRef.current?.clearNoteColors();
    onNoteAdvance?.(noteGroups[0]?.[0] ?? 0);
    onRestart?.();
    onLivePitch?.(null, 0);
    scoreRef.current?.showCursor(true);
    scoreRef.current?.setCursorIndex(noteGroups[0]?.[0] ?? 0);
    await playTarget(pitchNotes[0]);
    setTimeout(() => beginListeningRef.current(), 500);
  }, [pitchNotes, stopPitch, playTarget, scoreRef, onNoteAdvance, onRestart, onLivePitch]);

  if (done) {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <p className="text-2xl font-bold text-zinc-800">{completionMessage}</p>
        <p className="text-zinc-500">
          {passCount} / {pitchNotes.length} notes passed
        </p>
        <div className="flex gap-3">
          <button onClick={handleRestart}
            className="rounded-xl bg-zinc-200 px-6 py-3 text-sm font-semibold text-zinc-700 hover:bg-zinc-300 active:scale-95 transition-all">
            Restart
          </button>
          {onNext && (
            <button onClick={onNext}
              className="rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 active:scale-95 transition-all">
              Next
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-6 py-4 min-h-[88px]">
        <div className="flex items-center gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">Target note</p>
            <p className="text-3xl font-bold text-zinc-900">
              {currentNote ? midiToNoteName(currentNote.midi) : "—"}
            </p>
          </div>
          <button onClick={handleReplayTarget}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 active:scale-95 transition-all">
            ▶ Play
          </button>
          {/* Auto-play toggle switch */}
          <button
            onClick={() => setAutoPlay((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 active:scale-95 transition-all"
          >
            <span className={`relative inline-flex h-3.5 w-6 flex-shrink-0 rounded-full transition-colors duration-200 ${autoPlay ? "bg-indigo-500" : "bg-zinc-300"}`}>
              <span className={`inline-block h-2.5 w-2.5 translate-y-[1px] rounded-full bg-white shadow transition-transform duration-200 ${autoPlay ? "translate-x-[13px]" : "translate-x-[1px]"}`} />
            </span>
            Auto-play
          </button>
        </div>
        <div className="flex flex-col items-end gap-1">
          <p className="text-xs text-zinc-400">{noteIndex + 1} / {pitchNotes.length}</p>
          {currentGrade && <FeedbackBadge grade={currentGrade} size="lg" />}
        </div>
      </div>

      {started && !paused && (
        <div className="flex items-center gap-2 text-sm text-indigo-600">
          <span className="inline-block h-2 w-2 rounded-full bg-indigo-500" />
          Listening… sing the note above
          {currentFreq && (
            <span className="ml-2 text-zinc-400">
              ({midiToNoteName(Math.round(freqToMidi(currentFreq)))})
            </span>
          )}
        </div>
      )}

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
        <div
          className="h-full rounded-full bg-indigo-500 transition-all"
          style={{ width: `${(noteIndex / pitchNotes.length) * 100}%` }}
        />
      </div>

      <div className="flex flex-wrap gap-3">
        {!started && (
          <button onClick={handleStart}
            className="rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 active:scale-95 transition-all">
            Start
          </button>
        )}
        {started && !paused && !done && (
          <button onClick={handlePause}
            className="rounded-xl bg-zinc-200 px-6 py-3 text-sm font-semibold text-zinc-700 hover:bg-zinc-300 active:scale-95 transition-all">
            Pause
          </button>
        )}
        {started && paused && !done && (
          <button onClick={handleResume}
            className="rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 active:scale-95 transition-all">
            Resume
          </button>
        )}
        {started && (
          <button onClick={handleRestart}
            className="rounded-xl bg-zinc-200 px-6 py-3 text-sm font-semibold text-zinc-700 hover:bg-zinc-300 active:scale-95 transition-all">
            Restart
          </button>
        )}
      </div>
    </div>
  );
}
