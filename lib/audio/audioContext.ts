// ── Shared AudioContext ───────────────────────────────────────────────────
// Single source of truth for the app's AudioContext. Two reasons this file
// exists:
//   1. iOS / iPadOS Safari only allows ONE active AudioContext per tab. Any
//      second context (e.g. one for mic, one for Tone.js) gets starved and
//      returns silent samples. Everyone reuses the same context here.
//   2. Tone.js wraps its internal context with standardized-audio-context,
//      which duck-types AudioContext but fails `instanceof BaseAudioContext`
//      — so `new AudioWorkletNode(toneCtx)` throws. By installing our own
//      native context into Tone via `Tone.setContext`, Tone keeps working
//      AND our worklet constructor gets a real BaseAudioContext.

import * as Tone from "tone";

let sharedCtx: AudioContext | null = null;
let installPromise: Promise<AudioContext> | null = null;

/**
 * Returns the shared native AudioContext, creating it + installing into Tone
 * on first call. Must be called from a user-gesture chain (the browser will
 * otherwise leave the context suspended). Subsequent calls resolve with the
 * same instance.
 */
export async function getSharedAudioContext(): Promise<AudioContext> {
  if (sharedCtx) {
    // If a prior call created the context during page mount (not a user
    // gesture), resume() may have been rejected. Every subsequent call
    // retries — cheap, idempotent, and ensures the context is actually
    // running before the caller uses it.
    if (sharedCtx.state === "suspended") {
      try { await sharedCtx.resume(); } catch { /* non-fatal */ }
    }
    return sharedCtx;
  }
  if (installPromise) return installPromise;

  installPromise = (async () => {
    const AC: typeof AudioContext =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    // Make Tone use our native context — must happen before any Tone API
    // touches audio (Sampler, playNote, countdown click, etc.), otherwise
    // Tone creates its own context and we're back to two.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Tone.setContext(ctx as any);
    // Safari opens contexts suspended; resume so downstream nodes actually
    // process audio (ScriptProcessor requires this; AudioWorklet starts
    // faster with a running context too).
    if (ctx.state === "suspended") {
      try { await ctx.resume(); } catch { /* non-fatal */ }
    }
    // Tone.start() is idempotent and ensures Tone's internal machinery is
    // initialised against the newly-installed context.
    try { await Tone.start(); } catch { /* non-fatal */ }
    sharedCtx = ctx;
    return ctx;
  })();

  return installPromise;
}
