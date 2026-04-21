import { createBrowserClient } from "@/lib/supabase/client";
import type { PracticeMode, PracticeResultRecord, RecordingRecord } from "@/types/session";

/** Upsert a practice result for a given session + mode. */
export async function upsertResult(
  sessionId: string,
  mode: PracticeMode,
  completed: boolean,
  scorePct: number | null,
  details: Record<string, unknown>
): Promise<void> {
  const supabase = createBrowserClient();
  const { error } = await supabase.from("practice_results").upsert(
    {
      session_id: sessionId,
      mode,
      completed,
      score_pct: scorePct,
      details,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "session_id,mode" }
  );
  if (error) throw new Error(error.message);
}

/** Save a recording reference after upload. */
export async function saveRecording(
  sessionId: string,
  storagePath: string,
  durationSeconds: number | null
): Promise<RecordingRecord> {
  const supabase = createBrowserClient();
  const { data, error } = await supabase
    .from("recordings")
    .insert({ session_id: sessionId, storage_path: storagePath, duration_seconds: durationSeconds })
    .select()
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to save recording");
  return data as RecordingRecord;
}
