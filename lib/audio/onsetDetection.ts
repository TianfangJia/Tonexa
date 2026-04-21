// ── Amplitude-energy onset detection ──────────────────────────────────────
// Simple RMS energy threshold approach.
// UPGRADE PATH: Replace with spectral flux onset detection for better accuracy.

export type OnsetCallback = (timestampSec: number) => void;

/** Configuration for onset detection. Expose in admin/dev settings. */
export interface OnsetConfig {
  /** Energy threshold (0–1 RMS). Above this = active. Default: 0.05 */
  energyThreshold: number;
  /** Minimum gap between onsets in ms. Prevents double-triggering. */
  minOnsetGapMs: number;
}

export const DEFAULT_ONSET_CONFIG: OnsetConfig = {
  energyThreshold: 0.05,
  minOnsetGapMs: 80,
};

/**
 * Attach a ScriptProcessorNode that fires `onOnset` whenever an amplitude
 * spike crosses the energy threshold after a silence gap.
 *
 * Returns a cleanup function.
 */
export function startOnsetDetection(
  audioContext: AudioContext,
  sourceNode: MediaStreamAudioSourceNode,
  onOnset: OnsetCallback,
  config: OnsetConfig = DEFAULT_ONSET_CONFIG
): () => void {
  const frameSize = 512;
  let wasActive = false;
  let lastOnsetTimeSec = -Infinity;

  const processor = audioContext.createScriptProcessor(frameSize, 1, 1);

  processor.onaudioprocess = (event) => {
    const data = event.inputBuffer.getChannelData(0);
    // RMS energy
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);

    const isActive = rms > config.energyThreshold;
    const currentTimeSec = audioContext.currentTime;
    const gapMs = (currentTimeSec - lastOnsetTimeSec) * 1000;

    if (isActive && !wasActive && gapMs > config.minOnsetGapMs) {
      lastOnsetTimeSec = currentTimeSec;
      onOnset(currentTimeSec);
    }

    wasActive = isActive;
  };

  sourceNode.connect(processor);
  processor.connect(audioContext.destination);

  return () => {
    processor.disconnect();
    sourceNode.disconnect(processor);
  };
}

/** Calculate RMS energy of a Float32Array buffer (0–1). */
export function rmsEnergy(buffer: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
  return Math.sqrt(sum / buffer.length);
}
