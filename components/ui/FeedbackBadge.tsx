"use client";
import type { NoteGrade } from "@/types/scoring";

const LABELS: Record<NoteGrade, string> = {
  green:     "Perfect",
  yellow:    "Close",
  red:       "Off",
  darkred:   "Miss",
  unmatched: "—",
};

const BG: Record<NoteGrade, string> = {
  green:     "bg-green-100 text-green-700",
  yellow:    "bg-yellow-100 text-yellow-700",
  red:       "bg-red-100 text-red-600",
  darkred:   "bg-red-950 text-red-300",
  unmatched: "bg-zinc-100 text-zinc-400",
};

interface Props {
  grade: NoteGrade;
  size?: "sm" | "lg";
}

export default function FeedbackBadge({ grade, size = "sm" }: Props) {
  return (
    <span
      className={`inline-block rounded-full font-semibold ${BG[grade]} ${
        size === "lg" ? "px-4 py-1.5 text-base" : "px-2 py-0.5 text-xs"
      }`}
    >
      {LABELS[grade]}
    </span>
  );
}
