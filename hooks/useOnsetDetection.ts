"use client";
import { useRef, useCallback } from "react";
import {
  startOnsetDetection,
  type OnsetConfig,
  DEFAULT_ONSET_CONFIG,
} from "@/lib/audio/onsetDetection";
import type { MicrophoneHandle } from "@/lib/audio/microphone";

export function useOnsetDetection() {
  const stopRef = useRef<(() => void) | null>(null);

  const start = useCallback(
    (
      handle: MicrophoneHandle,
      onOnset: (timeSec: number) => void,
      config: OnsetConfig = DEFAULT_ONSET_CONFIG
    ) => {
      if (stopRef.current) stopRef.current();
      stopRef.current = startOnsetDetection(
        handle.audioContext,
        handle.sourceNode,
        onOnset,
        config
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
