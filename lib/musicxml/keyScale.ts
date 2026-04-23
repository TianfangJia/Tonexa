// ── Key-scale helper ──────────────────────────────────────────────────────
// Generates an 8-note ascending major scale for any TranspositionKey —
// used by the Overview mode's "Tonal Primer" so students can hear and see
// the diatonic ladder of the current key before practicing.

import type { TranspositionKey } from "@/types/music";
import { KEY_TO_SEMITONES } from "@/types/music";

/** Circle-of-fifths count for each major key — drives key-signature rendering. */
const KEY_TO_FIFTHS: Record<TranspositionKey, number> = {
  C: 0,
  G: 1, D: 2, A: 3, E: 4, B: 5, "F#": 6, "C#": 7,
  F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6,
  // Enharmonic equivalents — map to whichever spelling reads cleaner.
  "D#": 3,  // respelled as Eb internally; display uses Eb's 3 flats
  "G#": 4,  // Ab equivalent
  "A#": 5,  // Bb equivalent
};

const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11, 12];

/** Tonic MIDI in octave 4 for each key — keeps the scale centered. */
function tonicMidi(key: TranspositionKey): number {
  return 60 + KEY_TO_SEMITONES[key]; // C4=60 + offset
}

export type ScaleDirection = "up" | "down";

/** Major-scale MIDI numbers for the given key (8 notes, tonic→tonic). */
export function buildScaleMidis(
  key: TranspositionKey,
  direction: ScaleDirection = "up",
): number[] {
  const root = tonicMidi(key);
  const ascending = MAJOR_STEPS.map((s) => root + s);
  return direction === "up" ? ascending : [...ascending].reverse();
}

const SHARP_STEPS = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"];
const SHARP_ALTERS = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
const FLAT_STEPS = ["C", "D", "D", "E", "E", "F", "G", "G", "A", "A", "B", "B"];
const FLAT_ALTERS = [0, -1, 0, -1, 0, 0, -1, 0, -1, 0, -1, 0];

function pitchXml(midi: number, useFlats: boolean): string {
  const pc = ((midi % 12) + 12) % 12;
  const step = (useFlats ? FLAT_STEPS : SHARP_STEPS)[pc];
  const alter = (useFlats ? FLAT_ALTERS : SHARP_ALTERS)[pc];
  const octave = Math.floor(midi / 12) - 1;
  const alterXml = alter !== 0 ? `<alter>${alter}</alter>` : "";
  return `<pitch><step>${step}</step>${alterXml}<octave>${octave}</octave></pitch>`;
}

/**
 * Render the major scale across two 4/4 measures of quarter notes.
 * The key signature is the scale's natural key; direction flips the note order.
 */
export function buildScaleXml(
  key: TranspositionKey,
  direction: ScaleDirection = "up",
): string {
  const fifths = KEY_TO_FIFTHS[key] ?? 0;
  const useFlats = fifths < 0;
  const midis = buildScaleMidis(key, direction);

  // 8 quarter notes over 2 measures of 4/4 (4 notes each). Two measures keep
  // the staff readable instead of cramming 8 notes into one bar.
  const notesXml: string[] = [];
  midis.forEach((midi) => {
    notesXml.push(
      `      <note>${pitchXml(midi, useFlats)}` +
      `<duration>4</duration><voice>1</voice><type>quarter</type></note>`,
    );
  });

  const attributes =
    `      <attributes>
        <divisions>4</divisions>
        <key><fifths>${fifths}</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>`;

  // Measure 1 → notes 0..3, Measure 2 → notes 4..7 with final barline.
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.0">
  <part-list>
    <score-part id="P1"><part-name></part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
${attributes}
${notesXml.slice(0, 4).join("\n")}
    </measure>
    <measure number="2">
${notesXml.slice(4, 8).join("\n")}
      <barline location="right"><bar-style>light-heavy</bar-style></barline>
    </measure>
  </part>
</score-partwise>`;
}
