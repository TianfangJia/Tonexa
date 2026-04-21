"use client";
import type { MelodyRecord } from "@/types/music";

interface Props {
  melodies: MelodyRecord[];
  selectedId: string | null;
  onChange: (id: string) => void;
  disabled?: boolean;
}

export default function MelodySelector({ melodies, selectedId, onChange, disabled }: Props) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-zinc-500">Melody</label>
      <select
        value={selectedId ?? ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-40"
      >
        <option value="" disabled>
          Choose a melody…
        </option>
        {melodies.map((m) => (
          <option key={m.id} value={m.id}>
            {m.title}
          </option>
        ))}
      </select>
    </div>
  );
}
