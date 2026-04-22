"use client";
import React, { useMemo } from "react";

const WORDS = ["Congratulations!", "Wonderful!", "Brilliant!"] as const;
const COLORS = [
  "#f472b6", // pink
  "#fbbf24", // amber
  "#34d399", // emerald
  "#60a5fa", // blue
  "#a78bfa", // violet
];

interface Props {
  /** Called when the user clicks Restart. */
  onRestart?: () => void;
  /** Called when the user clicks Next. */
  onNext?: () => void;
  /** Extra class for the outer container (sizing, bg, etc.). */
  className?: string;
}

/**
 * Inline celebration panel — one firework burst + a random congratulatory
 * headline + Restart / Next buttons. Intended to slot into the parent's
 * layout (not an overlay). Animation plays once on mount.
 */
export default function Celebration({ onRestart, onNext, className }: Props) {
  const word = useMemo(
    () => WORDS[Math.floor(Math.random() * WORDS.length)],
    [],
  );

  // 4 overlapping fireworks at the same centre with slight offsets /
  // colours / 50-150 ms stagger — reads as a single cluster.
  const bursts = useMemo(
    () => Array.from({ length: 4 }, (_, i) => ({
      left:  `calc(50% + ${(i - 1.5) * 8}px)`,
      top:   `calc(40% + ${((i % 2 === 0) ? -1 : 1) * 4}px)`,
      color: COLORS[i % COLORS.length],
      delay: `${i * 0.08}s`,
    })),
    [],
  );

  return (
    <div className={`relative flex flex-col items-center justify-center gap-6 py-12 ${className ?? ""}`}>
      {/* Firework cluster */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {bursts.map((b, i) => (
          <span
            key={i}
            className="firework"
            style={{
              left: b.left,
              top: b.top,
              color: b.color,
              background: b.color,
              animationDelay: b.delay,
            }}
          />
        ))}
      </div>

      {/* Headline */}
      <h2 className="celebrate-headline relative z-10 bg-gradient-to-br from-fuchsia-500 via-amber-400 to-cyan-500 bg-clip-text text-4xl font-extrabold tracking-tight text-transparent md:text-5xl py-1 px-1">
        {word}
      </h2>

      {(onRestart || onNext) && (
        <div className="relative z-10 flex items-center gap-3">
          {onRestart && (
            <button
              type="button"
              onClick={onRestart}
              className="flex h-10 items-center gap-2 rounded-full border border-zinc-200 bg-white px-5 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 active:scale-95 transition-all"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M3 12a9 9 0 1 0 3-6.7" />
                <path d="M3 4v5h5" />
              </svg>
              Restart
            </button>
          )}
          {onNext && (
            <button
              type="button"
              onClick={onNext}
              className="flex h-10 items-center gap-2 rounded-full bg-indigo-600 px-5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 active:scale-95 transition-all"
            >
              Next
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M5 12h14" />
                <path d="M13 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
