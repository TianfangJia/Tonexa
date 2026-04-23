"use client";
// ── Mode 4: Melody Ready (full performance) ────────────────────────────────
// Same pitch-line / piano-roll / grading logic as MelodyMode — but applied
// to the ENTIRE melody rather than a single measure. Phase cycle is flat:
//   idle → countdown → recording → done.
// During recording the student sees a full-melody piano roll with a live
// orange pitch line; on Stop (or auto-stop at melody end) the target notes
// colour green / yellow / red and a pass percentage appears. A Celebration
// panel replaces the roll when the performance clears the pass threshold.
//
// Controls during recording:
//   • Restart (same button slot as Start) — abort and immediately start a
//     fresh attempt from the countdown.
//   • Stop — halt recording and run evaluation on what was captured. The
//     button then reverts to Start; no resuming a stopped attempt.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ParsedMelody, NoteEvent } from "@/types/music";
import type { ScoreRendererHandle } from "@/components/score/ScoreRenderer";
import type { PerformanceSummary } from "@/types/scoring";
import type {
  PitchPoint, MeasureGrade, MeasurePianoRollHandle,
} from "@/components/piano-roll/MeasurePianoRoll";

import MeasurePianoRoll from "@/components/piano-roll/MeasurePianoRoll";
import Celebration from "@/components/ui/Celebration";
import { useMicrophone } from "@/hooks/useMicrophone";
import { startPitchDetection } from "@/lib/audio/pitchDetection";
import { usePlayback } from "@/hooks/usePlayback";
import { playNote, preloadPiano } from "@/lib/playback/piano";
import { uploadRecording } from "@/lib/utils/audioStorage";
import { saveRecording } from "@/lib/db/results";

// Mirrors MelodyMode — keep in sync if you change either.
const GREEN_THRESH  = 1;
const YELLOW_THRESH = 2;
const PASS_RATIO    = 0.70;

// Fixed pixels-per-second for the full-melody roll. Wider than auto-fit
// so individual notes are readable; the parent wraps in overflow-x-auto
// and auto-scrolls during recording.
const PX_PER_SEC    = 120;
const ROLL_KEY_W    = 44;  // must match MeasurePianoRoll's KEY_WIDTH

type Phase = "idle" | "countdown" | "recording" | "done";

interface Props {
  melody:    ParsedMelody;
  scoreRef:  React.RefObject<ScoreRendererHandle>;
  onComplete: (scorePct: number, summary?: PerformanceSummary) => void;
  sessionId: string;
}

export default function MelodyReadyMode({
  melody, scoreRef, onComplete, sessionId,
}: Props) {
  const [phase,         setPhase]         = useState<Phase>("idle");
  const [countdownNum,  setCountdownNum]  = useState<number | null>(null);
  // Pitch line + cursor are driven imperatively via `rollRef` (no React
  // state in the hot path). Only the grades/summary still use state.
  const rollRef = useRef<MeasurePianoRollHandle>(null);
  const [noteGrades,    setNoteGrades]    = useState<Map<number, MeasureGrade>>(new Map());
  const [passPct,       setPassPct]       = useState<number | null>(null);
  const [completed,     setCompleted]     = useState(false);

  // ── Refs (survive re-renders, drive the recording pipeline) ──────────────
  const pitchLineRef      = useRef<PitchPoint[]>([]);
  const recordingStartRef = useRef(0);
  // Shift applied so the student's first sung sample lines up with the
  // first non-rest target note. Same shift is applied to the playhead so
  // cursor and line never drift apart. `null` until the first sample.
  const onsetOffsetRef    = useRef<number | null>(null);
  const firstNoteSecRef   = useRef(0);
  // Live-grade bookkeeping: updated on each pitch sample, snapshotted into
  // state on the animation frame so the target blocks re-colour as the
  // student sings through them.
  const liveGradesRef     = useRef<Map<number, MeasureGrade>>(new Map());
  const stopPitchRef      = useRef<(() => void) | null>(null);
  const stopClickRef      = useRef<(() => void) | null>(null);
  const autoStopRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef            = useRef<number>(0);
  const mediaRecorderRef  = useRef<MediaRecorder | null>(null);
  const audioChunksRef    = useRef<Blob[]>([]);
  const elapsedLoopRef    = useRef<number>(0);
  const scrollRef         = useRef<HTMLDivElement>(null);

  const { start: startMic, stop: stopMic } = useMicrophone();
  const { countdown, startClick, stopMetronome } = usePlayback();
  const micHandleRef = useRef<Awaited<ReturnType<typeof startMic>> | null>(null);

  // ── Derived: full-melody duration, first-note offset for alignment ───────
  const totalSec = useMemo(
    () => melody.notes.reduce((max, n) => Math.max(max, n.startSec + n.durationSec), 0),
    [melody.notes],
  );
  const firstNoteMidi = useMemo(
    () => melody.notes.find((n) => !n.isRest)?.midi ?? 60,
    [melody.notes],
  );
  const firstNoteSec = useMemo(
    () => melody.notes.find((n) => !n.isRest)?.startSec ?? 0,
    [melody.notes],
  );
  useEffect(() => { firstNoteSecRef.current = firstNoteSec; }, [firstNoteSec]);
  const melodyNotes: NoteEvent[] = melody.notes;

  // Warm up the piano sampler so the first countdown note doesn't lag.
  useEffect(() => { preloadPiano(); }, []);

  // ── Playhead + auto-scroll loop (active during recording only) ───────────
  // Uses the mic's AudioContext clock (the same clock the pitch samples'
  // timestamps use), so cursor and pitch line can never drift against each
  // other due to different time references. The onset offset captured on
  // the first sung sample is applied equally to both.
  useEffect(() => {
    if (phase !== "recording") {
      cancelAnimationFrame(elapsedLoopRef.current);
      return;
    }
    const loop = () => {
      const audioCtx = micHandleRef.current?.audioContext;
      if (audioCtx) {
        const rawSec = audioCtx.currentTime - recordingStartRef.current;
        // Before first sung sample the offset is null → cursor walks the
        // raw audio clock. Once the first sample lands, offset is set so
        // cursor instantly aligns with the pitch line (both use the same
        // `rawSec - offset` formula).
        const offset = onsetOffsetRef.current ?? 0;
        const secs   = rawSec - offset;
        rollRef.current?.setCurrentSec(secs);
        const el = scrollRef.current;
        if (el) {
          const cursorX  = ROLL_KEY_W + secs * PX_PER_SEC;
          const viewport = el.clientWidth;
          const target   = cursorX - viewport * 0.3;
          el.scrollLeft  = Math.max(0, target);
        }
      }
      elapsedLoopRef.current = requestAnimationFrame(loop);
    };
    elapsedLoopRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(elapsedLoopRef.current);
  }, [phase]);

  // ── Shared teardown: called by Stop, Restart, unmount, etc. ──────────────
  const tearDownCapture = useCallback(() => {
    stopPitchRef.current?.();
    stopPitchRef.current = null;
    stopClickRef.current?.();
    stopClickRef.current = null;
    cancelAnimationFrame(rafRef.current);
    if (autoStopRef.current) { clearTimeout(autoStopRef.current); autoStopRef.current = null; }
    try { mediaRecorderRef.current?.state !== "inactive" && mediaRecorderRef.current?.stop(); } catch {}
    stopMic();
    micHandleRef.current = null;
  }, [stopMic]);

  // ── Evaluation: same median-per-note logic as MelodyMode, whole melody ───
  const evaluate = useCallback(() => {
    tearDownCapture();

    const pts    = pitchLineRef.current;
    const grades = new Map<number, MeasureGrade>();
    let score = 0;
    let total = 0;

    for (let i = 0; i < melodyNotes.length; i++) {
      const note = melodyNotes[i];
      if (note.isRest) continue;
      total++;

      const winStart = note.startSec - 0.15;
      const winEnd   = note.startSec + note.durationSec + 0.15;
      const inWindow = pts.filter((p) => p.timeSec >= winStart && p.timeSec <= winEnd);

      if (inWindow.length === 0) {
        grades.set(i, "red");
        continue;
      }

      const sorted = inWindow.map((p) => p.midi).sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const diff   = Math.min(
        Math.abs(median - note.midi),
        Math.abs(median + 12 - note.midi),
      );

      let grade: MeasureGrade;
      if      (diff <= GREEN_THRESH)  { grade = "green";  score += 1; }
      else if (diff <= YELLOW_THRESH) { grade = "yellow"; score += 0.75; }
      else                             { grade = "red"; }
      grades.set(i, grade);
    }

    setNoteGrades(grades);
    const pct = total > 0 ? score / total : 0;
    setPassPct(pct);
    setPhase("done");
    if (pct >= PASS_RATIO) setCompleted(true);

    onComplete(pct * 100);

    // Upload the captured audio best-effort — don't block the UI on it.
    void (async () => {
      try {
        const recorder = mediaRecorderRef.current;
        if (!recorder) return;
        // Wait a moment for any pending dataavailable events to flush.
        await new Promise((r) => setTimeout(r, 300));
        const mimeType = recorder.mimeType || "audio/webm;codecs=opus";
        const blob     = new Blob(audioChunksRef.current, { type: mimeType });
        if (blob.size === 0) return;
        const path = await uploadRecording(sessionId, blob);
        await saveRecording(sessionId, path, totalSec);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[MelodyReadyMode] recording upload failed:", err);
      }
    })();
  }, [melodyNotes, totalSec, sessionId, onComplete, tearDownCapture]);

  // ── Start (or restart) the capture flow from the countdown onward ────────
  const startCapture = useCallback(async () => {
    // Kill anything still running from a prior attempt.
    tearDownCapture();

    pitchLineRef.current   = [];
    audioChunksRef.current  = [];
    liveGradesRef.current   = new Map();
    onsetOffsetRef.current  = null;
    rollRef.current?.clearPitchLine();
    rollRef.current?.setCurrentSec(undefined);
    setNoteGrades(new Map());
    setPassPct(null);
    setCompleted(false);
    if (scrollRef.current) scrollRef.current.scrollLeft = 0;

    // Pre-open the microphone BEFORE the countdown so the audio graph is
    // warm when beat 1 fires. Without this the async startMic() delay
    // (50–300 ms on first run) falls between the last countdown tick and
    // the student's first sung note, and the first note gets dropped.
    const handle = await startMic();
    if (!handle) { setPhase("idle"); return; }
    micHandleRef.current = handle;

    // MediaRecorder for the raw-audio upload at the end. Chrome/Firefox prefer
    // webm/ogg Opus; Safari only supports mp4/mpeg — pick the first candidate
    // the browser actually supports. If none match (very old browsers or no
    // MediaRecorder at all), skip the recorder entirely so the student can
    // still practice even without an upload.
    try {
      if (typeof MediaRecorder !== "undefined") {
        const candidates = [
          "audio/webm;codecs=opus",
          "audio/webm",
          "audio/ogg;codecs=opus",
          "audio/mp4;codecs=mp4a.40.2",
          "audio/mp4",
          "audio/mpeg",
        ];
        const mimeType = candidates.find((t) => MediaRecorder.isTypeSupported(t));
        if (mimeType) {
          const recorder = new MediaRecorder(handle.stream, { mimeType });
          recorder.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunksRef.current.push(e.data);
          };
          recorder.start(200);
          mediaRecorderRef.current = recorder;
        } else {
          // eslint-disable-next-line no-console
          console.warn("[MelodyReadyMode] no supported MediaRecorder mimeType; recording disabled.");
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[MelodyReadyMode] MediaRecorder init failed:", err);
    }

    setPhase("countdown");
    // On every countdown beat: play the first-note pitch alongside the
    // click so the student locks on to the starting pitch before singing.
    await countdown(melody, (n) => {
      setCountdownNum(n);
      void playNote(firstNoteMidi, Math.max(0.2, melody.beatDurationSec * 0.6));
    });
    setCountdownNum(null);

    // Click track for timing reference.
    stopClickRef.current = await startClick(melody);

    recordingStartRef.current = handle.audioContext.currentTime;
    setPhase("recording");
    scoreRef.current?.showCursor(false);

    stopPitchRef.current = startPitchDetection(
      handle.audioContext,
      handle.sourceNode,
      (sample) => {
        if (!sample) return;
        const rawSec = sample.timestampSec - recordingStartRef.current;
        // Latch the alignment offset on the first valid sung sample. This
        // absorbs the student's reaction delay plus any residual latency
        // between `recordingStartRef` and when the click track's beat 1
        // actually reached the speakers — so "first note" always lands on
        // top of the first target block on the roll.
        if (onsetOffsetRef.current === null) {
          onsetOffsetRef.current = rawSec - firstNoteSecRef.current;
        }
        const timeSec = rawSec - onsetOffsetRef.current;
        const midi    = 69 + 12 * Math.log2(sample.frequencyHz / 440);
        pitchLineRef.current.push({ timeSec, midi });
        // Imperative canvas push — no React state in the hot path.
        rollRef.current?.pushPitchPoint({ timeSec, midi });

        // Live grading — re-grade whichever target notes' windows currently
        // contain this sample. Only one note is "current" at any instant
        // (melodies are monophonic), so this is cheap.
        for (let i = 0; i < melodyNotes.length; i++) {
          const note = melodyNotes[i];
          if (note.isRest) continue;
          const winStart = note.startSec - 0.15;
          const winEnd   = note.startSec + note.durationSec + 0.15;
          if (timeSec < winStart) break;   // future notes: samples haven't arrived yet
          if (timeSec > winEnd)   continue; // past notes: already graded
          const win = pitchLineRef.current.filter(
            (p) => p.timeSec >= winStart && p.timeSec <= winEnd,
          );
          if (win.length === 0) continue;
          const sorted = win.map((p) => p.midi).sort((a, b) => a - b);
          const median = sorted[Math.floor(sorted.length / 2)];
          const diff   = Math.min(
            Math.abs(median - note.midi),
            Math.abs(median + 12 - note.midi),
          );
          const grade: MeasureGrade =
            diff <= GREEN_THRESH  ? "green" :
            diff <= YELLOW_THRESH ? "yellow" : "red";
          liveGradesRef.current.set(i, grade);
        }

        // Grades still go through React state, but throttled to rAF so
        // only one re-render per frame.
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          setNoteGrades(new Map(liveGradesRef.current));
        });
      },
    );

    // Auto-stop at the end of the melody (+ 1 s tail) — user can stop early
    // with the Stop button. Either path funnels into evaluate().
    autoStopRef.current = setTimeout(evaluate, (totalSec + 1) * 1000);
  }, [melody, totalSec, firstNoteMidi, startMic, countdown, startClick, evaluate,
      scoreRef, tearDownCapture]);

  // Primary button — Start when idle/done, Restart during countdown/recording.
  const handleStart = useCallback(() => { void startCapture(); }, [startCapture]);
  const handleStop  = useCallback(() => { evaluate();         }, [evaluate]);

  // Cleanup on unmount.
  useEffect(() => () => {
    tearDownCapture();
    stopMetronome();
  }, [tearDownCapture, stopMetronome]);

  const isActive       = phase === "recording" || phase === "countdown";
  // Once an attempt has started (active or finished), the primary button
  // is "Restart" — only the first, pre-attempt view shows "Start".
  const showRestart    = isActive || phase === "done";
  const passed         = passPct !== null && passPct >= PASS_RATIO;

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

      {/* Piano roll — always visible, regardless of pass/fail. Grades and
          pitch line persist until the next Restart so the student can
          review their performance below any summary/celebration panel. */}
      <div className="rounded-xl border border-zinc-100 overflow-hidden">
        <div className="flex items-center justify-between px-3 pt-2 pb-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
            Your performance
          </p>
          {phase === "done" && passPct !== null && (
            <p className={`text-xs font-semibold ${passed ? "text-green-600" : "text-red-500"}`}>
              {passed ? "✓ " : "✗ "}{Math.round(passPct * 100)}%
            </p>
          )}
        </div>
        <div ref={scrollRef} className="w-full overflow-x-auto">
          <MeasurePianoRoll
            ref={rollRef}
            targetNotes={melodyNotes}
            measureDuration={totalSec || 1}
            noteGrades={noteGrades}
            isRecording={phase === "recording"}
            pxPerSec={PX_PER_SEC}
          />
        </div>
      </div>

      {/* Pass panel — shown BELOW the roll, not replacing it, so the
          coloured grades + sung pitch line remain visible. Its Restart
          button is the only way to clear the roll for a fresh attempt. */}
      {completed && (
        <div className="rounded-2xl border border-zinc-100 p-4">
          <Celebration
            onRestart={() => { setCompleted(false); void startCapture(); }}
          />
        </div>
      )}

      {/* Summary — shown on a failed attempt, after the student has stopped
          or the auto-stop fired. Grades on the roll above stay coloured
          until the next Restart, so the student can compare visually. */}
      {!completed && phase === "done" && passPct !== null && (() => {
        const counts = { green: 0, yellow: 0, red: 0 };
        noteGrades.forEach((g) => { counts[g]++; });
        const nonRest = melodyNotes.filter((n) => !n.isRest).length;
        return (
          <div className="rounded-lg border border-zinc-100 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
            <p className="font-medium">Nice try !!</p>
            <p className="mt-1 text-zinc-600">
              You hit <span className="font-semibold text-green-600">{counts.green}</span> note
              {counts.green === 1 ? "" : "s"} spot on,{" "}
              <span className="font-semibold text-amber-600">{counts.yellow}</span> close,{" "}
              and <span className="font-semibold text-red-500">{counts.red}</span> off —
              {" "}scored {Math.round(passPct * 100)} % of {nonRest}. Aim for
              {" "}{Math.round(PASS_RATIO * 100)} % to clear the melody.
            </p>
          </div>
        );
      })()}

      {/* Controls */}
      {!completed && (
        <div className="flex items-center gap-2">
          <button
            onClick={handleStart}
            className="flex h-9 items-center gap-2 rounded-full bg-indigo-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 active:scale-95 transition-all"
          >
            {showRestart ? (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                  <path d="M3 12a9 9 0 1 0 3-6.7" />
                  <path d="M3 4v5h5" />
                </svg>
                Restart
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5 translate-x-[1px]">
                  <path d="M8 5v14l11-7z" />
                </svg>
                Start
              </>
            )}
          </button>

          {isActive && (
            <button
              onClick={handleStop}
              className="flex h-9 items-center gap-2 rounded-full bg-red-500 px-4 text-sm font-medium text-white shadow-sm hover:bg-red-400 active:scale-95 transition-all"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
              Stop
            </button>
          )}

          <div className="ml-auto flex items-center gap-3 text-xs text-zinc-400">
            {phase === "recording" && (
              <span className="flex items-center gap-2 text-red-500">
                <span className="inline-block h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                Recording…
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
