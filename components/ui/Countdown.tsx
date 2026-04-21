"use client";
// Full-viewport countdown overlay shown before recording begins.

interface Props {
  /** Current countdown number (null = hidden). */
  count: number | null;
}

export default function Countdown({ count }: Props) {
  if (count === null) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div
        key={count}
        className="flex h-40 w-40 items-center justify-center rounded-full bg-white shadow-2xl animate-pulse-fast"
      >
        <span className="text-7xl font-bold text-zinc-800 tabular-nums">
          {count}
        </span>
      </div>
    </div>
  );
}
