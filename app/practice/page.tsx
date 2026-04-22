"use client";
// ── Main Practice Page ─────────────────────────────────────────────────────

import React, { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";

import type { MelodyRecord, TranspositionKey } from "@/types/music";
import type { ParsedMelody } from "@/types/music";
import type { PracticeMode } from "@/types/session";
import type { SungNote } from "@/components/piano-roll/PianoRoll";
import type { ScoreRendererHandle } from "@/components/score/ScoreRenderer";
import type { PerformanceSummary } from "@/types/scoring";

import { fetchMelodies, fetchMelodyById } from "@/lib/db/melodies";
import { parseMusicXML } from "@/lib/musicxml/parser";
import {
  transposeParsedMelody,
  semitoneShift,
  transposeXML,
  scaleMelodyTempo,
} from "@/lib/musicxml/transposer";
import { upsertResult } from "@/lib/db/results";

import ModeSelector from "@/components/ui/ModeSelector";
import TranspositionSelector from "@/components/ui/TranspositionSelector";
import TempoSlider from "@/components/ui/TempoSlider";
import Celebration from "@/components/ui/Celebration";
import { playNote, stopPiano } from "@/lib/playback/piano";
import PianoRoll from "@/components/piano-roll/PianoRoll";
import ScoreRenderer from "@/components/score/ScoreRenderer";

// Dynamic imports for browser-only heavy components.
// NOTE: ScoreRenderer is imported directly — next/dynamic silently drops
// forwardRef refs, which broke the imperative cursor/coloring API.
const PitchMode = dynamic(() => import("@/components/modes/PitchMode"), { ssr: false });
const RhythmMode = dynamic(() => import("@/components/modes/RhythmMode"), { ssr: false });
const MelodyMode = dynamic(() => import("@/components/modes/MelodyMode"), { ssr: false });
const MelodyReadyMode = dynamic(() => import("@/components/modes/MelodyReadyMode"), { ssr: false });

export default function PracticePage() {
  const router = useRouter();
  const scoreRef = useRef<ScoreRendererHandle>(null);

  // ── Session state ─────────────────────────────────────────
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [studentName, setStudentName] = useState("Student");
  const [melodyRecord, setMelodyRecord] = useState<MelodyRecord | null>(null);
  const [parsedMelody, setParsedMelody] = useState<ParsedMelody | null>(null);
  const [transposedMelody, setTransposedMelody] = useState<ParsedMelody | null>(null);
  const [transposedXML, setTransposedXML] = useState<string>("");
  const [transposition, setTransposition] = useState<TranspositionKey>("C");
  const [mode, setMode] = useState<PracticeMode>(1);
  const [baseTempo, setBaseTempo] = useState(60);
  // Default practice tempo = 84 BPM (middle preset). Overrides any tempo
  // that happens to be stored in the loaded melody's XML.
  const [currentTempo, setCurrentTempo] = useState(84);
  const [livePitchMidi, setLivePitchMidi] = useState<number | null>(null);
  const [allMelodies, setAllMelodies] = useState<MelodyRecord[]>([]);
  const [pitchNoteIndex, setPitchNoteIndex] = useState(0);
  const [pitchScrollVersion, setPitchScrollVersion] = useState(0);
  // Measure that MelodyMode is currently drilling (0-indexed into the
  // measure list). Lifted here so the card between score and piano roll can
  // track the same measure MelodyMode is working on.
  const [melodyMeasureIdx, setMelodyMeasureIdx] = useState(0);
  // Full-piece playback of the loaded melody. Lives here so the play button
  // can sit in the score-section header (matching rhythm-mode placement),
  // instead of inside the per-mode panel below.
  const [isPlayingAll, setIsPlayingAll] = useState(false);
  const playAllActiveRef   = useRef(false);
  const playAllTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // ── Resizable panel heights ───────────────────────────────
  const [scoreHeight, setScoreHeight] = useState(320);
  const [rollHeight, setRollHeight] = useState(384);
  const dragStateRef = useRef<{ startY: number; startScore: number; startRoll: number } | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const s = dragStateRef.current;
      if (!s) return;
      const delta = e.clientY - s.startY;
      setScoreHeight(Math.max(80, s.startScore + delta));
      setRollHeight(Math.max(100, s.startRoll - delta));
    };
    const onUp = () => { dragStateRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const handleLivePitch = useCallback((midi: number | null, _atSec: number) => {
    setLivePitchMidi(midi);
  }, []);

  // ── Piano roll state ──────────────────────────────────────
  const [sungNotes, setSungNotes] = useState<SungNote[]>([]);
  const [currentSec, setCurrentSec] = useState(0);
  const currentSecRef = useRef(0);

  // ── Load from sessionStorage ──────────────────────────────
  useEffect(() => {
    const sid = sessionStorage.getItem("sessionId");
    const sname = sessionStorage.getItem("studentName");
    const melodyId = sessionStorage.getItem("melodyId");
    if (!sid || !melodyId) { router.replace("/"); return; }

    setSessionId(sid);
    setStudentName(sname ?? "Student");

    fetchMelodies().then(setAllMelodies).catch(() => {});

    fetchMelodyById(melodyId)
      .then((m) => {
        setMelodyRecord(m);
        const parsed = parseMusicXML(m.musicxml_content);
        setParsedMelody(parsed);
        setBaseTempo(parsed.tempo);
        setCurrentTempo(84); // always default the practice tempo to 84 BPM
        const initialKey: TranspositionKey = parsed.defaultKey ?? "C";
        setTransposition(initialKey);
        applyTransposition(parsed, m, initialKey);
      })
      .catch(() => router.replace("/"));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clear sung notes when switching modes so rhythm-mode onsets don't
  // leak into the pitch-mode piano roll.
  useEffect(() => {
    setSungNotes([]);
    setPitchNoteIndex(0);
  }, [mode]);

  const applyTransposition = useCallback(
    (parsed: ParsedMelody, record: MelodyRecord, targetKey: TranspositionKey) => {
      const sourceKey = (parsed.defaultKey ?? record.default_key) as TranspositionKey;
      const shift = semitoneShift(sourceKey, targetKey);
      const transposed = transposeParsedMelody(parsed, shift);
      const xml = transposeXML(record.musicxml_content, shift);
      setTransposedMelody(transposed);
      setTransposedXML(xml);
      setSungNotes([]);
      setPitchNoteIndex(0);
    },
    []
  );

  const handleTranspositionChange = useCallback(
    (newKey: TranspositionKey) => {
      setTransposition(newKey);
      if (parsedMelody && melodyRecord) {
        applyTransposition(parsedMelody, melodyRecord, newKey);
      }
    },
    [parsedMelody, melodyRecord, applyTransposition]
  );

  const handleAssignmentChange = useCallback(
    async (newId: string) => {
      if (newId === melodyRecord?.id) return;
      sessionStorage.setItem("melodyId", newId);
      try {
        const m = await fetchMelodyById(newId);
        setMelodyRecord(m);
        const parsed = parseMusicXML(m.musicxml_content);
        setParsedMelody(parsed);
        setBaseTempo(parsed.tempo);
        setCurrentTempo(84); // always default the practice tempo to 84 BPM
        const initialKey: TranspositionKey = parsed.defaultKey ?? "C";
        setTransposition(initialKey);
        applyTransposition(parsed, m, initialKey);
        setSungNotes([]);
        setPitchNoteIndex(0);
        setPitchScrollVersion((v) => v + 1);
        setCurrentSec(0);
        currentSecRef.current = 0;
      } catch (_) {}
    },
    [melodyRecord?.id, applyTransposition]
  );

  // ── Piano roll update ────────────────────────────────────
  const handleSungNote = useCallback((note: SungNote) => {
    setSungNotes((prev) => [...prev.slice(-200), note]); // keep last 200 notes
    setCurrentSec(note.startSec);
    currentSecRef.current = note.startSec;
  }, []);

  // ── Mode completion ───────────────────────────────────────
  // When any mode finishes, capture the score and pop the celebration
  // overlay. The overlay is dismissable; saving the result happens in
  // parallel so the backend isn't gated on the user closing it.
  const [celebrationScore, setCelebrationScore] = useState<number | null>(null);
  // Whenever the active mode changes, the incoming mode should start from
  // a clean state — never inherit a celebration left over from the mode
  // the user just navigated away from.
  useEffect(() => { setCelebrationScore(null); }, [mode]);
  // Reset melody drill's measure index whenever the mode changes or the
  // underlying melody is reloaded.
  useEffect(() => { setMelodyMeasureIdx(0); }, [mode, transposedXML]);

  const handleModeComplete = useCallback(
    async (modeNum: PracticeMode, scorePct: number, details?: PerformanceSummary) => {
      // Rhythm (mode 2) owns its own inline celebration — don't double-fire
      // the page-level overlay on top of it.
      if (modeNum !== 2) setCelebrationScore(scorePct);
      if (!sessionId) return;
      await upsertResult(sessionId, modeNum, true, scorePct, (details as unknown as Record<string, unknown>) ?? {});
    },
    [sessionId]
  );

  const activeMelody = mode >= 2 && transposedMelody
    ? scaleMelodyTempo(transposedMelody, currentTempo)
    : transposedMelody;

  const stopPlayAll = useCallback(() => {
    playAllActiveRef.current = false;
    playAllTimeoutsRef.current.forEach(clearTimeout);
    playAllTimeoutsRef.current = [];
    stopPiano();
    scoreRef.current?.showCursor(false);
    setIsPlayingAll(false);
  }, []);

  const handlePlayAll = useCallback(() => {
    if (!activeMelody) return;
    if (isPlayingAll) { stopPlayAll(); return; }
    playAllActiveRef.current = true;
    setIsPlayingAll(true);

    scoreRef.current?.showCursor(true);
    scoreRef.current?.setCursorIndex(0);

    const notes = activeMelody.notes;
    const firstSec = notes[0]?.startSec ?? 0;

    // Trigger each note via setTimeout + playNote (not Tone's pre-scheduler)
    // so a pause that clears these timeouts genuinely silences the rest of
    // the piece — Tone's pre-scheduled attacks aren't cancellable after
    // they've been queued.
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    notes.forEach((note, i) => {
      const whenMs = (note.startSec - firstSec) * 1000;
      timeouts.push(setTimeout(() => {
        if (!playAllActiveRef.current) return;
        scoreRef.current?.setCursorIndex(i);
        if (!note.isRest) void playNote(note.midi, note.durationSec);
      }, whenMs));
    });
    const last = notes[notes.length - 1];
    if (last) {
      timeouts.push(setTimeout(() => {
        if (playAllActiveRef.current) stopPlayAll();
      }, (last.startSec - firstSec + last.durationSec) * 1000 + 400));
    }
    playAllTimeoutsRef.current = timeouts;
  }, [activeMelody, isPlayingAll, stopPlayAll]);

  // Stop any in-flight playback when the user switches melody or mode.
  useEffect(() => { stopPlayAll(); }, [mode, transposedXML, stopPlayAll]);

  const totalSec = activeMelody
    ? activeMelody.notes.reduce((max, n) => Math.max(max, n.startSec + n.durationSec), 0)
    : 60;

  if (!transposedMelody || !melodyRecord) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-zinc-400">Loading…</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col md:px-6 md:py-4 lg:px-9 xl:px-12">
      {/* ── Top bar ──────────────────────────────────────── */}
      <header className="relative flex items-center justify-between border-b border-zinc-100 px-5 py-3">
        {/* Left: student */}
        <div className="flex-1">
          <p className="text-xs text-zinc-400">Practicing as</p>
          <p className="text-sm font-semibold text-zinc-800">{studentName}</p>
        </div>

        {/* Center: brand */}
        <div className="absolute left-1/2 -translate-x-1/2 pointer-events-none select-none flex flex-col items-center leading-none">
          <div className="flex items-baseline">
            <span className="text-xl font-bold text-zinc-800">Tone</span>
            <span className="text-xl font-bold text-indigo-400">xa</span>
          </div>
          <span className="mt-0.5 text-[10px] font-medium tracking-wide text-zinc-400">
            by Tianfang
          </span>
        </div>

        {/* Right: assignment */}
        <div className="flex flex-1 items-end justify-end gap-3">
          <div>
            <select
              value={melodyRecord.id}
              onChange={(e) => handleAssignmentChange(e.target.value)}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              {allMelodies.map((m) => (
                <option key={m.id} value={m.id}>{m.title}</option>
              ))}
              {/* Fallback if list hasn't loaded yet */}
              {allMelodies.length === 0 && (
                <option value={melodyRecord.id}>{melodyRecord.title}</option>
              )}
            </select>
          </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* ── Mode selector + tempo (above the score) ── */}
        <section className="flex flex-col gap-2 border-b border-zinc-100 px-4 py-3 flex-shrink-0">
          <ModeSelector current={mode} onChange={setMode} />
          {mode >= 2 && (
            // Two-column grid: tempo on the left, key on the right.
            // `items-center` aligns them to a shared invisible horizontal
            // midline — the slider's track lines up with the Key select.
            <div className="grid w-full grid-cols-2 items-center gap-6">
              <TempoSlider
                baseTempo={baseTempo}
                beatUnit={transposedMelody.beatUnit}
                value={currentTempo}
                onChange={setCurrentTempo}
              />
              {/* Melody modes expose key selection inline next to tempo —
                  rhythm has no pitch so the selector stays hidden there. */}
              {mode >= 3 ? (
                <TranspositionSelector
                  value={transposition}
                  onChange={handleTranspositionChange}
                />
              ) : (
                <span />
              )}
            </div>
          )}
        </section>

        {/* ── Score area (hidden in Rhythm mode — it renders its own) ── */}
        {mode !== 2 && (
          <section className="relative border-b border-zinc-100 px-4 py-2 overflow-hidden flex-shrink-0" style={{ height: scoreHeight }}>
            {/* Full-piece play/pause button — matches rhythm-mode's
                placement (top-right of the score container). */}
            <button
              onClick={handlePlayAll}
              disabled={!activeMelody}
              aria-label={isPlayingAll ? "Pause" : "Play"}
              title={isPlayingAll ? "Pause" : "Play"}
              className="absolute right-4 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-indigo-600 text-white shadow-sm hover:bg-indigo-500 active:scale-95 transition-all disabled:opacity-40"
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
            <ScoreRenderer
              ref={scoreRef}
              musicXml={transposedXML}
              className="h-full overflow-y-auto"
              onContentHeightChange={(h) => setScoreHeight(h + 16)}
            />
          </section>
        )}

        {/* ── Melody drill (card + Start button) lives here, between
             the full score and the piano roll. ── */}
        {mode === 3 && activeMelody && (
          <section className="border-b border-zinc-100 px-4 py-3 flex-shrink-0">
            <MelodyMode
              melody={activeMelody}
              musicXml={transposedXML}
              scoreRef={scoreRef}
              onComplete={(pct) => handleModeComplete(3, pct)}
              measureIdx={melodyMeasureIdx}
              onMeasureIdxChange={setMelodyMeasureIdx}
              onNext={() => setMode(4)}
            />
          </section>
        )}

        {/* ── Drag handle ───────────────────────────────── */}
        {mode !== 2 && mode !== 3 && mode !== 4 && (
          <div
            className="flex h-3 cursor-row-resize items-center justify-center bg-zinc-50 hover:bg-zinc-100 border-b border-zinc-100 flex-shrink-0 select-none"
            onMouseDown={(e) => {
              dragStateRef.current = { startY: e.clientY, startScore: scoreHeight, startRoll: rollHeight };
            }}
          >
            <div className="h-1 w-10 rounded-full bg-zinc-300" />
          </div>
        )}

        {/* ── Piano roll (hidden in Rhythm, Melody drill, and Ready modes) ─ */}
        {mode !== 2 && mode !== 3 && mode !== 4 && (
          <section className="px-4 py-2 flex-shrink-0">
            <div style={{ height: rollHeight }}>
              <PianoRoll
                targetNotes={activeMelody!.notes}
                sungNotes={sungNotes}
                currentSec={currentSec}
                totalSec={totalSec}
                pxPerSec={80}
                livePitchMidi={(mode === 1 || mode === 4) ? livePitchMidi : null}
                currentNoteIndex={mode === 1 ? pitchNoteIndex : undefined}
                scrollVersion={mode === 1 ? pitchScrollVersion : undefined}
                className="h-full"
              />
            </div>
          </section>
        )}

        {/* ── Active mode panel ─────────────────────────── */}
        <section className="flex-1 overflow-y-auto px-4 py-3 pb-8">
          {mode === 1 && (
            <PitchMode
              melody={transposedMelody}
              scoreRef={scoreRef}
              onSungNote={handleSungNote}
              onComplete={(pct) => handleModeComplete(1, pct)}
              onLivePitch={handleLivePitch}
              onNoteAdvance={setPitchNoteIndex}
              onRestart={() => { setSungNotes([]); setPitchScrollVersion((v) => v + 1); }}
              sessionId={sessionId ?? ""}
            />
          )}
          {mode === 2 && (
            <RhythmMode
              melody={activeMelody!}
              musicXml={transposedXML}
              onSungNote={handleSungNote}
              onComplete={(pct) => handleModeComplete(2, pct)}
              onNext={() => setMode(3)}
            />
          )}
          {/* mode 3 (Melody) is rendered above, between score and piano roll */}
          {mode === 4 && sessionId && (
            <MelodyReadyMode
              melody={activeMelody!}
              scoreRef={scoreRef}
              onComplete={(pct, summary) => handleModeComplete(4, pct, summary)}
              sessionId={sessionId}
            />
          )}
        </section>
      </div>

      {celebrationScore !== null && mode !== 2 && mode !== 3 && mode !== 4 && (
        // Placeholder overlay for non-rhythm modes — final positioning for
        // each mode will be adjusted in the mode's own layout later.
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <Celebration
              onRestart={() => setCelebrationScore(null)}
              onNext={() => setCelebrationScore(null)}
            />
          </div>
        </div>
      )}
    </main>
  );
}
