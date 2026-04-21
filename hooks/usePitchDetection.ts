"use client";
import { useRef, useCallback } from "react";
import { startPitchDetection, type PitchSample } from "@/lib/audio/pitchDetection";
import type { MicrophoneHandle } from "@/lib/audio/microphone";

export function usePitchDetection() {
  const stopRef = useRef<(() => void) | null>(null);

  const start = useCallback(
    (handle: MicrophoneHandle, onPitch: (sample: PitchSample | null) => void) => {
      if (stopRef.current) stopRef.current();
      stopRef.current = startPitchDetection(
        handle.audioContext,
        handle.sourceNode,
        onPitch
      );
    },
    []
  );

  const stop = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
  }, []);

  return { start, stop };
}
