// ── Microphone capture ─────────────────────────────────────────────────────

import * as Tone from "tone";
import { debugLog } from "@/components/ui/DebugHUD";

export interface MicrophoneHandle {
  audioContext: AudioContext;
  analyserNode: AnalyserNode;
  sourceNode: MediaStreamAudioSourceNode;
  stream: MediaStream;
  stop: () => void;
}

/**
 * Request microphone access and return an audio pipeline.
 * Caller is responsible for calling handle.stop() when done.
 */
export async function openMicrophone(
  fftSize: number = 2048
): Promise<MicrophoneHandle> {
  // iOS/iPadOS mics run very quiet when all processing is disabled — the raw
  // signal often sits below the RMS gate in pitchDetection.ts and every frame
  // gets rejected as silence. Let the browser apply automatic gain control
  // on iOS so the student's voice actually crosses the threshold.
  // Modern iPadOS reports `MacIntel` for platform and omits "iPad" from the
  // UA string — using only the UA regex, a real iPad returns `isIOS=false`
  // and never gets AGC. Fallback: any touch-capable Mac platform is an iPad.
  const isIOS = typeof navigator !== "undefined" && (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && (navigator.maxTouchPoints ?? 0) > 1)
  );
  debugLog(`mic: getUserMedia (isIOS=${isIOS})`);
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: isIOS,
    },
    video: false,
  });
  debugLog(`mic: stream active=${stream.active} tracks=${stream.getTracks().length}`);

  // On iOS/iPadOS, only one AudioContext can own the audio session. When
  // Tone.js already has one (for piano playback), a second context for the
  // mic gets silently starved — createMediaStreamSource returns near-zero
  // samples. Reusing Tone's context on iOS avoids that; every other
  // platform keeps its own fresh mic context (the prior behaviour that
  // works on macOS Safari + Chrome + Firefox).
  let audioContext: AudioContext;
  if (isIOS) {
    await Tone.start();
    audioContext = Tone.getContext().rawContext as unknown as AudioContext;
    debugLog(`mic: reusing Tone ctx state=${audioContext.state} sr=${audioContext.sampleRate}`);
  } else {
    const AC: typeof AudioContext =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioContext = new AC();
    debugLog(`mic: ctx created state=${audioContext.state} sr=${audioContext.sampleRate}`);
  }
  if (audioContext.state === "suspended") {
    try {
      await audioContext.resume();
      debugLog(`mic: ctx resume() ok state=${audioContext.state}`);
    } catch (e) {
      debugLog(`mic: ctx resume FAILED ${e}`);
    }
  }

  const sourceNode = audioContext.createMediaStreamSource(stream);
  const analyserNode = audioContext.createAnalyser();
  analyserNode.fftSize = fftSize;
  analyserNode.smoothingTimeConstant = 0;
  sourceNode.connect(analyserNode);

  function stop() {
    sourceNode.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    // Only close the context if we created a fresh one. Tone's context is
    // shared with the piano sampler and closing it would kill playback.
    if (!isIOS && audioContext.state !== "closed") audioContext.close();
  }

  return { audioContext, analyserNode, sourceNode, stream, stop };
}

/**
 * Return true if the analyser currently has audio above the silence threshold.
 * Used to debounce pitch detection on silence.
 */
export function isAboveSilence(
  analyser: AnalyserNode,
  silenceThresholdDb: number = -60
): boolean {
  const data = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(data);
  let max = 0;
  for (let i = 0; i < data.length; i++) {
    const abs = Math.abs(data[i]);
    if (abs > max) max = abs;
  }
  const db = 20 * Math.log10(max + 1e-10);
  return db > silenceThresholdDb;
}
