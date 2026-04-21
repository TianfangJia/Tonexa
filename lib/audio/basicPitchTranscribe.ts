// ── Basic Pitch (Spotify) monophonic-measure transcription ────────────────
//
// Records a single measure's worth of audio into a Float32Array at the
// mic's native rate, then — on demand — resamples to Basic Pitch's
// expected 22050 Hz and runs the one-shot model to get `{ midi, startSec,
// durationSec }` events. Much cleaner than stitching a live pitch
// detector to a separate onset detector.
//
// Model files (model.json + *.bin) live in `public/models/basic-pitch/`.
// Override with NEXT_PUBLIC_BASIC_PITCH_MODEL_URL if hosting elsewhere.

import {
  BasicPitch,
  addPitchBendsToNoteEvents,
  noteFramesToTime,
  outputToNotesPoly,
  type NoteEventTime,
} from "@spotify/basic-pitch";

const MODEL_URL =
  process.env.NEXT_PUBLIC_BASIC_PITCH_MODEL_URL ??
  "/models/basic-pitch/model.json";

const BP_SR = 22050;

let instance: BasicPitch | null = null;
function getInstance(): BasicPitch {
  if (!instance) instance = new BasicPitch(MODEL_URL);
  return instance;
}

/** Kick off model download + warm-up so the first transcription doesn't stall. */
export function preloadBasicPitch(): void {
  // Touching the constructor starts the model load; nothing else to do.
  void getInstance();
}

/**
 * A live audio recorder backed by a `ScriptProcessorNode`. Appends every
 * mic buffer into a growable array of Float32 chunks; `finish()` flattens
 * the chunks into one Float32Array at the original sample rate.
 */
export interface AudioRecorder {
  readonly sampleRate: number;
  stop(): Float32Array;
}

export function startAudioRecorder(
  audioContext: AudioContext,
  sourceNode: MediaStreamAudioSourceNode,
  bufferSize: number = 2048,
): AudioRecorder {
  const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);
  const chunks: Float32Array[] = [];
  let total = 0;
  let stopped = false;

  processor.onaudioprocess = (e) => {
    if (stopped) return;
    // copyFromChannel into a fresh buffer — the event's internal buffer is
    // reused every tick, so holding a reference would corrupt earlier chunks.
    const copy = new Float32Array(bufferSize);
    e.inputBuffer.copyFromChannel(copy, 0);
    chunks.push(copy);
    total += copy.length;
  };

  sourceNode.connect(processor);
  processor.connect(audioContext.destination);

  return {
    sampleRate: audioContext.sampleRate,
    stop(): Float32Array {
      stopped = true;
      try { sourceNode.disconnect(processor); } catch {}
      try { processor.disconnect(); } catch {}
      const merged = new Float32Array(total);
      let off = 0;
      for (const c of chunks) { merged.set(c, off); off += c.length; }
      return merged;
    },
  };
}

/** Linear-interpolation resample. Good enough for a transcription model. */
function resample(input: Float32Array, srcRate: number, dstRate: number): Float32Array {
  if (srcRate === dstRate) return input;
  const ratio = srcRate / dstRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const i0 = Math.floor(srcIdx);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const t = srcIdx - i0;
    out[i] = input[i0] * (1 - t) + input[i1] * t;
  }
  return out;
}

export interface TranscribedNote {
  midi:            number;
  startSec:        number;
  durationSec:     number;
  amplitude:       number;
}

/**
 * Run Basic Pitch over a single-measure buffer and return note events.
 *
 * Defaults here are tuned for MONOPHONIC SINGING, not the polyphonic mix
 * the model ships for. They trade recall for precision — we'd rather show
 * 5 clean notes than 12 noisy ones:
 *   • onsetThreshold 0.7: vibrato wobble doesn't register as a new onset.
 *   • frameThreshold 0.5: only count frames the model is confident about.
 *   • minNoteLenMs 120:   throws out short artifacts from consonants.
 *   • minMidi / maxMidi:  clamp to vocal range so harmonics and
 *                          sub-harmonics don't materialise as octave ghosts.
 * A final monophonic pass drops overlapping notes — at any instant we keep
 * the highest-amplitude one, collapsing polyphonic output into a single
 * voice line.
 */
export async function transcribeAudio(
  audio:   Float32Array,
  srcRate: number,
  opts:    {
    onsetThreshold?: number;
    frameThreshold?: number;
    minNoteLenMs?:   number;
    minMidi?:        number;
    maxMidi?:        number;
    monophonic?:     boolean;
  } = {},
  onProgress?: (pct: number) => void,
): Promise<TranscribedNote[]> {
  const resampled = resample(audio, srcRate, BP_SR);
  const bp = getInstance();

  const onsetThresh  = opts.onsetThreshold ?? 0.7;
  const frameThresh  = opts.frameThreshold ?? 0.5;
  // Basic Pitch samples at 86.13 frames/s (22050/256). Convert ms → frames.
  const minNoteLen   = Math.max(1, Math.round((opts.minNoteLenMs ?? 120) / (1000 / 86.1328125)));
  const minMidi      = opts.minMidi ?? 48; // C3 — well below low tenor E2
  const maxMidi      = opts.maxMidi ?? 84; // C6 — covers soprano range
  const monophonic   = opts.monophonic ?? true;

  let framesAll:   number[][] = [];
  let onsetsAll:   number[][] = [];
  let contoursAll: number[][] = [];

  await bp.evaluateModel(
    resampled,
    (frames, onsets, contours) => {
      framesAll   = framesAll.concat(frames);
      onsetsAll   = onsetsAll.concat(onsets);
      contoursAll = contoursAll.concat(contours);
    },
    onProgress ?? (() => {}),
  );

  const polyNotes = outputToNotesPoly(
    framesAll, onsetsAll,
    onsetThresh, frameThresh, minNoteLen,
    false,    // inferOnsets — trust the onset track directly
    maxMidi,
    minMidi,
    true,     // melodiaTrick — joins short fragments into longer lines
  );
  const withBends: NoteEventTime[] = noteFramesToTime(
    addPitchBendsToNoteEvents(contoursAll, polyNotes),
  );

  const events: TranscribedNote[] = withBends.map((n) => ({
    midi:        n.pitchMidi,
    startSec:    n.startTimeSeconds,
    durationSec: n.durationSeconds,
    amplitude:   n.amplitude,
  }));

  if (!monophonic) return events.sort((a, b) => a.startSec - b.startSec);

  // Monophonic pass: walk notes in start-time order and drop any note whose
  // time range overlaps an already-kept note. When two notes overlap, keep
  // the higher-amplitude one (melody is usually the loudest line, and this
  // cleanly suppresses octave doublings that Basic Pitch occasionally emits).
  const sorted = events.slice().sort((a, b) => a.startSec - b.startSec);
  const kept: TranscribedNote[] = [];
  for (const n of sorted) {
    const nEnd = n.startSec + n.durationSec;
    let clash  = -1;
    for (let i = kept.length - 1; i >= 0; i--) {
      const k    = kept[i];
      const kEnd = k.startSec + k.durationSec;
      if (kEnd <= n.startSec) break; // no earlier note can overlap
      if (k.startSec < nEnd && kEnd > n.startSec) { clash = i; break; }
    }
    if (clash === -1) { kept.push(n); continue; }
    const winner = n.amplitude > kept[clash].amplitude ? n : kept[clash];
    kept[clash] = winner;
  }
  return kept;
}
