"use client";
// ── Mode 4: Melody Ready (full performance) ────────────────────────────────
// Student sings the entire melody. Recording is stored. Score is computed.

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ParsedMelody } from "@/types/music";
import type { ScoreRendererHandle } from "@/components/score/ScoreRenderer";
import type { SungNote } from "@/components/piano-roll/PianoRoll";
import type { DetectedNote } from "@/lib/scoring/combinedScoring";
import type { NoteGrade } from "@/types/scoring";

import { scorePerformance } from "@/lib/scoring/combinedScoring";
import { freqToMidi } from "@/lib/utils/midiUtils";
import { useMicrophone } from "@/hooks/useMicrophone";
import { usePitchDetection } from "@/hooks/usePitchDetection";
import { useOnsetDetection } from "@/hooks/useOnsetDetection";
import { usePlayback } from "@/hooks/usePlayback";
import { uploadRecording } from "@/lib/utils/audioStorage";
import { saveRecording } from "@/lib/db/results";
import type { PerformanceSummary } from "@/types/scoring";

interface Props {
  melody: ParsedMelody;
  scoreRef: React.RefObject<ScoreRendererHandle>;
  onSungNote: (note: SungNote) => void;
  onComplete: (scorePct: number, summary: PerformanceSummary) => void;
  sessionId: string;
}

type Phase = "idle" | "countdown" | "recording" | "processing" | "done";

export default function MelodyReadyMode({
  melody,
  scoreRef,
  onSungNote,
  onComplete,
  sessionId,
}: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [countdownNum, setCountdownNum] = useState<number | null>(null);
  const [summary, setSummary] = useState<PerformanceSummary | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  const detectedRef = useRef<DetectedNote[]>([]);
  const latestFreqRef = useRef<number | null>(null);
  const recordStartRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // MediaRecorder for raw audio
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const { start: startMic, stop: stopMic } = useMicrophone();
  const { start: startPitch, stop: stopPitch } = usePitchDetection();
  const { start: startOnset, stop: stopOnset } = useOnsetDetection();
  const { countdown, startClick, stopMetronome } = usePlayback();

  const totalSec = melody.notes.reduce(
    (max, n) => Math.max(max, n.startSec + n.durationSec),
    0
  );

  const startRecording = useCallback(async () => {
    scoreRef.current?.showCursor(false);
    detectedRef.current = [];
    audioChunksRef.current = [];

    // Countdown
    setPhase("countdown");
    await countdown(melody, (n) => setCountdownNum(n));
    setCountdownNum(null);

    // Open microphone
    const handle = await startMic();
    if (!handle) return;

    // Set up MediaRecorder for raw audio capture
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/ogg;codecs=opus";
    const recorder = new MediaRecorder(handle.stream, { mimeType });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };
    recorder.start(100); // collect chunks every 100ms
    mediaRecorderRef.current = recorder;

    recordStartRef.current = Date.now() / 1000;
    setPhase("recording");

    // Elapsed timer
    timerRef.current = setInterval(() => {
      setElapsedSec(Math.round(Date.now() / 1000 - recordStartRef.current));
    }, 500);

    // Metronome
    const stopClick = await startClick(melody);

    // Pitch
    startPitch(handle, (sample) => {
      if (sample) latestFreqRef.current = sample.frequencyHz;
    });

    // Onsets
    startOnset(handle, (onsetAbsSec) => {
      const relSec = onsetAbsSec - recordStartRef.current;
      const freq = latestFreqRef.current;
      detectedRef.current.push({ frequencyHz: freq, onsetSec: relSec });
      if (freq) {
        onSungNote({
          midi: Math.round(freqToMidi(freq)),
          startSec: relSec,
          endSec: relSec + 0.2,
          grade: "unmatched",
        });
      }
    });

    // Auto-stop after melody duration + 2 second buffer
    await delay((totalSec + 2) * 1000);

    // Stop everything
    if (timerRef.current) clearInterval(timerRef.current);
    stopClick();
    stopPitch();
    stopOnset();
    recorder.stop();
    stopMic();
    setPhase("processing");

    // Wait for recorder to flush
    await delay(300);

    // Score
    const perf = scorePerformance(melody, detectedRef.current);
    setSummary(perf);

    // Re-draw sung notes with grades
    perf.measureResults.forEach((mr) => {
      mr.noteResults.forEach((nr) => {
        if (nr.detectedMidi === null) return;
        onSungNote({
          midi: nr.detectedMidi,
          startSec: nr.detectedOnsetSec ?? 0,
          endSec: (nr.detectedOnsetSec ?? 0) + 0.2,
          grade: nr.combinedGrade as NoteGrade,
        });
      });
    });

    // Upload recording
    try {
      const blob = new Blob(audioChunksRef.current, { type: mimeType });
      const path = await uploadRecording(sessionId, blob);
      await saveRecording(sessionId, path, totalSec);
    } catch (e) {
      console.warn("Recording upload failed:", e);
    }

    setPhase("done");
    onComplete(perf.scorePct, perf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [melody, sessionId, totalSec]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      stopPitch();
      stopOnset();
      stopMic();
      stopMetronome();
      mediaRecorderRef.current?.stop();
    };
  }, [stopPitch, stopOnset, stopMic, stopMetronome]);

  return (
    <div className="flex flex-col gap-6">
      {/* Countdown overlay */}
      {countdownNum !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="flex h-40 w-40 items-center justify-center rounded-full bg-white shadow-2xl animate-pulse-fast">
            <span className="text-7xl font-bold text-zinc-800">{countdownNum}</span>
          </div>
        </div>
      )}

      {/* Status card */}
      <div className="rounded-2xl bg-zinc-50 px-6 py-4">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">Mode 4</p>
        <p className="text-lg font-semibold text-zinc-800">Sing the complete melody</p>
        <p className="mt-1 text-sm text-zinc-500">
          Perform from beginning to end. Recording will be saved automatically.
        </p>
      </div>

      {/* Recording indicator */}
      {phase === "recording" && (
        <div className="flex items-center justify-between rounded-xl bg-red-50 px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 rounded-full bg-red-500 animate-pulse" />
            <span className="text-sm font-medium text-red-700">Recording…</span>
          </div>
          <span className="text-sm tabular-nums text-red-500">
            {elapsedSec}s / {Math.ceil(totalSec)}s
          </span>
        </div>
      )}

      {phase === "processing" && (
        <p className="text-sm text-zinc-500">Processing your performance…</p>
      )}

      {/* Score summary */}
      {summary && phase === "done" && (
        <div className="rounded-2xl border border-zinc-200 bg-white px-6 py-5">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-400">Result</p>
          <p className="text-4xl font-bold text-zinc-900">
            {Math.round(summary.scorePct)}
            <span className="text-xl font-normal text-zinc-400">%</span>
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            {summary.passedNotes} / {summary.totalNotes} notes passed
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {summary.measureResults.map((mr) => (
              <div
                key={mr.measureNumber}
                className={`rounded-lg px-3 py-2 text-center text-xs font-medium ${
                  mr.passed ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
                }`}
              >
                M{mr.measureNumber}
                <br />
                {Math.round(mr.passPct * 100)}%
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Control */}
      {(phase === "idle" || phase === "done") && (
        <button
          onClick={startRecording}
          className="self-start rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 active:scale-95 transition-all"
        >
          {phase === "done" ? "Sing again" : "Start performance"}
        </button>
      )}
    </div>
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
