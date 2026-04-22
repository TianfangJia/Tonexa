// ── Real-time pitch detection via pitchy (McLeod Pitch Method) ────────────
//
// UPGRADE PATH: Replace ScriptProcessorNode with AudioWorkletProcessor
// for lower latency and off-main-thread processing.

import { PitchDetector } from "pitchy";
import { PITCH_CLARITY_THRESHOLD } from "@/types/scoring";

export interface PitchSample {
  frequencyHz: number;
  clarity: number;
  timestampSec: number;
}

export type PitchCallback = (sample: PitchSample | null) => void;

/**
 * Attach a ScriptProcessorNode to the audio context that runs pitch detection
 * on every audio frame.
 *
 * Returns a cleanup function that disconnects the processor.
 */
// Higher alpha = less smoothing = snappier response, more vibrato wobble.
// 0.25 (old value) gave a ~4-frame tau (~170 ms lag) which made the pitch
// line feel laggy. 0.75 cuts that to ~1-frame tau (~40 ms) with jitter
// that is still within our grading tolerance (±1 semitone).
const SMOOTH_ALPHA = 0.75;

export function startPitchDetection(
  audioContext: AudioContext,
  sourceNode: MediaStreamAudioSourceNode,
  onPitch: PitchCallback,
  // 1024 samples ≈ 21 ms frame at 48 kHz — half the latency of 2048 with
  // no meaningful pitch-accuracy loss for vocal range (≥ 2 periods of
  // 100 Hz fit in a 1024-sample buffer).
  bufferSize: number = 1024
): () => void {
  const detector = PitchDetector.forFloat32Array(bufferSize);
  const inputBuffer = new Float32Array(bufferSize);
  let smoothedHz = 0;

  const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);

  const MIN_RMS = 0.005; // reject background noise and piano echo through speakers

  processor.onaudioprocess = (event) => {
    event.inputBuffer.copyFromChannel(inputBuffer, 0);

    // Amplitude gate — must have sufficient signal before pitch detection
    let sumSq = 0;
    for (let i = 0; i < bufferSize; i++) sumSq += inputBuffer[i] * inputBuffer[i];
    const rms = Math.sqrt(sumSq / bufferSize);

    if (rms < MIN_RMS) {
      smoothedHz = 0;
      onPitch(null);
      return;
    }

    const [pitch, clarity] = detector.findPitch(inputBuffer, audioContext.sampleRate);

    if (clarity >= PITCH_CLARITY_THRESHOLD && pitch > 0) {
      smoothedHz = smoothedHz > 0
        ? SMOOTH_ALPHA * pitch + (1 - SMOOTH_ALPHA) * smoothedHz
        : pitch;
      onPitch({ frequencyHz: smoothedHz, clarity, timestampSec: audioContext.currentTime });
    } else {
      smoothedHz = 0;
      onPitch(null);
    }
  };

  sourceNode.connect(processor);
  processor.connect(audioContext.destination); // required for ScriptProcessor to fire

  return () => {
    processor.disconnect();
    sourceNode.disconnect(processor);
  };
}
