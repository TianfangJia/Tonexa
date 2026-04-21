// ── Piano playback via Tone.js Salamander samples ─────────────────────────
// Salamander Grand Piano samples from the Tone.js CDN – free, high quality,
// no self-hosting required for MVP.

import * as Tone from "tone";
import { midiToNoteName } from "@/lib/utils/midiUtils";

// Cache the *loading promise* — not the sampler reference — so callers that
// await getSampler() don't receive a half-constructed sampler whose buffers
// haven't arrived yet. Multiple concurrent callers share the same promise.
let samplerLoad: Promise<Tone.Sampler> | null = null;
let samplerRef: Tone.Sampler | null = null;

function getSampler(): Promise<Tone.Sampler> {
  if (samplerLoad) return samplerLoad;
  samplerLoad = new Promise<Tone.Sampler>((resolve, reject) => {
    const s = new Tone.Sampler({
      urls: {
        A0: "A0.mp3", C1: "C1.mp3", "D#1": "Ds1.mp3", "F#1": "Fs1.mp3",
        A1: "A1.mp3", C2: "C2.mp3", "D#2": "Ds2.mp3", "F#2": "Fs2.mp3",
        A2: "A2.mp3", C3: "C3.mp3", "D#3": "Ds3.mp3", "F#3": "Fs3.mp3",
        A3: "A3.mp3", C4: "C4.mp3", "D#4": "Ds4.mp3", "F#4": "Fs4.mp3",
        A4: "A4.mp3", C5: "C5.mp3", "D#5": "Ds5.mp3", "F#5": "Fs5.mp3",
        A5: "A5.mp3", C6: "C6.mp3", "D#6": "Ds6.mp3", "F#6": "Fs6.mp3",
        A6: "A6.mp3", C7: "C7.mp3", "D#7": "Ds7.mp3", "F#7": "Fs7.mp3",
        A7: "A7.mp3", C8: "C8.mp3",
      },
      baseUrl: "https://tonejs.github.io/audio/salamander/",
      onload: () => { samplerRef = s; resolve(s); },
      onerror: reject,
    }).toDestination();
  });
  return samplerLoad;
}

/** Kick off sample loading without blocking. Safe to call on mount. */
export function preloadPiano(): void {
  void getSampler();
}

/**
 * Play a single MIDI note.
 * @param midi    MIDI note number
 * @param durationSec  Duration in seconds
 * @param when    Tone.js time (defaults to "now")
 */
export async function playNote(
  midi: number,
  durationSec: number,
  when: Tone.Unit.Time = Tone.now()
): Promise<void> {
  const s = await getSampler();
  await Tone.start(); // resume AudioContext after user gesture
  s.triggerAttackRelease(midiToNoteName(midi), durationSec, when);
}

/**
 * Schedule a sequence of NoteEvents for playback.
 * @param notes  Array of {midi, startSec, durationSec}
 * @param startOffset  Tone.js time offset added to all start times
 */
export async function scheduleNotes(
  notes: Array<{ midi: number; startSec: number; durationSec: number; isRest: boolean }>,
  startOffset: number = 0
): Promise<void> {
  const s = await getSampler();
  await Tone.start();
  for (const note of notes) {
    if (note.isRest) continue;
    s.triggerAttackRelease(
      midiToNoteName(note.midi),
      note.durationSec,
      Tone.now() + startOffset + note.startSec
    );
  }
}

/** Stop all currently playing notes. */
export function stopPiano(): void {
  samplerRef?.releaseAll();
}
