"use client";
// ── Mode 3: Melody Practice (measure-by-measure) ──────────────────────────
// Phase cycle mirrors RhythmMode: prep → playback → prepCount → recording
// → evaluating (4 beats each). During the RECORDING phase we just buffer
// raw mic audio; during EVALUATING we hand that buffer to Spotify's Basic
// Pitch in one shot, which returns `{midi, startSec, durationSec}` note
// events. Those are quantised onto the 16th-note grid and rendered into
// the "Your melody" panel before scoring.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from "react";
import type { ParsedMelody } from "@/types/music";
import type { ScoreRendererHandle } from "@/components/score/ScoreRenderer";
import type { SungNote } from "@/components/piano-roll/PianoRoll";

import { groupByMeasure } from "@/lib/musicxml/parser";
import {
  extractMeasureXml,
  onsetsToMeasureXml,
} from "@/lib/musicxml/singleMeasureXml";
import { playNote, stopPiano, preloadPiano } from "@/lib/playback/piano";
import { startMetronome } from "@/lib/playback/metronome";
import { useMicrophone } from "@/hooks/useMicrophone";
import {
  startAudioRecorder, transcribeAudio, preloadBasicPitch,
  type AudioRecorder, type TranscribedNote,
} from "@/lib/audio/basicPitchTranscribe";
import MelodyMeasureCard from "@/components/ui/MelodyMeasureCard";
import Celebration from "@/components/ui/Celebration";

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
  onSungNote: (note: SungNote) => void;
  onComplete: (scorePct: number) => void;
  /** Optional controlled measure index — keeps the card in the parent
   *  layout in sync with internal progression. */
  measureIdx?: number;
  onMeasureIdxChange?: (idx: number) => void;
  /** Called when the celebration's "Next" button is pressed. */
  onNext?: () => void;
}

export default function MelodyMode({
  melody, musicXml, scoreRef, onSungNote, onComplete,
  measureIdx: controlledIdx, onMeasureIdxChange, onNext,
}: Props) {
  // ── Measure structure ───────────────────────────────────────────────────
  const measureMap     = useMemo(() => groupByMeasure(melody.notes), [melody.notes]);
  const measureNumbers = useMemo(
    () => Array.from(measureMap.keys()).sort((a, b) => a - b),
    [measureMap],
  );
  const totalMeasures = measureNumbers.length;

  // ── Drill state ─────────────────────────────────────────────────────────
  const [internalIdx, setInternalIdx] = useState(0);
  const measureIdx = controlledIdx ?? internalIdx;
  const updateMeasureIdx = useCallback((idx: number) => {
    if (onMeasureIdxChange) onMeasureIdxChange(idx);
    else setInternalIdx(idx);
  }, [onMeasureIdxChange]);

  const [passedMeasures,       setPassedMeasures]       = useState(0);
  const [phase,                setPhase]                = useState<Phase>("idle");
  const [isPaused,             setIsPaused]             = useState(false);
  const [countdownNum,         setCountdownNum]         = useState<number | null>(null);
  const [transcriptionSlots,   setTranscriptionSlots]   = useState<number[]>([]);
  const [transcriptionVersion, setTranscriptionVersion] = useState(0); // forces XML rebuild on pitch update
  const [transcriptionCompact, setTranscriptionCompact] = useState(false);
  const [resultMsg,            setResultMsg]            = useState<string | null>(null);
  const [completed,            setCompleted]            = useState(false);

  // ── Derived ─────────────────────────────────────────────────────────────
  const P                    = melody.beatsPerMeasure;
  const beatDurationSec      = 60 / melody.tempo;
  const sixteenthDurationSec = beatDurationSec / 4;
  const currentMeasureNum    = measureNumbers[measureIdx];
  const currentMeasureNotes  = measureMap.get(currentMeasureNum) ?? [];
  const measureStartSec      = currentMeasureNotes[0]?.startSec ?? 0;
  const expectedNotes        = useMemo(
    () => currentMeasureNotes
      .filter((n) => !n.isRest)
      .map((n) => ({ relSec: n.startSec - measureStartSec, midi: n.midi })),
    [currentMeasureNotes, measureStartSec],
  );

  // Key signature (fifths) parsed once from the loaded XML — used to make
  // the "Your melody" staff match the target's accidentals.
  const fifths = useMemo(() => {
    const m = musicXml.match(/<fifths>(-?\d+)<\/fifths>/);
    return m ? parseInt(m[1], 10) : 0;
  }, [musicXml]);

  const targetXml = useMemo(
    () => extractMeasureXml(musicXml, currentMeasureNum),
    [musicXml, currentMeasureNum],
  );

  // ── Refs (stable across metronome callbacks / timeouts) ─────────────────
  const phaseRef                  = useRef<Phase>("idle");
  const phaseBeatRef              = useRef(0);
  const measureIdxRef             = useRef(0);
  const passedRef                 = useRef(0);
  const transcriptionSlotsRef     = useRef<number[]>([]);
  const transcriptionPitchesRef   = useRef<Map<number, number>>(new Map());
  const recordingStartRef         = useRef(0);
  const audioRecorderRef          = useRef<AudioRecorder | null>(null);
  const stopMetronomeRef          = useRef<(() => void) | null>(null);
  const [isTranscribing,  setIsTranscribing ]  = useState(false);

  useEffect(() => { measureIdxRef.current = measureIdx;     }, [measureIdx]);
  useEffect(() => { passedRef.current     = passedMeasures; }, [passedMeasures]);

  const { start: startMic, stop: stopMic } = useMicrophone();
  const micHandleRef = useRef<Awaited<ReturnType<typeof startMic>> | null>(null);

  // ── Live transcription XML ──────────────────────────────────────────────
  const transcriptionXml = useMemo(
    () => onsetsToMeasureXml(
      transcriptionSlots,
      P,
      melody.beatUnit,
      melody.tempo,
      transcriptionCompact,
      transcriptionPitchesRef.current,
      fifths,
    ),
    // transcriptionVersion is a deliberate dep so pitch-only updates (no
    // new slots) still rebuild the XML.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transcriptionSlots, transcriptionVersion, transcriptionCompact, P, melody.beatUnit, melody.tempo, fifths],
  );

  // ── Piano sample + Basic Pitch model warmup ─────────────────────────────
  useEffect(() => { preloadPiano(); preloadBasicPitch(); }, []);

  // ── Schedule target-measure playback at exact metronome beat time ───────
  const schedulePlayback = useCallback((anchorAudioTime: number) => {
    const idx        = measureIdxRef.current;
    const measureNum = measureNumbers[idx];
    const notes      = measureMap.get(measureNum) ?? [];
    if (notes.length === 0) return;
    const mStart = notes[0].startSec;
    for (const n of notes) {
      if (n.isRest) continue;
      const whenAudio = anchorAudioTime + (n.startSec - mStart);
      void playNote(n.midi, n.durationSec, whenAudio);
    }
  }, [measureNumbers, measureMap]);

  // ── Recording lifecycle ─────────────────────────────────────────────────
  // The RECORDING phase just captures a raw audio buffer — no live
  // detection at all. The heavy lifting happens in the EVALUATING phase
  // when Basic Pitch transcribes the whole measure in one shot.
  const beginRecording = useCallback(async () => {
    transcriptionSlotsRef.current = [];
    transcriptionPitchesRef.current = new Map();
    setTranscriptionSlots([]);
    setTranscriptionVersion((v) => v + 1);
    setTranscriptionCompact(false);

    let handle = micHandleRef.current;
    if (!handle) {
      handle = await startMic();
      if (!handle) return;
      micHandleRef.current = handle;
    }

    recordingStartRef.current = handle.audioContext.currentTime;
    audioRecorderRef.current = startAudioRecorder(
      handle.audioContext, handle.sourceNode,
    );
  }, [startMic]);

  // Quantise transcribed Basic Pitch notes onto the 16th grid and push
  // them into the transcription state the XML renderer consumes.
  const applyTranscription = useCallback((notes: TranscribedNote[]) => {
    const slots: number[] = [];
    const pitches = new Map<number, number>();
    for (const n of notes) {
      if (n.startSec < -0.15) continue;
      if (n.startSec > P * beatDurationSec + beatDurationSec) continue;
      const slot = Math.max(
        0,
        Math.min(P * 4 - 1, Math.round(n.startSec / sixteenthDurationSec)),
      );
      if (!pitches.has(slot)) {
        pitches.set(slot, Math.round(n.midi));
        slots.push(slot);
      }
      onSungNote({
        midi:     Math.round(n.midi),
        startSec: n.startSec,
        endSec:   n.startSec + Math.max(0.1, n.durationSec),
        grade:    "unmatched",
      });
    }
    slots.sort((a, b) => a - b);
    transcriptionSlotsRef.current = slots;
    transcriptionPitchesRef.current = pitches;
    setTranscriptionSlots(slots);
    setTranscriptionVersion((v) => v + 1);
  }, [P, beatDurationSec, sixteenthDurationSec, onSungNote]);

  const stopDrillRef = useRef<() => void>(() => {});

  // Score detected vs target slots (onset presence) + pitches (±1 semitone).
  const scoreMeasure = useCallback(() => {
    const idx         = measureIdxRef.current;
    const measureNum  = measureNumbers[idx];
    const notes       = measureMap.get(measureNum) ?? [];
    const mStart      = notes[0]?.startSec ?? 0;
    const targets     = notes
      .filter((n) => !n.isRest)
      .map((n) => ({ relSec: n.startSec - mStart, midi: n.midi }));

    const toSlot = (s: number) =>
      Math.max(0, Math.min(P * 4 - 1, Math.round(s / sixteenthDurationSec)));

    const expectedSlotSet = new Set(targets.map((t) => toSlot(t.relSec)));
    const expectedPitchBySlot = new Map<number, number>();
    targets.forEach((t) => {
      const s = toSlot(t.relSec);
      if (!expectedPitchBySlot.has(s)) expectedPitchBySlot.set(s, t.midi);
    });

    const detectedSlotSet = new Set(transcriptionSlotsRef.current);

    let onsetHits = 0;
    expectedSlotSet.forEach((slot) => {
      if (detectedSlotSet.has(slot)) onsetHits++;
    });
    let pitchHits = 0;
    expectedSlotSet.forEach((slot) => {
      const got  = transcriptionPitchesRef.current.get(slot);
      const want = expectedPitchBySlot.get(slot);
      if (got !== undefined && want !== undefined && Math.abs(got - want) <= 1) {
        pitchHits++;
      }
    });

    const sizesEqual    = expectedSlotSet.size === detectedSlotSet.size;
    const rhythmMatches = sizesEqual && onsetHits === expectedSlotSet.size;
    const pitchMatches  = pitchHits === expectedSlotSet.size;
    const matches       = rhythmMatches && pitchMatches;

    const expectedCount = expectedSlotSet.size;
    const passPct = matches
      ? 1
      : (expectedCount === 0 ? 0 : (onsetHits + pitchHits) / (2 * expectedCount));

    if (matches) {
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
        measureIdxRef.current = nextIdx;
        updateMeasureIdx(nextIdx);
      }
    } else {
      setResultMsg(
        `✗ Measure ${measureNum} – try again ` +
        `(rhythm ${onsetHits}/${expectedCount}, pitch ${pitchHits}/${expectedCount})`,
      );
    }
  }, [measureNumbers, measureMap, P, sixteenthDurationSec,
      totalMeasures, onComplete, updateMeasureIdx]);

  // Kicks off the transcription pipeline: stop the recorder, hand the
  // buffer to Basic Pitch, update the visible transcription, then score.
  // Fires on the first beat of the EVALUATING phase.
  const beginEvaluation = useCallback(async () => {
    const rec = audioRecorderRef.current;
    audioRecorderRef.current = null;
    if (!rec) { scoreMeasure(); return; }
    const buf = rec.stop();
    setIsTranscribing(true);
    setTranscriptionCompact(true);
    try {
      const notes = await transcribeAudio(buf, rec.sampleRate);
      applyTranscription(notes);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[MelodyMode] Basic Pitch transcription failed:", err);
    } finally {
      setIsTranscribing(false);
      scoreMeasure();
    }
  }, [applyTranscription, scoreMeasure]);

  const stopDrill = useCallback(() => {
    stopMetronomeRef.current?.();
    stopMetronomeRef.current = null;
    audioRecorderRef.current?.stop();
    audioRecorderRef.current = null;
    stopMic();
    micHandleRef.current = null;
    stopPiano();
    phaseRef.current = "idle";
    phaseBeatRef.current = 0;
    setPhase("idle");
    setCountdownNum(null);
    setIsTranscribing(false);
  }, [stopMic]);

  useEffect(() => { stopDrillRef.current = stopDrill; }, [stopDrill]);

  const handleBeat = useCallback((_beatIdx: number, audioTime: number) => {
    const curPhase = phaseRef.current;
    const beat     = phaseBeatRef.current;

    if (beat === 0) {
      switch (curPhase) {
        case "playback":   schedulePlayback(audioTime);    break;
        case "prepCount":  setResultMsg(null);              break;
        case "recording":  void beginRecording();           break;
        // evaluating beat 0 = grace beat for trailing onsets
      }
    }

    // On the first beat of EVALUATING, stop recording → run Basic Pitch →
    // score. The transcription runs async but the metronome keeps ticking
    // through the 4-beat evaluating phase to mask its latency.
    if (curPhase === "evaluating" && beat === 0) {
      void beginEvaluation();
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
  }, [P, schedulePlayback, beginRecording, beginEvaluation]);

  const startDrill = useCallback(async () => {
    if (phaseRef.current !== "idle") return;
    phaseRef.current     = "prep";
    phaseBeatRef.current = 0;
    setPhase("prep");
    setIsPaused(false);
    measureIdxRef.current = 0;
    updateMeasureIdx(0);
    setPassedMeasures(0);
    passedRef.current = 0;
    setResultMsg(null);
    setTranscriptionSlots([]);
    transcriptionSlotsRef.current = [];
    transcriptionPitchesRef.current = new Map();
    setTranscriptionVersion((v) => v + 1);
    setTranscriptionCompact(false);
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
    audioRecorderRef.current?.stop();
    audioRecorderRef.current = null;
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

  const toggleDrill = useCallback(() => {
    if (!isDrillActive)   void startDrill();
    else if (isPaused)    void resumeDrill();
    else                  pauseDrill();
  }, [isDrillActive, isPaused, startDrill, pauseDrill, resumeDrill]);

  // Highlight the current measure on the full-piece score.
  useEffect(() => {
    const handle = scoreRef.current;
    if (!handle) return;
    if (phase === "idle") handle.highlightMeasure(null);
    else                  handle.highlightMeasure(currentMeasureNum);
  }, [phase, currentMeasureNum, scoreRef]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      stopDrill();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      {/* Drill card — target ↔ your melody */}
      {completed ? (
        <div className="rounded-2xl border border-zinc-100 p-4">
          <Celebration
            onRestart={() => { setCompleted(false); void restartDrill(); }}
            onNext={onNext ? () => { setCompleted(false); onNext(); } : undefined}
          />
        </div>
      ) : (
        <MelodyMeasureCard
          measureLabel={measureLabel}
          targetXml={targetXml}
          yourXml={transcriptionXml}
          status={
            phase === "recording"
              ? "recording"
              : (phase === "evaluating" && isTranscribing)
                ? "transcribing"
                : null
          }
        />
      )}

      {/* Control strip — Start/Pause + Restart, placed directly below the
          measure-by-measure card (per spec). */}
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
            title="Restart from measure 1"
            className="flex h-9 items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-50 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <path d="M3 4v5h5" />
            </svg>
            Restart
          </button>

          {/* Phase indicator */}
          <div className="ml-auto flex items-center gap-3 text-xs text-zinc-400">
            {phase === "recording" && (
              <span className="flex items-center gap-2 text-red-500">
                <span className="inline-block h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                Recording…
              </span>
            )}
            {phase === "playback" && <span className="text-indigo-600">Playing target…</span>}
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
        <p
          className={`rounded-lg px-3 py-2 text-sm font-medium ${
            resultMsg.startsWith("✓")
              ? "bg-green-50 text-green-700"
              : "bg-red-50 text-red-600"
          }`}
        >
          {resultMsg}
        </p>
      )}
    </div>
  );
}
