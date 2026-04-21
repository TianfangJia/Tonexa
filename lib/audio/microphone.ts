// ── Microphone capture ─────────────────────────────────────────────────────

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
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
    video: false,
  });

  const audioContext = new AudioContext();
  const sourceNode = audioContext.createMediaStreamSource(stream);
  const analyserNode = audioContext.createAnalyser();
  analyserNode.fftSize = fftSize;
  analyserNode.smoothingTimeConstant = 0;
  sourceNode.connect(analyserNode);

  function stop() {
    sourceNode.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    if (audioContext.state !== "closed") audioContext.close();
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
