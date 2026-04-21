// ── MIDI / frequency utilities ─────────────────────────────────────────────

/** Convert MIDI note number to frequency in Hz. A4 = 69 = 440 Hz. */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Convert frequency in Hz to nearest MIDI note number (float). */
export function freqToMidi(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440);
}

/** Cents deviation between two frequencies. Positive = f2 > f1. */
export function centsBetween(f1: number, f2: number): number {
  return 1200 * Math.log2(f2 / f1);
}

/** Cents deviation between a frequency and a target MIDI note. */
export function centsFromMidi(freqHz: number, targetMidi: number): number {
  return centsBetween(midiToFreq(targetMidi), freqHz);
}

const STEP_OFFSETS: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

/** Convert MusicXML step/octave/alter to MIDI note number. */
export function stepOctaveToMidi(
  step: string,
  octave: number,
  alter: number = 0
): number {
  return (octave + 1) * 12 + (STEP_OFFSETS[step] ?? 0) + Math.round(alter);
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** Convert MIDI number to display name like "C4", "F#3". */
export function midiToNoteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const name = NOTE_NAMES[midi % 12];
  return `${name}${octave}`;
}

/** Round float MIDI to nearest integer. */
export function roundMidi(midi: number): number {
  return Math.round(midi);
}

/** Clamp value between min and max. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
