// ── Woodblock playback for rhythm mode ────────────────────────────────────
// Uses a self-hosted sample at /sounds/woodblock.wav.
// Falls back to a triangle-wave synth if the player isn't loaded yet.

import * as Tone from "tone";

let player: Tone.Player | null = null;
let playerReady = false;

function getPlayer(): Tone.Player {
  if (!player) {
    player = new Tone.Player({
      url: "/sounds/woodblock.wav",
      onload: () => { playerReady = true; },
    }).toDestination();
    player.volume.value = 2;
  }
  return player;
}

// Fallback synth used only before the sample loads
let fallbackSynth: Tone.Synth | null = null;
function getFallback(): Tone.Synth {
  if (!fallbackSynth) {
    fallbackSynth = new Tone.Synth({
      oscillator: { type: "triangle" },
      envelope: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.04 },
    }).toDestination();
    fallbackSynth.volume.value = -2;
  }
  return fallbackSynth;
}

function triggerHit(when: Tone.Unit.Time): void {
  if (playerReady && player) {
    player.start(when);
  } else {
    getFallback().triggerAttackRelease("G4", "32n", when);
  }
}

export async function playDrumHit(when: Tone.Unit.Time = Tone.now()): Promise<void> {
  await Tone.start();
  getPlayer(); // ensure player is initialised
  triggerHit(when);
}

export function stopDrums(): void {
  player?.stop();
  fallbackSynth?.triggerRelease();
}

export async function scheduleDrumOnsets(
  notes: Array<{ startSec: number; isRest: boolean }>,
  startOffset: number = 0
): Promise<void> {
  await Tone.start();
  getPlayer();
  for (const note of notes) {
    if (note.isRest) continue;
    triggerHit(Tone.now() + startOffset + note.startSec);
  }
}
