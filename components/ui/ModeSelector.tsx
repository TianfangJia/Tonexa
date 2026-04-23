"use client";

import type { PracticeMode } from "@/types/session";

const MODES: { id: PracticeMode; label: string; desc: string }[] = [
  { id: 0, label: "Overview", desc: "Prep & explore" },
  { id: 1, label: "Pitch",    desc: "Match each note" },
  { id: 2, label: "Rhythm",   desc: "Clap the beats" },
  { id: 3, label: "Melody",   desc: "Measure by measure" },
  { id: 4, label: "Full",     desc: "Sing it through" },
];

interface Props {
  current: PracticeMode;
  onChange: (mode: PracticeMode) => void;
  disabled?: boolean;
}

export default function ModeSelector({ current, onChange, disabled }: Props) {
  return (
    <div className="flex gap-1 rounded-xl bg-zinc-100 p-1">
      {MODES.map((m) => (
        <button
          key={m.id}
          onClick={() => onChange(m.id)}
          disabled={disabled}
          className={`flex flex-1 flex-col items-center rounded-lg px-3 py-2 text-xs font-medium transition-all ${
            current === m.id
              ? "bg-white text-zinc-900 shadow-sm"
              : "text-zinc-500 hover:text-zinc-700"
          } disabled:opacity-40`}
        >
          <span className="font-semibold">{m.label}</span>
          <span className="hidden text-zinc-400 sm:block">{m.desc}</span>
        </button>
      ))}
    </div>
  );
}
