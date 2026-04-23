"use client";
import { TRANSPOSITION_KEYS, type TranspositionKey } from "@/types/music";

interface Props {
  value: TranspositionKey;
  onChange: (key: TranspositionKey) => void;
  disabled?: boolean;
}

export default function TranspositionSelector({ value, onChange, disabled }: Props) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs font-medium text-zinc-500 whitespace-nowrap">Key / Transposition</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as TranspositionKey)}
        disabled={disabled}
        className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-40"
      >
        {TRANSPOSITION_KEYS.map((k) => (
          <option key={k} value={k}>
            {k} major
          </option>
        ))}
      </select>
    </div>
  );
}
