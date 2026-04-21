// ── MusicXML transposition ─────────────────────────────────────────────────
// Two concerns:
//   1. Shift NoteEvent MIDI numbers for scoring/playback.
//   2. Patch the raw MusicXML XML so OSMD renders the correct key/notes.

import type { NoteEvent, ParsedMelody } from "@/types/music";
import { KEY_TO_SEMITONES, TranspositionKey } from "@/types/music";

/**
 * Return a new ParsedMelody with all timing scaled to a new tempo.
 * The original is not mutated.
 */
export function scaleMelodyTempo(melody: ParsedMelody, newTempo: number): ParsedMelody {
  if (newTempo === melody.tempo) return melody;
  const scale = melody.tempo / newTempo;
  return {
    ...melody,
    tempo: newTempo,
    beatDurationSec: melody.beatDurationSec * scale,
    measureDurationSec: melody.measureDurationSec * scale,
    notes: melody.notes.map((n) => ({
      ...n,
      startSec: n.startSec * scale,
      durationSec: n.durationSec * scale,
    })),
  };
}

/**
 * Return a new ParsedMelody with all MIDI note numbers shifted by `semitones`.
 * The original is not mutated.
 */
export function transposeParsedMelody(
  melody: ParsedMelody,
  semitones: number
): ParsedMelody {
  if (semitones === 0) return melody;
  return {
    ...melody,
    notes: melody.notes.map((n) =>
      n.isRest ? n : { ...n, midi: n.midi + semitones }
    ),
  };
}

/**
 * Calculate the semitone shift from originalKey → targetKey.
 * Always produces a value in [-6, 6] (closest transposition).
 */
export function semitoneShift(
  originalKey: TranspositionKey,
  targetKey: TranspositionKey
): number {
  const from = KEY_TO_SEMITONES[originalKey];
  const to = KEY_TO_SEMITONES[targetKey];
  let diff = to - from;
  // Wrap to [-6, 6] so we choose the closest direction
  if (diff > 6) diff -= 12;
  if (diff < -6) diff += 12;
  return diff;
}

// Sharp spellings: index = pitch class (0–11)
const SHARP_SPELL: [string, number][] = [
  ["C",0],["C",1],["D",0],["D",1],["E",0],
  ["F",0],["F",1],["G",0],["G",1],["A",0],["A",1],["B",0],
];
// Flat spellings: index = pitch class (0–11)
const FLAT_SPELL: [string, number][] = [
  ["C",0],["D",-1],["D",0],["E",-1],["E",0],
  ["F",0],["G",-1],["G",0],["A",-1],["A",0],["B",-1],["B",0],
];

// Semitone offset for each diatonic step (matching stepOctaveToMidi)
const STEP_OFFSET: Record<string,number> = {C:0,D:2,E:4,F:5,G:7,A:9,B:11};

/** Shift a single pitch element's MIDI by semitones and re-encode step/alter/octave. */
function transposePitch(step: string, octave: number, alter: number, semitones: number, useFlats: boolean): string {
  const midi = (octave + 1) * 12 + (STEP_OFFSET[step] ?? 0) + Math.round(alter);
  const newMidi = midi + semitones;
  const newOctave = Math.floor(newMidi / 12) - 1;
  const pc = ((newMidi % 12) + 12) % 12;
  const [newStep, newAlter] = useFlats ? FLAT_SPELL[pc] : SHARP_SPELL[pc];
  let out = `<step>${newStep}</step>`;
  if (newAlter !== 0) out += `<alter>${newAlter}</alter>`;
  out += `<octave>${newOctave}</octave>`;
  return `<pitch>${out}</pitch>`;
}

/**
 * Transpose a raw MusicXML string by `semitones`.
 * Actually moves every <pitch> element and updates the key signature.
 */
export function transposeXML(xmlText: string, semitones: number): string {
  if (semitones === 0) return xmlText;

  // Compute new fifths value to determine sharp/flat spelling
  const origMatch = xmlText.match(/<fifths>([-\d]+)<\/fifths>/);
  const origFifths = origMatch ? parseInt(origMatch[1], 10) : 0;
  const newFifths = origFifths + semitoneToFifths(semitones);
  const useFlats = newFifths < 0;

  // Update key signature(s)
  let result = xmlText.replace(
    /(<fifths>)([-\d]+)(<\/fifths>)/g,
    `$1${newFifths}$3`
  );

  // Remove any existing <transpose> elements (we're doing real pitch transposition)
  result = result.replace(/<transpose>[\s\S]*?<\/transpose>/g, "");

  // Shift every <pitch> element
  result = result.replace(/<pitch>([\s\S]*?)<\/pitch>/g, (_, inner) => {
    const stepM = inner.match(/<step>([A-G])<\/step>/);
    const octM  = inner.match(/<octave>([-\d]+)<\/octave>/);
    const altM  = inner.match(/<alter>([-\d.]+)<\/alter>/);
    if (!stepM || !octM) return `<pitch>${inner}</pitch>`;
    return transposePitch(
      stepM[1],
      parseInt(octM[1], 10),
      altM ? parseFloat(altM[1]) : 0,
      semitones,
      useFlats
    );
  });

  return result;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function semitoneToFifths(semitones: number): number {
  const map: Record<number, number> = {
    0:0, 1:-5, 2:2, 3:-3, 4:4, 5:-1,
    6:6, 7:1, 8:-4, 9:3, 10:-2, 11:5,
    "-1":5, "-2":-2, "-3":3, "-4":-4,
    "-5":1, "-6":6, "-7":-1, "-8":4,
    "-9":-3, "-10":-5, "-11":-5,
  };
  return map[semitones] ?? 0;
}
