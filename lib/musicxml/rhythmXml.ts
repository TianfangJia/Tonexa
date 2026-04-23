/**
 * Strip pitch information from MusicXML, placing all notes on B4.
 * This preserves rhythm (durations, ties, dots, rests) while producing a
 * clean single-line display suitable for rhythm practice.
 */
export function extractRhythmXML(xmlText: string): string {
  // Replace every <pitch> element with B4
  let result = xmlText.replace(
    /<pitch>[\s\S]*?<\/pitch>/g,
    "<pitch><step>B</step><octave>4</octave></pitch>"
  );
  // Force C major key signature (no accidentals)
  result = result.replace(/(<fifths>)([-\d]+)(<\/fifths>)/g, "$10$3");
  // Remove any transposing-instrument elements
  result = result.replace(/<transpose>[\s\S]*?<\/transpose>/g, "");
  // Strip explicit accidental display elements (pitch is now B natural)
  result = result.replace(/<accidental[^>]*>[\s\S]*?<\/accidental>/g, "");
  // B4 sits on the middle line — Verovio's default stem-direction heuristic
  // flips between up and down across beat groups, which looks inconsistent.
  // Force every pitched note's stem down so the notation reads uniform.
  // Strip any existing <stem> first, then append a fresh one per note.
  result = result.replace(/<stem[^>]*>[\s\S]*?<\/stem>/g, "");
  result = result.replace(/<note>([\s\S]*?)<\/note>/g, (_, inner: string) => {
    if (inner.includes("<rest")) return `<note>${inner}</note>`;
    return `<note>${inner}<stem>down</stem></note>`;
  });
  return result;
}
