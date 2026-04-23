"use client";
// ── Mode 2: Rhythm Practice ───────────────────────────────────────────────
// Two coexisting interactions:
//   1) FULL-PIECE listening: whole-melody rhythm score with play/pause button
//      on top-right, drag-to-seek cursor, Space toggles play/pause. Piano at B4.
//   2) MEASURE DRILL: two-column card (target ↔ live transcription). A
//      continuous metronome drives the cycle P beats at a time
//      (P = melody.beatsPerMeasure):
//         prep → playback → prepCount → recording → evaluating → playback …
//      Start button on the drill card begins it; starting stops the listening
//      play-all if active.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from "react";
import type { ParsedMelody } from "@/types/music";
import type { ScoreRendererHandle } from "@/components/score/ScoreRenderer";
import type { SungNote } from "@/components/piano-roll/PianoRoll";
import ScoreRenderer from "@/components/score/ScoreRenderer";

import { alignOnsets, rhythmPasses } from "@/lib/scoring/rhythmScoring";
import { groupByMeasure } from "@/lib/musicxml/parser";
import { extractRhythmXML } from "@/lib/musicxml/rhythmXml";
import {
  extractMeasureXml,
  onsetsToMeasureXml,
} from "@/lib/musicxml/singleMeasureXml";
import { playNote, stopPiano, preloadPiano } from "@/lib/playback/piano";
import { startMetronome } from "@/lib/playback/metronome";
import Celebration from "@/components/ui/Celebration";

const RHYTHM_PITCH_MIDI = 71; // B4

type Phase =
  | "idle"
  | "prep"
  | "playback"
  | "prepCount"
  | "recording"
  | "evaluating";

interface Props {
  melody:       ParsedMelody;
  musicXml:     string;
  onSungNote:   (note: SungNote) => void;
  onComplete:   (scorePct: number) => void;
  /** Optional — fired from the celebration's "Next" button. */
  onNext?:      () => void;
}

export default function RhythmMode({
  melody, musicXml, onSungNote, onComplete, onNext,
}: Props) {
  // ── Measure structure ───────────────────────────────────────────────────
  const measureMap     = useMemo(() => groupByMeasure(melody.notes), [melody.notes]);
  const measureNumbers = useMemo(
    () => Array.from(measureMap.keys()).sort((a, b) => a - b),
    [measureMap],
  );
  const totalMeasures = measureNumbers.length;

  // ── Drill state ─────────────────────────────────────────────────────────
  const [measureIdx,         setMeasureIdx]        = useState(0);
  const [passedMeasures,     setPassedMeasures]    = useState(0);
  const [phase,              setPhase]             = useState<Phase>("idle");
  const [isPaused,           setIsPaused]          = useState(false);
  const [countdownNum,       setCountdownNum]      = useState<number | null>(null);
  const [transcriptionSlots, setTranscriptionSlots] = useState<number[]>([]);
  const [transcriptionCompact, setTranscriptionCompact] = useState(false);
  const [resultMsg,          setResultMsg]         = useState<string | null>(null);
  // True once the student has cleared all measures in this drill; swaps the
  // drill card's contents for the inline celebration panel.
  const [completed,          setCompleted]         = useState(false);

  // ── Full-piece "play-all" state ─────────────────────────────────────────
  const [isPlayingAll, setIsPlayingAll] = useState(false);
  const [seekIdx,      setSeekIdx]      = useState(0);
  const seekIdxRef                      = useRef(0);
  useEffect(() => { seekIdxRef.current = seekIdx; }, [seekIdx]);

  // ── Derived MusicXML ────────────────────────────────────────────────────
  const P                    = melody.beatsPerMeasure;
  const beatDurationSec      = 60 / melody.tempo;
  const sixteenthDurationSec = beatDurationSec / 4;
  const currentMeasureNum    = measureNumbers[measureIdx];
  const currentMeasureNotes  = measureMap.get(currentMeasureNum) ?? [];
  const measureStartSec      = currentMeasureNotes[0]?.startSec ?? 0;
  const expectedRelativeOnsets = useMemo(
    () => currentMeasureNotes
      .filter((n) => !n.isRest)
      .map((n) => n.startSec - measureStartSec),
    [currentMeasureNotes, measureStartSec],
  );

  const rhythmXml = useMemo(() => extractRhythmXML(musicXml), [musicXml]);
  const targetXml = useMemo(
    () => extractMeasureXml(rhythmXml, currentMeasureNum),
    [rhythmXml, currentMeasureNum],
  );
  const transcriptionXml = useMemo(
    () => onsetsToMeasureXml(
      transcriptionSlots, P, melody.beatUnit, melody.tempo, transcriptionCompact,
    ),
    [transcriptionSlots, P, melody.beatUnit, melody.tempo, transcriptionCompact],
  );

  // ── Refs (stable inside metronome callback / timeouts) ──────────────────
  const phaseRef          = useRef<Phase>("idle");
  const phaseBeatRef      = useRef(0);
  const measureIdxRef     = useRef(0);
  const passedRef         = useRef(0);
  const detectedOnsetsRef = useRef<number[]>([]);
  // Canonical slot set drawn in "Your rhythm". The ref is the source of
  // truth — each tap mutates it synchronously, then mirrors to state so the
  // score renderer updates. Scoring reads the ref, so it can never disagree
  // with what was on screen (no state-batch timing windows).
  const transcriptionSlotsRef = useRef<number[]>([]);
  const recordingStartRef = useRef(0);
  // True from beginRecording until evaluateOnsets fires — widens the tap
  // window past the phase-transition moment so the last tap (often arriving
  // slightly late) still lands in the detection list instead of being
  // rejected because phase just flipped to "evaluating".
  const recordingOpenRef  = useRef(false);
  // Constant offset subtracted from every onset so the student's first tap
  // aligns to the first expected note. Absorbs system latency / reaction time.
  const onsetShiftRef     = useRef(0);
  const stopMetronomeRef  = useRef<(() => void) | null>(null);
  const drillTimeoutsRef  = useRef<ReturnType<typeof setTimeout>[]>([]);

  const playAllActiveRef   = useRef(false);
  const playAllTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => { measureIdxRef.current = measureIdx;     }, [measureIdx]);
  useEffect(() => { passedRef.current     = passedMeasures; }, [passedMeasures]);

  const fullScoreRef          = useRef<ScoreRendererHandle>(null);
  const targetScoreRef        = useRef<ScoreRendererHandle>(null);
  const transcriptionScoreRef = useRef<ScoreRendererHandle>(null);

  // ── Full-piece listening ────────────────────────────────────────────────
  const stopPlayAll = useCallback(() => {
    playAllActiveRef.current = false;
    playAllTimeoutsRef.current.forEach(clearTimeout);
    playAllTimeoutsRef.current = [];
    stopPiano();
    setIsPlayingAll(false);
  }, []);

  const startPlayAll = useCallback(() => {
    playAllActiveRef.current = true;
    setIsPlayingAll(true);

    fullScoreRef.current?.showCursor(true);

    const notes    = melody.notes;
    const startIdx = Math.min(seekIdxRef.current, Math.max(0, notes.length - 1));
    const startSec = notes[startIdx]?.startSec ?? 0;

    fullScoreRef.current?.setCursorIndex(startIdx);

    const timeouts: ReturnType<typeof setTimeout>[] = [];
    notes.forEach((note, i) => {
      if (i < startIdx) return;
      const whenMs = (note.startSec - startSec) * 1000;
      timeouts.push(setTimeout(() => {
        if (!playAllActiveRef.current) return;
        fullScoreRef.current?.setCursorIndex(i);
        if (!note.isRest) void playNote(RHYTHM_PITCH_MIDI, note.durationSec);
      }, whenMs));
    });

    const last = notes[notes.length - 1];
    if (last) {
      timeouts.push(setTimeout(() => {
        if (playAllActiveRef.current) stopPlayAll();
      }, (last.startSec - startSec + last.durationSec) * 1000 + 400));
    }

    playAllTimeoutsRef.current = timeouts;
  }, [melody.notes, stopPlayAll]);

  const handleSeek = useCallback((idx: number) => {
    setSeekIdx(idx);
    seekIdxRef.current = idx;
    fullScoreRef.current?.showCursor(true);
    fullScoreRef.current?.setCursorIndex(idx);
    if (playAllActiveRef.current) stopPlayAll();
  }, [stopPlayAll]);

  // Kick off piano sample loading as soon as RhythmMode mounts so the first
  // play-all / drill target doesn't hit the "buffer not loaded" error.
  useEffect(() => { preloadPiano(); }, []);

  // Highlight the current target measure in the full-piece rhythm score
  // while the drill is active; clear when idle.
  useEffect(() => {
    const handle = fullScoreRef.current;
    if (!handle) return;
    if (phase === "idle") handle.highlightMeasure(null);
    else                  handle.highlightMeasure(currentMeasureNum);
  }, [phase, currentMeasureNum]);

  // Show the playbar on the full score as soon as it's rendered.
  useEffect(() => {
    let tries = 0;
    const id = setInterval(() => {
      fullScoreRef.current?.showCursor(true);
      fullScoreRef.current?.setCursorIndex(seekIdxRef.current);
      if (++tries > 10) clearInterval(id);
    }, 150);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Drill phase actions ─────────────────────────────────────────────────
  // Schedule all notes for the target measure at Tone audio-clock times anchored
  // to the metronome beat's exact `audioTime`. This keeps piano in tight sync
  // with the metronome (setTimeout adds 5-15ms of drift + JS-timer jitter).
  const schedulePlayback = useCallback((anchorAudioTime: number) => {
    const idx        = measureIdxRef.current;
    const measureNum = measureNumbers[idx];
    const notes      = measureMap.get(measureNum) ?? [];
    if (notes.length === 0) return;
    const mStart = notes[0].startSec;

    for (const n of notes) {
      if (n.isRest) continue;
      const whenAudio = anchorAudioTime + (n.startSec - mStart);
      void playNote(RHYTHM_PITCH_MIDI, n.durationSec, whenAudio);
    }
  }, [measureNumbers, measureMap]);

  // Begin the recording window. Resets detection state and anchors
  // `recordingStartRef` to a wall-clock time — every subsequent tap computes
  // its relative time against this anchor. No mic, no onset detector.
  const beginRecording = useCallback(() => {
    detectedOnsetsRef.current = [];
    transcriptionSlotsRef.current = [];
    setTranscriptionSlots([]);
    setTranscriptionCompact(false); // live-raw mode during recording
    onsetShiftRef.current = 0;
    recordingStartRef.current = performance.now() / 1000;
    recordingOpenRef.current  = true;
  }, []);

  // Tap input: called on Space keydown or tap-pad press/click/touch. Only
  // registers onsets during the "recording" phase; outside of it, no-op.
  const handleTap = useCallback(() => {
    if (!recordingOpenRef.current) return;

    const rawRel = performance.now() / 1000 - recordingStartRef.current;

    // On the first tap, compute a constant shift so raw first → expectedFirst
    // (absorbs reaction-time offset on beat 1 so later taps aren't dragged).
    const expectedFirst = expectedRelativeOnsets[0] ?? 0;
    if (detectedOnsetsRef.current.length === 0 && expectedRelativeOnsets.length > 0) {
      onsetShiftRef.current = rawRel - expectedFirst;
    }
    const relSec = rawRel - onsetShiftRef.current;

    if (relSec < -0.15) return;
    // Accept taps up to one full beat past the measure end. Paired with the
    // evaluating-phase grace beat, a student who lags the final target note
    // has nearly a beat of slack before the measure is graded.
    if (relSec >  P * beatDurationSec + beatDurationSec) return;

    detectedOnsetsRef.current.push(relSec);

    const slot = Math.max(
      0,
      Math.min(P * 4 - 1, Math.round(relSec / sixteenthDurationSec)),
    );
    if (!transcriptionSlotsRef.current.includes(slot)) {
      transcriptionSlotsRef.current = [...transcriptionSlotsRef.current, slot]
        .sort((a, b) => a - b);
      setTranscriptionSlots(transcriptionSlotsRef.current);
    }

    onSungNote({
      midi:     RHYTHM_PITCH_MIDI,
      startSec: relSec,
      endSec:   relSec + 0.1,
      grade:    "unmatched",
    });
  }, [P, beatDurationSec, sixteenthDurationSec, onSungNote, expectedRelativeOnsets]);

  // Forward-declare for use inside evaluateOnsets before stopDrill.
  const stopDrillRef = useRef<() => void>(() => {});

  const evaluateOnsets = useCallback(() => {
    // Close the tap window exactly when we read the detected list, so any
    // trailing tap that landed during the grace beat is still counted.
    recordingOpenRef.current = false;

    // Re-derive the target onsets from the CURRENT measure index each time
    // this runs. The metronome keeps a stable reference to handleBeat from
    // drill start, so any closure-captured data (including the outer
    // `expectedRelativeOnsets`) would still point at measure 1's notes.
    const curIdx      = measureIdxRef.current;
    const curMeasure  = measureNumbers[curIdx];
    const curNotes    = measureMap.get(curMeasure) ?? [];
    const mStart      = curNotes[0]?.startSec ?? 0;
    const curExpected = curNotes
      .filter((n) => !n.isRest)
      .map((n) => n.startSec - mStart);

    // Pass iff the drawn "Your rhythm" notation matches the target — i.e.
    // the set of 16th-note onset slots is identical. `detectedSlots` reads
    // the ref that mirrors the visible transcription, so the grade can
    // never disagree with what's on screen.
    const toSlot = (s: number) =>
      Math.max(0, Math.min(P * 4 - 1, Math.round(s / sixteenthDurationSec)));
    const expectedSlots = new Set(curExpected.map(toSlot));
    const detectedSlots = new Set(transcriptionSlotsRef.current);

    // Similarity shown in the "try again" message only.
    let hits = 0;
    expectedSlots.forEach((slot) => { if (detectedSlots.has(slot)) hits++; });
    const matches =
      expectedSlots.size === detectedSlots.size &&
      hits === expectedSlots.size;
    const expectedCount = expectedSlots.size;
    const passPct = matches
      ? 1
      : (expectedCount === 0 ? 0 : hits / expectedCount);

    // Keep the continuous-time alignment for side-effects (e.g. future UI
    // feedback showing per-note offset colours).
    void alignOnsets; void rhythmPasses;

    const idx        = curIdx;
    const measureNum = curMeasure;

    if (matches) {
      setResultMsg(`✓ Measure ${measureNum} passed (${Math.round(passPct * 100)}%)`);
      const newPassed = passedRef.current + 1;
      passedRef.current = newPassed;
      setPassedMeasures(newPassed);

      const nextIdx = idx + 1;
      if (nextIdx >= totalMeasures) {
        // Last measure — halt the cycle immediately so the drill doesn't
        // replay the target a second time while we wait for the user to
        // dismiss the celebration.
        stopDrillRef.current();
        setResultMsg(null);
        setCompleted(true);
        onComplete((newPassed / totalMeasures) * 100);
      } else {
        measureIdxRef.current = nextIdx;
        setMeasureIdx(nextIdx);
      }
    } else {
      const exp = Array.from(expectedSlots).sort((a, b) => a - b).join(",");
      const got = Array.from(detectedSlots).sort((a, b) => a - b).join(",");
      setResultMsg(
        `✗ Measure ${measureNum} – try again (${Math.round(passPct * 100)}%). ` +
        `target=[${exp}] yours=[${got}]`,
      );
      // eslint-disable-next-line no-console
      console.log("[RhythmMode] evaluate", {
        measureNum,
        expectedSlots: exp,
        detectedSlots: got,
        curExpected,
        rawDetected: detectedOnsetsRef.current.slice(),
      });
    }
  }, [measureNumbers, measureMap, totalMeasures, P, sixteenthDurationSec, beatDurationSec, onComplete]);

  const stopDrill = useCallback(() => {
    stopMetronomeRef.current?.();
    stopMetronomeRef.current = null;
    stopPiano();
    drillTimeoutsRef.current.forEach(clearTimeout);
    drillTimeoutsRef.current = [];
    phaseRef.current = "idle";
    phaseBeatRef.current = 0;
    recordingOpenRef.current = false;
    setPhase("idle");
    setCountdownNum(null);
  }, []);

  useEffect(() => { stopDrillRef.current = stopDrill; }, [stopDrill]);

  const handleBeat = useCallback((_beatIdx: number, audioTime: number) => {
    const curPhase = phaseRef.current;
    const beat     = phaseBeatRef.current;

    if (beat === 0) {
      switch (curPhase) {
        case "playback":   schedulePlayback(audioTime);     break;
        case "prepCount":  setResultMsg(null);               break;
        case "recording":  beginRecording();                 break;
        // evaluating beat 0 is a grace beat — recordingOpenRef stays true
        // so a tap that trails the final target note by up to one beat
        // still makes it into the detection list.
      }
    }

    // Evaluate on beat 1 of "evaluating" (one full beat after the tapped
    // measure ends) so the student's last tap isn't clipped.
    if (curPhase === "evaluating" && beat === 1) {
      setTranscriptionCompact(true);
      evaluateOnsets();
    }

    if (curPhase === "prepCount") setCountdownNum(P - beat);
    else if (curPhase !== "idle") setCountdownNum(null);

    const next = beat + 1;
    if (next >= P) {
      let nextPhase: Phase = curPhase;
      switch (curPhase) {
        case "prep":       nextPhase = "playback";   break;
        case "playback":   nextPhase = "prepCount";  break;
        case "prepCount":  nextPhase = "recording";  break;
        case "recording":  nextPhase = "evaluating"; break;
        case "evaluating": nextPhase = "playback";   break;
      }
      phaseRef.current     = nextPhase;
      phaseBeatRef.current = 0;
      setPhase(nextPhase);
    } else {
      phaseBeatRef.current = next;
    }
  }, [P, schedulePlayback, beginRecording, evaluateOnsets]);

  const startDrill = useCallback(async () => {
    if (phaseRef.current !== "idle") return;
    if (playAllActiveRef.current) stopPlayAll();

    phaseRef.current     = "prep";
    phaseBeatRef.current = 0;
    setPhase("prep");
    setIsPaused(false);
    setMeasureIdx(0);
    measureIdxRef.current = 0;
    setPassedMeasures(0);
    passedRef.current = 0;
    setResultMsg(null);
    setTranscriptionSlots([]);
    setTranscriptionCompact(false);

    const stop = await startMetronome({
      tempo:           melody.tempo,
      beatsPerMeasure: P,
      onBeat:          handleBeat,
    });
    stopMetronomeRef.current = stop;
  }, [melody.tempo, P, handleBeat, stopPlayAll]);

  // Pause: halt metronome + audio but preserve phase/beat/measure state so
  // Resume can continue the cycle.
  const pauseDrill = useCallback(() => {
    stopMetronomeRef.current?.();
    stopMetronomeRef.current = null;
    stopPiano();
    drillTimeoutsRef.current.forEach(clearTimeout);
    drillTimeoutsRef.current = [];
    recordingOpenRef.current = false;
    setIsPaused(true);
    setCountdownNum(null);
  }, []);

  // Resume: restart the metronome. handleBeat picks up from preserved
  // phase/beat state and continues the cycle from there.
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

  // Restart: full reset to measure 1, fresh cycle. Works whether currently
  // idle, active, or paused.
  const restartDrill = useCallback(async () => {
    stopDrill();
    // stopDrill flips phaseRef to idle; startDrill will re-init from 0.
    await startDrill();
  }, [stopDrill, startDrill]);

  const isDrillActive = phase !== "idle";

  const togglePlayAll = useCallback(() => {
    if (isPlayingAll) stopPlayAll();
    else {
      if (isDrillActive) stopDrill();
      startPlayAll();
    }
  }, [isPlayingAll, isDrillActive, stopPlayAll, stopDrill, startPlayAll]);

  // Unified drill button: Start (idle) → Pause (active) → Resume (paused).
  const toggleDrill = useCallback(() => {
    if (!isDrillActive)   void startDrill();
    else if (isPaused)    void resumeDrill();
    else                  pauseDrill();
  }, [isDrillActive, isPaused, startDrill, pauseDrill, resumeDrill]);

  // Space = tap. Ignored inside inputs. Key repeat is suppressed so holding
  // Space doesn't flood the onset list.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && t.matches("input, textarea, select, [contenteditable='true']")) return;
      e.preventDefault();
      handleTap();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleTap]);

  // Cleanup
  useEffect(() => {
    return () => {
      stopDrill();
      stopPlayAll();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── UI ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6">
      {/* Countdown overlay */}
      {countdownNum !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm pointer-events-none">
          <div className="flex h-40 w-40 items-center justify-center rounded-full bg-white shadow-2xl animate-pulse-fast">
            <span className="text-7xl font-bold text-zinc-800">{countdownNum}</span>
          </div>
        </div>
      )}

      {/* Full-piece rhythm score with play/pause + drag-to-seek */}
      <div className="rounded-2xl border border-zinc-100 overflow-hidden">
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">Rhythm</p>
          <button
            onClick={togglePlayAll}
            aria-label={isPlayingAll ? "Pause" : "Play"}
            title={isPlayingAll ? "Pause (Space)" : "Play (Space)"}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-600 text-white shadow-sm hover:bg-indigo-500 active:scale-95 transition-all"
          >
            {isPlayingAll ? (
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
        <ScoreRenderer
          ref={fullScoreRef}
          musicXml={rhythmXml}
          className="w-full"
          onSeek={handleSeek}
        />
      </div>

      {/* Drill: two-column target vs live transcription */}
      <div className="rounded-2xl border border-zinc-100 p-4">
        {completed ? (
          <Celebration
            onRestart={() => {
              setCompleted(false);
              setResultMsg(null);
              void restartDrill();
            }}
            onNext={onNext ? () => {
              setCompleted(false);
              onNext();
            } : undefined}
          />
        ) : (
        <>
        <div className="mb-3 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-semibold uppercase tracking-wide text-zinc-500 sm:text-base">
            Measure by Measure Practice — M{currentMeasureNum} ({measureIdx + 1}/{totalMeasures})
          </p>
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
              title="Restart from measure 1"
              className="flex h-9 items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-50 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                <path d="M3 12a9 9 0 1 0 3-6.7" />
                <path d="M3 4v5h5" />
              </svg>
              Restart
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-zinc-100 overflow-hidden">
            <div className="px-3 pt-2 pb-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">Target</p>
            </div>
            <ScoreRenderer
              ref={targetScoreRef}
              musicXml={targetXml}
              className="w-full"
            />
          </div>

          <div className="rounded-xl border border-zinc-100 overflow-hidden">
            <div className="px-3 pt-2 pb-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
                Your rhythm
              </p>
            </div>
            <ScoreRenderer
              ref={transcriptionScoreRef}
              musicXml={transcriptionXml}
              className="w-full"
            />
          </div>
        </div>

        <div className="mt-3 flex items-center justify-end text-xs text-zinc-400">
          {phase === "recording" && (
            <span className="flex items-center gap-2 text-red-500">
              <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
              Recording…
            </span>
          )}
          {phase === "playback" && <span className="text-indigo-600">Playing target…</span>}
        </div>

        {/* Tap pad — click/tap on touch devices, Space on desktop. Only
            records onsets while phase === "recording"; pressable always so
            students can test timing, but visually dim outside the window. */}
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onPointerDown={(e) => { e.preventDefault(); handleTap(); }}
            aria-label="Tap"
            className={`h-40 w-full max-w-md select-none rounded-2xl text-xl font-semibold shadow-md transition-all active:scale-[0.98] touch-manipulation ${
              phase === "recording"
                ? "bg-red-500 text-white hover:bg-red-400 active:bg-red-600"
                : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
            }`}
          >
            {phase === "recording" ? "TAP" : "Tap here (or press Space)"}
          </button>
        </div>

        {resultMsg && (
          <p
            className={`mt-3 rounded-lg px-3 py-2 text-sm font-medium ${
              resultMsg.startsWith("✓")
                ? "bg-green-50 text-green-700"
                : "bg-red-50 text-red-600"
            }`}
          >
            {resultMsg}
          </p>
        )}
        </>
        )}
      </div>

      {/* Progress bar */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
        <div
          className="h-full rounded-full bg-indigo-500 transition-all"
          style={{ width: `${(passedMeasures / totalMeasures) * 100}%` }}
        />
      </div>

      <p className="text-xs text-zinc-400">
        Click “Start” to train measure by measure: {P} beats prep → {P} beats
        target → {P} beats countdown → {P} beats you tap → {P} beats evaluation.
      </p>
    </div>
  );
}
