// ── MusicXML → NoteEvent[] parser ─────────────────────────────────────────
// Parses monophonic MusicXML using the browser's DOMParser.
// Does NOT depend on OSMD so it can run independently for scoring.

import type { NoteEvent, ParsedMelody, TranspositionKey } from "@/types/music";
import { stepOctaveToMidi } from "@/lib/utils/midiUtils";

const FIFTHS_MAJOR: Record<number, TranspositionKey> = {
  [-7]: "B", [-6]: "Gb", [-5]: "Db", [-4]: "Ab", [-3]: "Eb",
  [-2]: "Bb", [-1]: "F", 0: "C", 1: "G", 2: "D", 3: "A",
  4: "E", 5: "B", 6: "F#", 7: "C#",
};
const FIFTHS_MINOR: Record<number, TranspositionKey> = {
  [-7]: "Ab", [-6]: "Eb", [-5]: "Bb", [-4]: "F", [-3]: "C",
  [-2]: "G", [-1]: "D", 0: "A", 1: "E", 2: "B", 3: "F#",
  4: "C#", 5: "G#", 6: "D#", 7: "A#",
};

/** Parse raw MusicXML text into a structured ParsedMelody. */
export function parseMusicXML(xmlText: string): ParsedMelody {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");

  const errorNode = doc.querySelector("parsererror");
  if (errorNode) throw new Error("Invalid MusicXML: " + errorNode.textContent);

  // ── Gather global attributes from first measure ──────────────
  const firstMeasure = doc.querySelector("measure");
  if (!firstMeasure) throw new Error("No measures found in MusicXML");

  const divisionsEl = firstMeasure.querySelector("divisions");
  const divisions = divisionsEl ? parseInt(divisionsEl.textContent ?? "4", 10) : 4;

  const beatsEl = firstMeasure.querySelector("time > beats");
  const beatTypeEl = firstMeasure.querySelector("time > beat-type");
  const beatsPerMeasure = beatsEl ? parseInt(beatsEl.textContent ?? "4", 10) : 4;
  const beatUnit = beatTypeEl ? parseInt(beatTypeEl.textContent ?? "4", 10) : 4;

  const tempoEl = doc.querySelector("sound[tempo]");
  const tempo = tempoEl ? parseFloat(tempoEl.getAttribute("tempo") ?? "60") : 60;

  // ── Key signature ────────────────────────────────────────────
  const fifthsEl = firstMeasure.querySelector("key > fifths");
  const modeEl = firstMeasure.querySelector("key > mode");
  let defaultKey: TranspositionKey | undefined;
  if (fifthsEl) {
    const fifths = parseInt(fifthsEl.textContent ?? "0", 10);
    const isMinor = modeEl?.textContent?.trim() === "minor";
    const map = isMinor ? FIFTHS_MINOR : FIFTHS_MAJOR;
    defaultKey = map[fifths] ?? "C";
  }

  // Beat duration: (60 / tempo) seconds per quarter note, adjusted for beat-type
  const quarterNoteSec = 60 / tempo;
  const beatDurationSec = quarterNoteSec * (4 / beatUnit);
  const measureDurationSec = beatDurationSec * beatsPerMeasure;

  // Duration in seconds for 'divisions' ticks
  const divisionDurationSec = quarterNoteSec / divisions;

  const notes: NoteEvent[] = [];
  const measures = doc.querySelectorAll("measure");
  let measureCount = 0;
  let absoluteTimeSec = 0;

  measures.forEach((measure) => {
    const measureNum = parseInt(measure.getAttribute("number") ?? "1", 10);
    measureCount = Math.max(measureCount, measureNum);

    // Recalculate divisions if they change mid-piece
    const localDivEl = measure.querySelector("divisions");
    const localDivisions = localDivEl
      ? parseInt(localDivEl.textContent ?? String(divisions), 10)
      : divisions;
    const localDivSec = quarterNoteSec / localDivisions;

    let indexInMeasure = 0;
    let measureTimeSec = absoluteTimeSec;

    const noteEls = measure.querySelectorAll("note");
    noteEls.forEach((noteEl) => {
      const durationEl = noteEl.querySelector("duration");
      const durationTicks = durationEl
        ? parseInt(durationEl.textContent ?? "4", 10)
        : localDivisions;
      const durationSec = durationTicks * localDivSec;

      const isChord = !!noteEl.querySelector("chord");
      const isRest = !!noteEl.querySelector("rest");
      const isGrace = !!noteEl.querySelector("grace");

      if (isGrace) return; // skip grace notes for MVP

      if (isChord) {
        // Chord tones share the previous start time; for monophonic, skip extras
        return;
      }

      let midi = -1;
      if (!isRest) {
        const pitchEl = noteEl.querySelector("pitch");
        const step = pitchEl?.querySelector("step")?.textContent ?? "C";
        const octave = parseInt(pitchEl?.querySelector("octave")?.textContent ?? "4", 10);
        const alter = parseFloat(pitchEl?.querySelector("alter")?.textContent ?? "0");
        midi = stepOctaveToMidi(step, octave, alter);
      }

      notes.push({
        midi,
        startSec: measureTimeSec,
        durationSec,
        measure: measureNum,
        indexInMeasure,
        isRest,
      });

      measureTimeSec += durationSec;
      if (!isChord) indexInMeasure++;
    });

    absoluteTimeSec = measureTimeSec;
  });

  return {
    notes,
    tempo,
    beatsPerMeasure,
    beatUnit,
    measureCount,
    beatDurationSec,
    measureDurationSec,
    defaultKey,
  };
}

/** Group NoteEvents by measure number. */
export function groupByMeasure(
  notes: NoteEvent[]
): Map<number, NoteEvent[]> {
  const map = new Map<number, NoteEvent[]>();
  for (const note of notes) {
    if (!map.has(note.measure)) map.set(note.measure, []);
    map.get(note.measure)!.push(note);
  }
  return map;
}
