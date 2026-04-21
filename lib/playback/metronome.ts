// ── Metronome using Tone.js Transport ─────────────────────────────────────

import * as Tone from "tone";

let clickSynth: Tone.MetalSynth | null = null;
let accentSynth: Tone.MetalSynth | null = null;
let metronomeLoop: Tone.Sequence | null = null;

function getClickSynths() {
  if (!clickSynth) {
    clickSynth = new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 0.1, release: 0.01 },
      harmonicity: 5.1,
      modulationIndex: 32,
      resonance: 4000,
      octaves: 1.5,
    }).toDestination();
    clickSynth.frequency.value = 400;
    clickSynth.volume.value = -12;
  }
  if (!accentSynth) {
    accentSynth = new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 0.08, release: 0.01 },
      harmonicity: 5.1,
      modulationIndex: 32,
      resonance: 4000,
      octaves: 1.5,
    }).toDestination();
    accentSynth.frequency.value = 800;
    accentSynth.volume.value = -6;
  }
  return { clickSynth, accentSynth };
}

export interface MetronomeOptions {
  tempo: number;
  beatsPerMeasure: number;
  /** Called on each beat. `audioTime` is the exact Tone.js audio-clock time of
   *  the beat — use it to schedule sample-accurate follow-on audio events. */
  onBeat?: (beatIndex: number, audioTime: number) => void;
}

/**
 * Start the metronome. Returns a stop function.
 * Accents beat 0 of each measure.
 */
export async function startMetronome(opts: MetronomeOptions): Promise<() => void> {
  await Tone.start();

  // Fully tear down any previous sequence + transport state before we
  // schedule new events. Tone.Transport preserves `position` and queued
  // callbacks across a bare `stop()`, so starting a fresh Sequence on top
  // of a stale queue can throw "start time must be strictly greater than
  // previous start time" when the new events land at times ≤ the held-
  // over queue head. Cancelling + rewinding puts us back at a clean t=0.
  if (metronomeLoop) {
    metronomeLoop.stop();
    metronomeLoop.dispose();
    metronomeLoop = null;
  }
  const transport = Tone.getTransport();
  transport.stop();
  transport.cancel();
  transport.position = 0;
  transport.bpm.value = opts.tempo;

  const { clickSynth: click, accentSynth: accent } = getClickSynths();

  let beatIndex = 0;
  const beats = Array.from({ length: opts.beatsPerMeasure }, (_, i) => i);

  metronomeLoop = new Tone.Sequence(
    (time, beat) => {
      const synth = beat === 0 ? accent : click;
      synth!.triggerAttackRelease("16n", time);
      if (opts.onBeat) {
        const bi = beatIndex;
        // Pass the beat's audio time; the UI callback fires via getDraw() on
        // the visual frame matching `time`, but consumers can use `time` as an
        // anchor for further audio-clock scheduling.
        Tone.getDraw().schedule(() => opts.onBeat!(bi, time), time);
      }
      beatIndex = (beatIndex + 1) % opts.beatsPerMeasure;
    },
    beats,
    "4n" // fires every quarter note
  ).start(0);

  transport.start();

  return () => {
    metronomeLoop?.stop();
    metronomeLoop?.dispose();
    metronomeLoop = null;
    transport.stop();
    transport.cancel();
    transport.position = 0;
    beatIndex = 0;
  };
}

/**
 * Play a single metronome click immediately (for countdown).
 * @param accent  If true, uses accent pitch.
 */
export async function playClick(accent: boolean = false): Promise<void> {
  await Tone.start();
  const { clickSynth: click, accentSynth: acc } = getClickSynths();
  (accent ? acc : click)!.triggerAttackRelease("16n", Tone.now());
}

/**
 * Play a countdown sequence (e.g. [4,3,2,1] for 4/4).
 * Returns a Promise that resolves when the countdown is complete.
 * @param beats  Countdown values, e.g. [4,3,2,1] or [3,2,1]
 * @param beatDurationSec  Duration of each beat in seconds
 * @param onBeat  Called with the countdown number on each beat
 */
export function playCountdown(
  beats: number[],
  beatDurationSec: number,
  onBeat: (count: number) => void
): Promise<void> {
  return new Promise((resolve) => {
    let i = 0;
    const fire = () => {
      if (i >= beats.length) {
        resolve();
        return;
      }
      onBeat(beats[i]);
      playClick(i === 0);
      i++;
      setTimeout(fire, beatDurationSec * 1000);
    };
    fire();
  });
}
