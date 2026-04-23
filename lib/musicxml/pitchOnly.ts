// ── Pitch-only melody transform ───────────────────────────────────────────
// For Pitch mode (mode 1): strip rhythm so the student can focus on pitch.
//   1. Extract pitches from the source melody.
//   2. Drop any note whose pitch equals the previous kept pitch (so B B A → B A).
//   3. Emit each remaining pitch as a single note that occupies one full measure
//      (whole in 4/4, dotted half in 3/4, half in 2/4, dotted half in 6/8, …).

import type { NoteEvent, ParsedMelody } from "@/types/music";

/** Build a pitch-only ParsedMelody: one whole-measure note per distinct pitch. */
export function buildPitchOnlyMelody(melody: ParsedMelody): ParsedMelody {
  const voiced = melody.notes.filter((n) => !n.isRest);
  const distinct: number[] = [];
  for (const n of voiced) {
    if (distinct.length === 0 || distinct[distinct.length - 1] !== n.midi) {
      distinct.push(n.midi);
    }
  }

  const measureDur = melody.measureDurationSec;
  const notes: NoteEvent[] = distinct.map((midi, i) => ({
    midi,
    startSec: i * measureDur,
    durationSec: measureDur,
    measure: i + 1,
    indexInMeasure: 0,
    isRest: false,
  }));

  return {
    ...melody,
    notes,
    measureCount: Math.max(distinct.length, 1),
  };
}

// Largest-first legal note lengths in 16th-note units.
const NOTE_SEGMENTS: Array<{ d: number; type: string; dots: number }> = [
  { d: 16, type: "whole",   dots: 0 },
  { d: 12, type: "half",    dots: 1 },
  { d:  8, type: "half",    dots: 0 },
  { d:  6, type: "quarter", dots: 1 },
  { d:  4, type: "quarter", dots: 0 },
  { d:  3, type: "eighth",  dots: 1 },
  { d:  2, type: "eighth",  dots: 0 },
  { d:  1, type: "16th",    dots: 0 },
];

function splitDuration(totalSixteenths: number): Array<{ d: number; type: string; dots: number }> {
  const out: Array<{ d: number; type: string; dots: number }> = [];
  let remaining = totalSixteenths;
  while (remaining > 0) {
    const seg = NOTE_SEGMENTS.find((s) => s.d <= remaining);
    if (!seg) break;
    out.push(seg);
    remaining -= seg.d;
  }
  return out;
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
 * Build MusicXML for the pitch-only score: one note per measure.
 * Each measure contains a single pitch rendered as the largest legal note that
 * fills the bar, with ties where a single legal value doesn't cover the full
 * duration (rare — only irregular time sigs).
 */
export function buildPitchOnlyXml(
  pitches: number[],
  beatsPerMeasure: number,
  beatUnit: number,
  fifths: number,
): string {
  const useFlats = fifths < 0;
  const sixteenthsPerBeat = 16 / beatUnit;
  const totalSixteenths = Math.max(1, Math.round(beatsPerMeasure * sixteenthsPerBeat));
  const segs = splitDuration(totalSixteenths);

  const attributes =
    `      <attributes>
        <divisions>4</divisions>
        <key><fifths>${fifths}</fifths></key>
        <time><beats>${beatsPerMeasure}</beats><beat-type>${beatUnit}</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>`;

  const measuresXml: string[] = [];
  const list = pitches.length > 0 ? pitches : [];

  if (list.length === 0) {
    // Fallback: single empty measure with a whole-measure rest.
    measuresXml.push(
      `    <measure number="1">
${attributes}
      <note><rest measure="yes"/><duration>${totalSixteenths}</duration><voice>1</voice></note>
    </measure>`,
    );
  } else {
    list.forEach((midi, i) => {
      const pXml = pitchXml(midi, useFlats);
      const noteLines: string[] = [];
      segs.forEach((seg, segIdx) => {
        const isFirst = segIdx === 0;
        const isLast = segIdx === segs.length - 1;
        const dotXml = "<dot/>".repeat(seg.dots);
        let tieXml = "";
        let tiedXml = "";
        if (segs.length > 1) {
          if (!isLast) {
            tieXml += `<tie type="start"/>`;
            tiedXml += `<tied type="start"/>`;
          }
          if (!isFirst) {
            tieXml += `<tie type="stop"/>`;
            tiedXml += `<tied type="stop"/>`;
          }
        }
        const notationsXml = tiedXml ? `<notations>${tiedXml}</notations>` : "";
        noteLines.push(
          `      <note>${pXml}<duration>${seg.d}</duration>${tieXml}` +
          `<voice>1</voice><type>${seg.type}</type>${dotXml}${notationsXml}</note>`,
        );
      });
      // Only first measure carries <attributes>; subsequent inherit.
      const attrsBlock = i === 0 ? `\n${attributes}` : "";
      // Double barline between pitches; final barline closes the piece.
      const isLastMeasure = i === list.length - 1;
      const barStyle = isLastMeasure ? "light-heavy" : "light-light";
      const barlineXml = `      <barline location="right"><bar-style>${barStyle}</bar-style></barline>`;
      measuresXml.push(
        `    <measure number="${i + 1}">${attrsBlock}
${noteLines.join("\n")}
${barlineXml}
    </measure>`,
      );
    });
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.0">
  <part-list>
    <score-part id="P1"><part-name></part-name></score-part>
  </part-list>
  <part id="P1">
${measuresXml.join("\n")}
  </part>
</score-partwise>`;
}

/** Extract the circle-of-fifths count from a MusicXML string (0 if absent). */
export function extractFifths(xml: string): number {
  const m = xml.match(/<fifths>(-?\d+)<\/fifths>/);
  return m ? parseInt(m[1], 10) : 0;
}
