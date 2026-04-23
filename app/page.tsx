"use client";
// ── Landing / Name Entry ───────────────────────────────────────────────────

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchMelodies } from "@/lib/db/melodies";
import { createStudent, createSession } from "@/lib/db/sessions";
import type { MelodyRecord } from "@/types/music";
import MelodySelector from "@/components/ui/MelodySelector";

export default function HomePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [melodies, setMelodies] = useState<MelodyRecord[]>([]);
  const [selectedMelodyId, setSelectedMelodyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMelodies()
      .then(setMelodies)
      .catch(() => setError("Failed to load melodies"));
  }, []);

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !selectedMelodyId) return;
    setLoading(true);
    setError(null);
    try {
      // Request microphone permission up front, while we're still in the
      // click handler's user gesture. Opening the mic later (after a
      // 12-beat intro on iOS Safari) loses the gesture chain and either
      // delays the permission prompt or blocks the pipeline entirely.
      // We drop the stream immediately — the browser caches the grant, so
      // subsequent openMicrophone() calls inside practice resolve without
      // prompting again.
      try {
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
        probe.getTracks().forEach((t) => t.stop());
      } catch {
        // Permission denied or unsupported — let the student proceed anyway;
        // each mode will surface its own mic error if needed.
      }

      const student = await createStudent(name.trim());
      // Transposition defaults to "C" on the session record. The practice
      // page overrides this with the melody's own default key on load, and
      // the student picks the final key later in Overview mode.
      const session = await createSession(student.id, selectedMelodyId, "C");
      // Store in sessionStorage for the practice page
      sessionStorage.setItem("studentId", student.id);
      sessionStorage.setItem("studentName", student.name);
      sessionStorage.setItem("sessionId", session.id);
      sessionStorage.setItem("melodyId", selectedMelodyId);
      router.push("/practice");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 md:px-6 lg:px-9 xl:px-12">
      <div className="w-full max-w-sm">
        {/* Wordmark */}
        <div className="mb-10 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Tonexa</h1>
          <p className="mt-1 text-sm text-zinc-400">Singing practice with Tonexa</p>
          <p className="mt-0.5 text-[10px] font-medium tracking-wide text-zinc-400">by Tianfang</p>
        </div>

        <form onSubmit={handleStart} className="flex flex-col gap-5">
          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-500">Your name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Alice"
              autoFocus
              required
              className="rounded-xl border border-zinc-200 px-4 py-3 text-sm text-zinc-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>

          {/* Melody */}
          <MelodySelector
            melodies={melodies}
            selectedId={selectedMelodyId}
            onChange={setSelectedMelodyId}
          />

          {error && <p className="text-sm text-red-500">{error}</p>}

          {/* Headphones keep the piano playback from leaking into the mic —
              without them the pitch detector can pick up the reference tone
              instead of the student's voice and mis-grade notes. */}
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
            🎧 <strong className="font-semibold">Headphones are strongly recommended.</strong>{" "}
            They prevent the piano reference from bleeding into the microphone so your
            singing can be graded accurately.
          </p>

          <button
            type="submit"
            disabled={loading || !name.trim() || !selectedMelodyId}
            className="rounded-xl bg-zinc-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-zinc-700 active:scale-95 disabled:opacity-40"
          >
            {loading ? "Starting…" : "Start practicing"}
          </button>
        </form>

        {/* Hidden admin link */}
        <p className="mt-12 text-center text-xs text-zinc-200 hover:text-zinc-400 transition-colors">
          <a href="/admin">·</a>
        </p>
      </div>
    </main>
  );
}
