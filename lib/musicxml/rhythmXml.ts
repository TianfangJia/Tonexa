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
  return result;
}
