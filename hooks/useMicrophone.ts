"use client";
import { useState, useCallback, useRef } from "react";
import { openMicrophone, type MicrophoneHandle } from "@/lib/audio/microphone";

export type MicState = "idle" | "requesting" | "active" | "error";

export function useMicrophone() {
  const [state, setState] = useState<MicState>("idle");
  const [error, setError] = useState<string | null>(null);
  const handleRef = useRef<MicrophoneHandle | null>(null);

  const start = useCallback(async (): Promise<MicrophoneHandle | null> => {
    setState("requesting");
    setError(null);
    try {
      const handle = await openMicrophone();
      handleRef.current = handle;
      setState("active");
      return handle;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Microphone unavailable";
      setError(msg);
      setState("error");
      return null;
    }
  }, []);

  const stop = useCallback(() => {
    handleRef.current?.stop();
    handleRef.current = null;
    setState("idle");
  }, []);

  return { state, error, start, stop, handle: handleRef };
}
