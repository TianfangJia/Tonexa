// Helpers to produce single-measure MusicXML strings — used by rhythm mode
// to render the current target and the student's live transcription side by side.

/**
 * Extract a single measure from a full MusicXML document.
 * Copies <attributes> (clef/key/time) from measure 1 if the target measure
 * lacks them, so the extracted measure renders as a standalone score.
 */
export function extractMeasureXml(fullXml: string, measureNumber: number): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(fullXml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) return fullXml;

  // Strip score-level text that would push the staff down: titles, credits,
  // identification, movement info. Also clear <part-name>/<part-abbreviation>
  // so no label appears next to the staff.
  const dropTags = [
    "work", "movement-title", "movement-number", "credit", "identification",
    "defaults",
  ];
  for (const tag of dropTags) {
    Array.from(doc.getElementsByTagName(tag)).forEach((el) => {
      el.parentNode?.removeChild(el);
    });
  }
  Array.from(doc.getElementsByTagName("part-name")).forEach((el) => {
    el.textContent = "";
    el.setAttribute("print-object", "no");
  });
  Array.from(doc.getElementsByTagName("part-abbreviation")).forEach((el) => {
    el.textContent = "";
    el.setAttribute("print-object", "no");
  });

  const parts = Array.from(doc.getElementsByTagName("part"));
  for (const part of parts) {
    const measures = Array.from(part.getElementsByTagName("measure"));
    const target = measures.find(
      (m) => m.getAttribute("number") === String(measureNumber),
    );
    if (!target) continue;

    if (target !== measures[0]) {
      const m1Attrs = measures[0].getElementsByTagName("attributes")[0];
      const tgAttrs = target.getElementsByTagName("attributes")[0];
      if (m1Attrs && !tgAttrs) {
        target.insertBefore(m1Attrs.cloneNode(true), target.firstChild);
      }
    }

    // Drop <direction> children (tempo marks, dynamics) from the kept measure.
    Array.from(target.getElementsByTagName("direction")).forEach((el) => {
      el.parentNode?.removeChild(el);
    });

    for (const m of measures) {
      if (m !== target) part.removeChild(m);
    }
    target.setAttribute("number", "1");
  }

  return new XMLSerializer().serializeToString(doc);
}

// Legal note durations, in 16th-note units (divisions = 4). Largest-first so
// greedy splitting favours the longest legal note that still fits.
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

/** Number of beams (flags) a given note type carries. 0 = not beamable. */
function beamCountFor(type: string): number {
  switch (type) {
    case "eighth": return 1;
    case "16th":   return 2;
    case "32nd":   return 3;
    default:       return 0;
  }
}

/**
 * For a run of beamable notes (length ≥ 2), emit <beam> elements per note.
 * runCounts[i] = number of beams on note i. Produces MusicXML beam values:
 *   begin / continue / end for each beam level where that note participates,
 *   "forward hook" / "backward hook" for isolated higher-level beams
 *   (e.g. the 16th in a dotted-eighth + 16th pair).
 */
function buildRunBeams(runCounts: number[]): string[] {
  const out = runCounts.map(() => "");
  const maxLevel = Math.max(...runCounts);
  for (let level = 1; level <= maxLevel; level++) {
    const hasLevel = runCounts.map((c) => c >= level);
    for (let i = 0; i < runCounts.length; i++) {
      if (!hasLevel[i]) continue;
      const prev = i > 0               && hasLevel[i - 1];
      const next = i < runCounts.length - 1 && hasLevel[i + 1];
      let val: string;
      if      (prev && next)  val = "continue";
      else if (!prev && next) val = "begin";
      else if (prev && !next) val = "end";
      else                    val = i === 0 ? "forward hook" : "backward hook";
      out[i] += `<beam number="${level}">${val}</beam>`;
    }
  }
  return out;
}

function restXml(d: number, type: string, dots: number): string {
  const dotXml = "<dot/>".repeat(dots);
  return `      <note><rest/><duration>${d}</duration>` +
         `<voice>1</voice><type>${type}</type>${dotXml}</note>`;
}

/** MIDI → MusicXML <pitch>. Uses sharp spelling (C#/D#/F#/G#/A#). */
function pitchXmlForMidi(midi: number): string {
  const steps = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"];
  const alters = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const alter = alters[pc];
  const alterXml = alter !== 0 ? `<alter>${alter}</alter>` : "";
  return `<pitch><step>${steps[pc]}</step>${alterXml}<octave>${octave}</octave></pitch>`;
}

function noteXml(
  d: number, type: string, dots: number,
  tie: "none" | "start" | "stop" | "both",
  beams: string = "",
  midi: number = 71, // B4 default (rhythm mode)
): string {
  const dotXml = "<dot/>".repeat(dots);
  let tieXml = "", tiedXml = "";
  if (tie === "start" || tie === "both") {
    tieXml  += `<tie type="start"/>`;
    tiedXml += `<tied type="start"/>`;
  }
  if (tie === "stop"  || tie === "both") {
    tieXml  += `<tie type="stop"/>`;
    tiedXml += `<tied type="stop"/>`;
  }
  const notationsXml = tiedXml ? `<notations>${tiedXml}</notations>` : "";
  // B4 sits on the middle line, so Verovio's default stem-direction flips
  // between up/down across beat groups. Force stems down on B4 so rhythm-mode
  // notation reads uniform (matches extractRhythmXML's behaviour).
  const stemXml = midi === 71 ? `<stem>down</stem>` : "";
  return `      <note>` +
         pitchXmlForMidi(midi) +
         `<duration>${d}</duration>${tieXml}` +
         `<voice>1</voice><type>${type}</type>${dotXml}${stemXml}${beams}${notationsXml}` +
         `</note>`;
}

/**
 * Build a single-measure MusicXML from a list of onset slot indices
 * (0-based, on the 16th-note grid). Empty input renders as a single
 * whole-measure rest.
 *
 * @param compact  When `true` (post-recording cleanup), each onset extends
 *                 to the next one (or measure end), split into legal note
 *                 values joined with ties. When `false` (live view), each
 *                 onset renders as a single 16th note and empty slots as
 *                 16th rests — so the student sees exactly where their taps
 *                 landed on the 16th-note grid.
 */
export function onsetsToMeasureXml(
  onsetSixteenths: number[],
  beatsPerMeasure: number,
  beatUnit: number,
  tempo: number,
  compact: boolean = true,
  /** Optional MIDI per slot — when absent, notes default to B4 (rhythm use). */
  pitchBySlot?: Map<number, number>,
  /** Circle-of-fifths count for the key signature (+sharps, −flats). 0 = C. */
  fifths: number = 0,
): string {
  const sixteenthsPerBeat = 16 / beatUnit;
  const totalSixteenths   = Math.max(1, beatsPerMeasure * sixteenthsPerBeat);

  // Deduplicate, clamp to [0, totalSixteenths), and sort ascending.
  const onsets = Array.from(new Set(
    onsetSixteenths
      .filter((s) => s >= 0 && s < totalSixteenths)
      .map((s) => Math.floor(s)),
  )).sort((a, b) => a - b);

  // Unified event list (notes + rests with their start positions in 16ths).
  // Built first so we can compute beam groupings in a second pass.
  type Ev =
    | { kind: "rest"; d: number; type: string; dots: number; startPos: number }
    | { kind: "note"; d: number; type: string; dots: number; startPos: number;
        tie: "none" | "start" | "stop" | "both"; midi: number };
  const events: Ev[] = [];
  let pos = 0;

  if (onsets.length === 0) {
    // Empty → whole-measure rest, centred on the middle staff line.
    // Emitted directly (no beaming needed).
  } else if (!compact) {
    // Live mode: every slot is either a 16th note (onset) or a 16th rest.
    const onsetSet = new Set(onsets);
    for (let i = 0; i < totalSixteenths; i++) {
      if (onsetSet.has(i)) {
        events.push({ kind: "note", d: 1, type: "16th", dots: 0, startPos: pos, tie: "none",
          midi: pitchBySlot?.get(i) ?? 71 });
      } else {
        events.push({ kind: "rest", d: 1, type: "16th", dots: 0, startPos: pos });
      }
      pos += 1;
    }
  } else {
    // Compact mode: leading rest (if any), then each onset spans to the
    // next one with durations split into legal values + ties.
    if (onsets[0] > 0) {
      for (const seg of splitDuration(onsets[0])) {
        events.push({ kind: "rest", d: seg.d, type: seg.type, dots: seg.dots, startPos: pos });
        pos += seg.d;
      }
    }
    for (let i = 0; i < onsets.length; i++) {
      const start = onsets[i];
      const end   = i + 1 < onsets.length ? onsets[i + 1] : totalSixteenths;
      const len   = end - start;
      if (len <= 0) continue;
      const segs  = splitDuration(len);
      segs.forEach((seg, segIdx) => {
        const isFirst = segIdx === 0;
        const isLast  = segIdx === segs.length - 1;
        let tie: "none" | "start" | "stop" | "both" = "none";
        if (segs.length > 1) {
          if (isFirst)       tie = "start";
          else if (isLast)   tie = "stop";
          else               tie = "both";
        }
        events.push({ kind: "note", d: seg.d, type: seg.type, dots: seg.dots, startPos: pos, tie,
          midi: pitchBySlot?.get(start) ?? 71 });
        pos += seg.d;
      });
    }
  }

  // Compute per-event beam XML. A "beam run" is a sequence of ≥2 consecutive
  // beamable note events whose start-positions all fall within the same beat
  // (beats here = sixteenthsPerBeat 16ths). Rests and non-beamable notes
  // break the run; beat boundaries split it into separate runs so eighths
  // beam per-beat (standard engraving in 4/4, 3/4, 2/4).
  const beamXmlByIdx = new Map<number, string>();
  let curRun: number[] = [];
  let curBeat = -1;
  const flushRun = () => {
    if (curRun.length >= 2) {
      const counts = curRun.map((i) => beamCountFor((events[i] as { type: string }).type));
      const beams  = buildRunBeams(counts);
      curRun.forEach((i, k) => beamXmlByIdx.set(i, beams[k]));
    }
    curRun = [];
    curBeat = -1;
  };
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const beamable = e.kind === "note" && beamCountFor(e.type) > 0;
    if (!beamable) { flushRun(); continue; }
    const beat = Math.floor(e.startPos / sixteenthsPerBeat);
    if (curBeat !== -1 && beat !== curBeat) flushRun();
    if (curBeat === -1) curBeat = beat;
    curRun.push(i);
  }
  flushRun();

  // Serialize.
  const lines: string[] = [];
  if (onsets.length === 0) {
    lines.push(
      `      <note><rest measure="yes"/>` +
      `<duration>${totalSixteenths}</duration><voice>1</voice></note>`,
    );
  } else {
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.kind === "rest") {
        lines.push(restXml(e.d, e.type, e.dots));
      } else {
        lines.push(noteXml(e.d, e.type, e.dots, e.tie, beamXmlByIdx.get(i) ?? "", e.midi));
      }
    }
  }

  // NOTE: no <part-name> and no <direction><metronome/> here so the live
  // transcription staff sits at the same Y position as the target staff
  // (which has neither of those markings).
  void tempo;
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.0">
  <part-list>
    <score-part id="P1"><part-name></part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <key><fifths>${fifths}</fifths></key>
        <time><beats>${beatsPerMeasure}</beats><beat-type>${beatUnit}</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
${lines.join("\n")}
    </measure>
  </part>
</score-partwise>`;
}
