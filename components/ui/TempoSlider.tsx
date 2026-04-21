"use client";
import React from "react";

// Fixed preset tempos. 84 is the default (middle tick); 60/72 are slower,
// 96/108 faster. The slider snaps between these — no intermediate values.
const TEMPO_OPTIONS = [60, 72, 84, 96, 108] as const;
const DEFAULT_TEMPO = 84;

interface Props {
  baseTempo: number;
  beatUnit: number;
  value: number;
  onChange: (tempo: number) => void;
}

export default function TempoSlider({ beatUnit, value, onChange }: Props) {
  const noteSymbol = beatUnit === 8 ? "♪" : "♩";

  // Snap incoming value onto the preset grid so the thumb always lines up
  // with a tick (guards against stale external values).
  const snappedIdx = (() => {
    let best = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < TEMPO_OPTIONS.length; i++) {
      const d = Math.abs(TEMPO_OPTIONS[i] - value);
      if (d < bestDiff) { best = i; bestDiff = d; }
    }
    return best;
  })();
  const snapped = TEMPO_OPTIONS[snappedIdx];

  const lastIdx  = TEMPO_OPTIONS.length - 1;
  const valuePct = (snappedIdx / lastIdx) * 100;
  const defaultIdx = TEMPO_OPTIONS.indexOf(DEFAULT_TEMPO);
  const defaultPct = (defaultIdx / lastIdx) * 100;

  const fillLeft  = Math.min(defaultPct, valuePct);
  const fillWidth = Math.abs(valuePct - defaultPct);

  return (
    <div className="flex flex-col gap-1 w-full">
      <div className="flex items-center justify-between text-xs">
        <span className="text-zinc-500">Tempo</span>
        <span className="font-semibold text-zinc-800">{noteSymbol} = {snapped}</span>
      </div>

      {/* Custom axis track */}
      <div className="relative h-6 w-full">
        {/* Full track line */}
        <div className="absolute top-1/2 inset-x-0 h-[2px] -translate-y-1/2 rounded-full bg-zinc-200" />

        {/* Filled segment: default (84) → current value */}
        <div
          className="absolute top-1/2 h-[2px] -translate-y-1/2 bg-indigo-500"
          style={{ left: `${fillLeft}%`, width: `${fillWidth}%` }}
        />

        {/* Tick marks for each preset */}
        {TEMPO_OPTIONS.map((t, i) => (
          <div
            key={t}
            className={`absolute top-1/2 w-[2px] h-3 -translate-x-1/2 -translate-y-1/2 rounded-full ${
              t === DEFAULT_TEMPO ? "bg-zinc-400" : "bg-zinc-300"
            }`}
            style={{ left: `${(i / lastIdx) * 100}%` }}
          />
        ))}

        {/* Thumb dot */}
        <div
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-500 shadow pointer-events-none"
          style={{ left: `${valuePct}%` }}
        />

        {/* Invisible range input: indexes into TEMPO_OPTIONS so the slider
            snaps to the 5 presets only. */}
        <input
          type="range"
          min={0}
          max={lastIdx}
          step={1}
          value={snappedIdx}
          onChange={(e) => onChange(TEMPO_OPTIONS[parseInt(e.target.value, 10)])}
          className="absolute inset-0 w-full h-full cursor-pointer opacity-0"
        />
      </div>

      {/* Tick labels */}
      <div className="flex justify-between text-[10px] text-zinc-400 px-0.5">
        {TEMPO_OPTIONS.map((t) => (
          <span
            key={t}
            className={
              t === snapped
                ? "font-semibold text-indigo-500"
                : t === DEFAULT_TEMPO
                ? "font-medium text-zinc-500"
                : ""
            }
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}
