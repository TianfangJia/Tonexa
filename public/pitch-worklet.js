// AudioWorklet processor for pitch detection.
// Runs on the audio thread (128-sample blocks) and forwards each block to
// the main thread via postMessage. The main thread buffers those blocks up
// to the pitch-detector's frame size and runs Pitchy there.
//
// ScriptProcessorNode — what this replaces — is deprecated and iOS Safari
// throttles it, which made the real-time pitch line disappear on iPad even
// though the mic was active.

class PitchWorklet extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      // Clone because the underlying buffer is reused across process() calls.
      this.port.postMessage(input[0].slice());
    }
    return true;
  }
}

registerProcessor("pitch-worklet", PitchWorklet);
