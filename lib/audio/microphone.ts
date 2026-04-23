// ── Microphone capture ─────────────────────────────────────────────────────

import { getSharedAudioContext } from "./audioContext";
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
  // iOS quirk: disabling echoCancellation/noiseSuppression routes the mic
  // through a low-gain capture path that returns effectively silent samples.
  // Let Safari apply its defaults on iOS — non-iOS still gets the raw path
  // so our pitch detection sees unprocessed signal.
  const audioConstraints: MediaTrackConstraints = isIOS
    ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    : { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: audioConstraints,
    video: false,
  });
  const track = stream.getAudioTracks()[0];
  const settings = track?.getSettings?.() ?? {};
  debugLog(
    `mic: stream active=${stream.active} tracks=${stream.getTracks().length} ` +
    `ec=${settings.echoCancellation} ns=${settings.noiseSuppression} agc=${settings.autoGainControl}`,
  );

  // Reuse the shared native AudioContext (created via getSharedAudioContext,
  // installed into Tone on first use). One context per tab fixes iOS's
  // single-session restriction, and because it's a real native context,
  // AudioWorkletNode construction works too.
  const audioContext = await getSharedAudioContext();
  debugLog(`mic: shared ctx state=${audioContext.state} sr=${audioContext.sampleRate}`);

  const sourceNode = audioContext.createMediaStreamSource(stream);
  const analyserNode = audioContext.createAnalyser();
  analyserNode.fftSize = fftSize;
  analyserNode.smoothingTimeConstant = 0;
  sourceNode.connect(analyserNode);

  function stop() {
    sourceNode.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    // Don't close — the shared context is reused across mic sessions and by
    // Tone for piano playback.
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
