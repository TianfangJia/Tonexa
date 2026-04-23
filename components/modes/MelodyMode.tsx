"use client";
// ── Mode 3: Melody Practice (measure-by-measure) ──────────────────────────
// Phase cycle: prep → playback → prepCount → recording → evaluating
// During RECORDING the microphone runs real-time pitch detection (pitchy /
// McLeod Pitch Method). Detected pitch samples are drawn instantly as a
// continuous orange line on the per-measure piano roll. On entering the
// EVALUATING phase, samples are compared against the target MIDI notes to
// colour them green / yellow / red.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from "react";
import type { ParsedMelody, NoteEvent } from "@/types/music";
import type { ScoreRendererHandle } from "@/components/score/ScoreRenderer";

import { groupByMeasure } from "@/lib/musicxml/parser";
import { extractMeasureXml } from "@/lib/musicxml/singleMeasureXml";
import { playNote, stopPiano, preloadPiano } from "@/lib/playback/piano";
import { startMetronome } from "@/lib/playback/metronome";
import { useMicrophone } from "@/hooks/useMicrophone";
import { startPitchDetection } from "@/lib/audio/pitchDetection";
import type { PitchPoint, MeasureGrade } from "@/components/piano-roll/MeasurePianoRoll";
import MelodyMeasureCard from "@/components/ui/MelodyMeasureCard";
import type { MeasurePianoRollHandle } from "@/components/piano-roll/MeasurePianoRoll";
import Celebration from "@/components/ui/Celebration";

// ── Semitone thresholds for grading ──────────────────────────────────────
// Prior defaults (green≤2, yellow≤5, pass 60 %) were too forgiving — a
// consistent whole-step-off performance still passed. Tightened so only
// near-in-tune singing passes:
const GREEN_THRESH  = 1;    // ≤ 1 semitone   → green  (full credit)
const YELLOW_THRESH = 2;    // ≤ 2 semitones  → yellow (half credit)
//                          > 2 semitones  → red    (no credit)
const PASS_RATIO    = 0.80; // ≥ 80 % weighted → pass

type Phase =
  | "idle"
  | "prep"
  | "playback"
  | "prepCount"
  | "recording"
  | "evaluating";

interface Props {
  melody:    ParsedMelody;
  musicXml:  string;
  scoreRef:  React.RefObject<ScoreRendererHandle>;
  onComplete: (scorePct: number) => void;
  measureIdx?: number;
  onMeasureIdxChange?: (idx: number) => void;
  onNext?: () => void;
}

export default function MelodyMode({
  melody, musicXml, scoreRef, onComplete,
  measureIdx: controlledIdx, onMeasureIdxChange, onNext,
}: Props) {
  // ── Measure structure ────────────────────────────────────────────────────
  const measureMap     = useMemo(() => groupByMeasure(melody.notes), [melody.notes]);
  const measureNumbers = useMemo(
    () => Array.from(measureMap.keys()).sort((a, b) => a - b),
    [measureMap],
  );
  const totalMeasures = measureNumbers.length;

  // ── Drill state ──────────────────────────────────────────────────────────
  const [internalIdx, setInternalIdx] = useState(0);
  const measureIdx = controlledIdx ?? internalIdx;
  const updateMeasureIdx = useCallback((idx: number) => {
    if (onMeasureIdxChange) onMeasureIdxChange(idx);
    else setInternalIdx(idx);
  }, [onMeasureIdxChange]);

  const [passedMeasures, setPassedMeasures] = useState(0);
  const [phase,          setPhase]          = useState<Phase>("idle");
  const [isPaused,       setIsPaused]       = useState(false);
  const [countdownNum,   setCountdownNum]   = useState<number | null>(null);
  const [resultMsg,      setResultMsg]      = useState<string | null>(null);
  const [completed,      setCompleted]      = useState(false);

  // ── Piano-roll state ─────────────────────────────────────────────────────
  // Pitch line is pushed imperatively to the canvas via `rollRef` — no
  // React state involved for the hot path. Grades remain in state because
  // they only change once per evaluation.
  const rollRef = useRef<MeasurePianoRollHandle>(null);
  const [noteGradesForMeasure, setNoteGradesForMeasure] = useState<{
    idx:    number;
    grades: Map<number, MeasureGrade>;
  } | null>(null);

  // ── Two-track display index ──────────────────────────────────────────────
  // `measureIdx` tracks the TARGET score (top of the card). On a pass it
  // advances immediately so the student can read ahead during the 4-beat
  // intermission. `rollIdx` tracks the PIANO ROLL (bottom); it lags by the
  // intermission so the student can still see what they just sang, and
  // only flips to the new measure on the final beat of prepCount right
  // before recording starts.
  const [rollIdx, setRollIdx] = useState(0);

  const activeGrades = useMemo(
    () => noteGradesForMeasure?.idx === rollIdx
      ? noteGradesForMeasure.grades
      : new Map<number, MeasureGrade>(),
    [noteGradesForMeasure, rollIdx],
  );

  // Target score colours are keyed to `measureIdx` — the score jumps ahead
  // to the next measure on a pass while the roll stays behind, so the grades
  // should only paint noteheads when they belong to the measure currently
  // drawn on the staff.
  const scoreGrades = useMemo(
    () => noteGradesForMeasure?.idx === measureIdx
      ? noteGradesForMeasure.grades
      : new Map<number, MeasureGrade>(),
    [noteGradesForMeasure, measureIdx],
  );

  // ── Derived ──────────────────────────────────────────────────────────────
  const P               = melody.beatsPerMeasure;
  const beatDurationSec = 60 / melody.tempo;
  const measureDuration = P * beatDurationSec;

  // TARGET side (sheet music + label).
  const currentMeasureNum = measureNumbers[measureIdx];
  const targetXml = useMemo(
    () => extractMeasureXml(musicXml, currentMeasureNum),
    [musicXml, currentMeasureNum],
  );

  // ROLL side (piano roll + grades). Lags target during the intermission.
  const rollMeasureNum   = measureNumbers[rollIdx];
  const rollMeasureNotes = measureMap.get(rollMeasureNum) ?? [];
  const rollStartSec     = rollMeasureNotes[0]?.startSec ?? 0;
  const measureNotesRelative: NoteEvent[] = useMemo(
    () => rollMeasureNotes.map((n) => ({ ...n, startSec: n.startSec - rollStartSec })),
    [rollMeasureNotes, rollStartSec],
  );

  // ── Refs ─────────────────────────────────────────────────────────────────
  const phaseRef        = useRef<Phase>("idle");
  const phaseBeatRef    = useRef(0);
  const measureIdxRef   = useRef(0);
  const passedRef       = useRef(0);
  const recordingStart  = useRef(0);

  // Accumulates PitchPoints during a recording pass.
  const pitchLineRef    = useRef<PitchPoint[]>([]);
  // Alignment: offset = firstOnsetRaw - targetFirstNoteSec
  const onsetOffsetRef  = useRef<number | null>(null);
  // Cleanup handle for the running pitch detector.
  const stopPitchRef    = useRef<(() => void) | null>(null);
  // requestAnimationFrame handle for batching state updates.
  const rafRef          = useRef<number>(0);
  // Next measure index to show — set when a measure passes, applied on the
  // last beat of the following prepCount so the display advances cleanly.
  const pendingNextIdxRef = useRef<number | null>(null);

  const stopMetronomeRef = useRef<(() => void) | null>(null);
  const stopDrillRef     = useRef<() => void>(() => {});

  useEffect(() => { measureIdxRef.current = measureIdx;     }, [measureIdx]);
  useEffect(() => { passedRef.current     = passedMeasures; }, [passedMeasures]);

  const { start: startMic, stop: stopMic } = useMicrophone();
  const micHandleRef = useRef<Awaited<ReturnType<typeof startMic>> | null>(null);

  // ── Preload piano samples ─────────────────────────────────────────────────
  useEffect(() => { preloadPiano(); }, []);

  // ── Schedule target-measure playback ─────────────────────────────────────
  const schedulePlayback = useCallback((anchorAudioTime: number) => {
    const idx        = pendingNextIdxRef.current ?? measureIdxRef.current;
    const measureNum = measureNumbers[idx];
    const notes      = measureMap.get(measureNum) ?? [];
    if (notes.length === 0) return;
    const mStart = notes[0].startSec;
    for (const n of notes) {
      if (n.isRest) continue;
      void playNote(n.midi, n.durationSec, anchorAudioTime + (n.startSec - mStart));
    }
  }, [measureNumbers, measureMap]);

  // ── Recording: start real-time pitch detection ────────────────────────────
  const beginRecording = useCallback(async () => {
    // Reset pitch line and alignment for this recording pass.
    pitchLineRef.current  = [];
    onsetOffsetRef.current = null;
    rollRef.current?.clearPitchLine();
    setNoteGradesForMeasure(null);

    // Stop any leftover detector from a previous pass.
    stopPitchRef.current?.();
    stopPitchRef.current = null;

    let handle = micHandleRef.current;
    if (!handle) {
      handle = await startMic();
      if (!handle) return;
      micHandleRef.current = handle;
    }
    recordingStart.current = handle.audioContext.currentTime;

    // Compute target first-note offset once (stable for this measure pass).
    const idx        = measureIdxRef.current;
    const measureNum = measureNumbers[idx];
    const notes      = measureMap.get(measureNum) ?? [];
    const mStart     = notes[0]?.startSec ?? 0;
    const firstNote  = notes.find(n => !n.isRest);
    const targetFirst = firstNote ? firstNote.startSec - mStart : 0;

    const stop = startPitchDetection(
      handle.audioContext,
      handle.sourceNode,
      (sample) => {
        if (!sample) return;
        const rawSec = sample.timestampSec - recordingStart.current;

        // Latch onset alignment on the first valid pitch.
        if (onsetOffsetRef.current === null) {
          onsetOffsetRef.current = rawSec - targetFirst;
        }

        const timeSec = rawSec - onsetOffsetRef.current;
        const midi    = 69 + 12 * Math.log2(sample.frequencyHz / 440);

        pitchLineRef.current.push({ timeSec, midi });
        // Imperative push — the canvas redraws on its own rAF without any
        // React state update in this hot path.
        rollRef.current?.pushPitchPoint({ timeSec, midi });
      },
    );
    stopPitchRef.current = stop;
  }, [startMic, measureNumbers, measureMap]);

  // ── Evaluation: score pitch line against target notes (synchronous) ───────
  const evaluateMeasure = useCallback(() => {
    // Halt detection — no new samples after this point.
    stopPitchRef.current?.();
    stopPitchRef.current = null;
    cancelAnimationFrame(rafRef.current);

    const idx        = measureIdxRef.current;
    const measureNum = measureNumbers[idx];
    const notes      = measureMap.get(measureNum) ?? [];
    const mStart     = notes[0]?.startSec ?? 0;
    const pts        = pitchLineRef.current;

    const grades = new Map<number, MeasureGrade>();
    let score = 0;
    let total = 0;

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      if (note.isRest) continue;
      total++;

      const relStart   = note.startSec - mStart;
      const winStart   = relStart - 0.15;
      const winEnd     = relStart + note.durationSec + 0.15;
      const inWindow   = pts.filter(p => p.timeSec >= winStart && p.timeSec <= winEnd);

      if (inWindow.length === 0) {
        grades.set(i, "red");
        continue;
      }

      const sorted = inWindow.map(p => p.midi).sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      // Accept the closer of the sung pitch or its octave-up double.
      const diff   = Math.min(Math.abs(median - note.midi), Math.abs(median + 12 - note.midi));

      let grade: MeasureGrade;
      if (diff <= GREEN_THRESH)  { grade = "green";  score += 1; }
      else if (diff <= YELLOW_THRESH) { grade = "yellow"; score += 0.5; }
      else                            { grade = "red"; }
      grades.set(i, grade);
    }

    setNoteGradesForMeasure({ idx, grades });

    const passPct = total > 0 ? score / total : 1;
    const passed  = passPct >= PASS_RATIO;
    const greens  = Array.from(grades.values()).filter(g => g === "green").length;

    if (passed) {
      setResultMsg(`✓ Measure ${measureNum} passed (${Math.round(passPct * 100)}%)`);
      const newPassed = passedRef.current + 1;
      passedRef.current = newPassed;
      setPassedMeasures(newPassed);

      const nextIdx = idx + 1;
      if (nextIdx >= totalMeasures) {
        stopDrillRef.current();
        setResultMsg(null);
        setCompleted(true);
        onComplete((newPassed / totalMeasures) * 100);
      } else {
        // Hold both the target score and the piano roll on the measure the
        // student just sang while the 4-beat evaluating intermission plays
        // out — they both carry the colour grades during this window.
        // `pendingNextIdxRef` is applied to the target score on the next
        // playback beat (after the 4-beat wait) and to the piano roll one
        // phase later at prepCount beat 0.
        pendingNextIdxRef.current = nextIdx;
      }
    } else {
      setResultMsg(
        `✗ Measure ${measureNum} – try again ` +
        `(${greens}/${total} notes on pitch)`,
      );
    }
  }, [measureNumbers, measureMap, totalMeasures, onComplete]);

  // ── Stop drill ────────────────────────────────────────────────────────────
  const stopDrill = useCallback(() => {
    stopMetronomeRef.current?.();
    stopMetronomeRef.current = null;
    stopPitchRef.current?.();
    stopPitchRef.current = null;
    cancelAnimationFrame(rafRef.current);
    stopMic();
    micHandleRef.current = null;
    stopPiano();
    phaseRef.current        = "idle";
    phaseBeatRef.current    = 0;
    pendingNextIdxRef.current = null;
    setPhase("idle");
    setCountdownNum(null);
  }, [stopMic]);

  useEffect(() => { stopDrillRef.current = stopDrill; }, [stopDrill]);

  // ── Beat handler ──────────────────────────────────────────────────────────
  const handleBeat = useCallback((_beatIdx: number, audioTime: number) => {
    const curPhase = phaseRef.current;
    const beat     = phaseBeatRef.current;

    if (beat === 0) {
      switch (curPhase) {
        case "playback":
          // 4-beat evaluating intermission is over — advance the target
          // score to the next measure (if one is pending) right before we
          // play it. The piano roll continues to lag by another 4 beats
          // and flips at prepCount beat 0.
          if (pendingNextIdxRef.current !== null) {
            const nextIdx = pendingNextIdxRef.current;
            measureIdxRef.current = nextIdx;
            updateMeasureIdx(nextIdx);
          }
          schedulePlayback(audioTime);
          break;
        case "prepCount": setResultMsg(null);          break;
        case "recording": void beginRecording();       break;
      }
    }

    if (curPhase === "evaluating" && beat === 0) evaluateMeasure();

    if (curPhase === "prepCount") setCountdownNum(P - beat);
    else if (curPhase !== "idle") setCountdownNum(null);

    // On the FIRST beat of prepCount — i.e. after the 4-beat evaluating
    // intermission + 4-beat playback of the next target measure have both
    // elapsed — catch the piano roll up to the target score and wipe the
    // sung line so recording starts clean.
    if (curPhase === "prepCount" && beat === 0 && pendingNextIdxRef.current !== null) {
      const nextIdx = pendingNextIdxRef.current;
      pendingNextIdxRef.current = null;
      setRollIdx(nextIdx);
      pitchLineRef.current = [];
      rollRef.current?.clearPitchLine();
      setNoteGradesForMeasure(null);
    }

    const next = beat + 1;
    if (next >= P) {
      const TRANSITIONS: Partial<Record<Phase, Phase>> = {
        prep:       "playback",
        playback:   "prepCount",
        prepCount:  "recording",
        recording:  "evaluating",
        evaluating: "playback",
      };
      const nextPhase = TRANSITIONS[curPhase] ?? curPhase;
      phaseRef.current     = nextPhase;
      phaseBeatRef.current = 0;
      setPhase(nextPhase);
    } else {
      phaseBeatRef.current = next;
    }
  }, [P, schedulePlayback, beginRecording, evaluateMeasure, updateMeasureIdx]);

  // ── Start / pause / resume / restart ─────────────────────────────────────
  const startDrill = useCallback(async () => {
    if (phaseRef.current !== "idle") return;
    phaseRef.current     = "prep";
    phaseBeatRef.current = 0;
    setPhase("prep");
    setIsPaused(false);
    measureIdxRef.current   = 0;
    pendingNextIdxRef.current = null;
    updateMeasureIdx(0);
    setRollIdx(0);
    setPassedMeasures(0);
    passedRef.current = 0;
    setResultMsg(null);
    pitchLineRef.current = [];
    rollRef.current?.clearPitchLine();
    setNoteGradesForMeasure(null);
    setCompleted(false);

    const stop = await startMetronome({
      tempo:           melody.tempo,
      beatsPerMeasure: P,
      onBeat:          handleBeat,
    });
    stopMetronomeRef.current = stop;
  }, [melody.tempo, P, handleBeat, updateMeasureIdx]);

  const pauseDrill = useCallback(() => {
    stopMetronomeRef.current?.();
    stopMetronomeRef.current = null;
    stopPitchRef.current?.();
    stopPitchRef.current = null;
    stopPiano();
    setIsPaused(true);
    setCountdownNum(null);
  }, []);

  const resumeDrill = useCallback(async () => {
    if (!isPaused) return;
    setIsPaused(false);
    const stop = await startMetronome({
      tempo:           melody.tempo,
      beatsPerMeasure: P,
      onBeat:          handleBeat,
    });
    stopMetronomeRef.current = stop;
  }, [isPaused, melody.tempo, P, handleBeat]);

  const restartDrill = useCallback(async () => {
    stopDrill();
    await startDrill();
  }, [stopDrill, startDrill]);

  const isDrillActive = phase !== "idle";
  const toggleDrill   = useCallback(() => {
    if (!isDrillActive) void startDrill();
    else if (isPaused)  void resumeDrill();
    else                pauseDrill();
  }, [isDrillActive, isPaused, startDrill, pauseDrill, resumeDrill]);

  // ── Highlight current measure on full-piece score ─────────────────────────
  useEffect(() => {
    const handle = scoreRef.current;
    if (!handle) return;
    if (phase === "idle") handle.highlightMeasure(null);
    else                  handle.highlightMeasure(currentMeasureNum);
  }, [phase, currentMeasureNum, scoreRef]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => () => { stopDrill(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const measureLabel = `M${currentMeasureNum} (${measureIdx + 1}/${totalMeasures})`;

  return (
    <div className="flex flex-col gap-4">
      {/* Countdown overlay */}
      {countdownNum !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm pointer-events-none">
          <div className="flex h-40 w-40 items-center justify-center rounded-full bg-white shadow-2xl animate-pulse-fast">
            <span className="text-7xl font-bold text-zinc-800">{countdownNum}</span>
          </div>
        </div>
      )}

      {/* Measure card */}
      {completed ? (
        <div className="rounded-2xl border border-zinc-100 p-4">
          <Celebration
            onRestart={() => { setCompleted(false); void restartDrill(); }}
            onNext={onNext ? () => { setCompleted(false); onNext(); } : undefined}
          />
        </div>
      ) : (
        <MelodyMeasureCard
          ref={rollRef}
          measureLabel={measureLabel}
          targetXml={targetXml}
          measureNotes={measureNotesRelative}
          measureDuration={measureDuration}
          noteGrades={activeGrades}
          scoreGrades={scoreGrades}
          isRecording={phase === "recording"}
        />
      )}

      {/* Controls */}
      {!completed && (
        <div className="flex items-center gap-2">
          <button
            onClick={toggleDrill}
            className="flex h-9 items-center gap-2 rounded-full bg-indigo-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 active:scale-95 transition-all"
          >
            {isDrillActive && !isPaused ? (
              <>
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
                  <rect x="6"  y="5" width="4" height="14" rx="1" />
                  <rect x="14" y="5" width="4" height="14" rx="1" />
                </svg>
                Pause
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5 translate-x-[1px]">
                  <path d="M8 5v14l11-7z" />
                </svg>
                {isPaused ? "Resume" : "Start"}
              </>
            )}
          </button>
          <button
            onClick={() => void restartDrill()}
            disabled={!isDrillActive}
            className="flex h-9 items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-50 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <path d="M3 4v5h5" />
            </svg>
            Restart
          </button>

          <div className="ml-auto flex items-center gap-3 text-xs text-zinc-400">
            {phase === "recording" && (
              <span className="flex items-center gap-2 text-red-500">
                <span className="inline-block h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                Recording…
              </span>
            )}
            {phase === "playback" && <span className="text-indigo-600">Playing target…</span>}
            {phase === "evaluating" && <span className="text-zinc-500">Grading…</span>}
          </div>
        </div>
      )}

      {/* Progress bar */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
        <div
          className="h-full rounded-full bg-indigo-500 transition-all"
          style={{ width: `${(passedMeasures / totalMeasures) * 100}%` }}
        />
      </div>

      {resultMsg && (
        <p className={`rounded-lg px-3 py-2 text-sm font-medium ${
          resultMsg.startsWith("✓") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
        }`}>
          {resultMsg}
        </p>
      )}
    </div>
  );
}
