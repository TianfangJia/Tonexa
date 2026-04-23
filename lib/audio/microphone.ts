// ── Microphone capture ─────────────────────────────────────────────────────

import * as Tone from "tone";

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
  const isIOS = typeof navigator !== "undefined" &&
    /iPad|iPhone|iPod/.test(navigator.userAgent);
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: isIOS,
    },
    video: false,
  });

  // Share Tone.js's AudioContext instead of creating a second one. iOS/iPadOS
  // Safari only allows a single active AudioContext — when Tone is running
  // for piano playback AND the mic has its own context, iOS silently
  // suspends one of them and the pitch detector stops receiving audio.
  // `Tone.start()` resumes the context from the user-gesture chain that
  // called us, so this also handles Safari's suspended-by-default state.
  await Tone.start();
  const audioContext = Tone.getContext().rawContext as unknown as AudioContext;
  if (audioContext.state === "suspended") {
    try { await audioContext.resume(); } catch { /* non-fatal */ }
  }

  const sourceNode = audioContext.createMediaStreamSource(stream);
  const analyserNode = audioContext.createAnalyser();
  analyserNode.fftSize = fftSize;
  analyserNode.smoothingTimeConstant = 0;
  sourceNode.connect(analyserNode);

  function stop() {
    sourceNode.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    // Do NOT close the audio context — it's Tone's shared context and piano
    // playback still needs it for later modes / re-takes.
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
