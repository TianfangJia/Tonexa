// ── Real-time pitch detection via pitchy (McLeod Pitch Method) ────────────
//
// Preferred path: AudioWorkletNode (modern, reliable on iOS Safari). The
// worklet captures 128-sample blocks off the main thread and forwards them
// here, where pitchy runs on the buffered frame. Falls back to the deprecated
// ScriptProcessorNode if the worklet module fails to load — e.g. very old
// browsers or a dev server without the /pitch-worklet.js asset served.

import { PitchDetector } from "pitchy";
import { PITCH_CLARITY_THRESHOLD } from "@/types/scoring";

export interface PitchSample {
  frequencyHz: number;
  clarity: number;
  timestampSec: number;
}

export type PitchCallback = (sample: PitchSample | null) => void;

// Higher alpha = less smoothing = snappier response, more vibrato wobble.
// 0.25 (old value) gave a ~4-frame tau (~170 ms lag) which made the pitch
// line feel laggy. 0.75 cuts that to ~1-frame tau (~40 ms) with jitter
// that is still within our grading tolerance (±1 semitone).
const SMOOTH_ALPHA = 0.75;

// AudioWorklet is a one-time registration per audio context — remember which
// contexts we've already registered the module for so repeated mic sessions
// don't try to re-add it (which throws).
const workletRegistered = new WeakSet<AudioContext>();

/**
 * Capture audio and run pitch detection. Returns a synchronous cleanup
 * function. Worklet setup happens asynchronously; if stop() is called before
 * it completes, setup is skipped.
 */
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
  let bufferFill = 0;

  const MIN_RMS = 0.005; // reject background noise and piano echo through speakers

  const processFrame = () => {
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

  let stopped = false;
  let cleanup: () => void = () => {};

  (async () => {
    try {
      if (!audioContext.audioWorklet) throw new Error("AudioWorklet unsupported");
      if (!workletRegistered.has(audioContext)) {
        await audioContext.audioWorklet.addModule("/pitch-worklet.js");
        workletRegistered.add(audioContext);
      }
      if (stopped) return;

      const node = new AudioWorkletNode(audioContext, "pitch-worklet");
      node.port.onmessage = (ev: MessageEvent<Float32Array>) => {
        const chunk = ev.data;
        let off = 0;
        while (off < chunk.length) {
          const n = Math.min(chunk.length - off, bufferSize - bufferFill);
          inputBuffer.set(chunk.subarray(off, off + n), bufferFill);
          bufferFill += n;
          off += n;
          if (bufferFill === bufferSize) {
            processFrame();
            bufferFill = 0;
          }
        }
      };

      sourceNode.connect(node);
      // Connecting to destination isn't strictly required for AudioWorklet
      // to run (unlike ScriptProcessor), but it keeps the audio graph "live"
      // on iOS and avoids the graph being GC'd mid-session.
      node.connect(audioContext.destination);

      cleanup = () => {
        try { sourceNode.disconnect(node); } catch {}
        try { node.disconnect(); } catch {}
        node.port.onmessage = null;
      };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[pitchDetection] AudioWorklet init failed, falling back:", err);
      if (stopped) return;

      const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);
      processor.onaudioprocess = (event) => {
        event.inputBuffer.copyFromChannel(inputBuffer, 0);
        processFrame();
      };
      sourceNode.connect(processor);
      processor.connect(audioContext.destination); // required for ScriptProcessor to fire
      cleanup = () => {
        try { processor.disconnect(); } catch {}
        try { sourceNode.disconnect(processor); } catch {}
      };
    }
  })();

  return () => {
    stopped = true;
    cleanup();
  };
}
