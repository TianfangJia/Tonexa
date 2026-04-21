"use client";
import { useRef, useCallback } from "react";
import { scheduleNotes } from "@/lib/playback/piano";
import { scheduleDrumOnsets } from "@/lib/playback/drums";
import { startMetronome, playCountdown } from "@/lib/playback/metronome";
import type { NoteEvent, ParsedMelody } from "@/types/music";

export function usePlayback() {
  const stopMetronomeRef = useRef<(() => void) | null>(null);

  /** Play a sequence of notes via piano sampler. */
  const playNotes = useCallback(
    async (notes: NoteEvent[], startOffsetSec: number = 0) => {
      await scheduleNotes(notes, startOffsetSec);
    },
    []
  );

  /** Play note onsets as drum hits (rhythm mode). */
  const playDrums = useCallback(
    async (notes: NoteEvent[], startOffsetSec: number = 0) => {
      await scheduleDrumOnsets(notes, startOffsetSec);
    },
    []
  );

  /** Start background metronome. Returns stop function. */
  const startClick = useCallback(
    async (
      melody: ParsedMelody,
      onBeat?: (beatIndex: number) => void
    ): Promise<() => void> => {
      const stop = await startMetronome({
        tempo: melody.tempo,
        beatsPerMeasure: melody.beatsPerMeasure,
        onBeat,
      });
      stopMetronomeRef.current = stop;
      return stop;
    },
    []
  );

  /** Play countdown for the given time signature, returns a Promise. */
  const countdown = useCallback(
    async (melody: ParsedMelody, onCount: (n: number) => void): Promise<void> => {
      const beats = Array.from(
        { length: melody.beatsPerMeasure },
        (_, i) => melody.beatsPerMeasure - i
      );
      await playCountdown(beats, melody.beatDurationSec, onCount);
    },
    []
  );

  const stopMetronome = useCallback(() => {
    stopMetronomeRef.current?.();
    stopMetronomeRef.current = null;
  }, []);

  return { playNotes, playDrums, startClick, countdown, stopMetronome };
}
