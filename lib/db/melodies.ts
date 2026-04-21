import { createBrowserClient } from "@/lib/supabase/client";
import type { MelodyRecord } from "@/types/music";

/** Fetch all available melodies (ordered by title). */
export async function fetchMelodies(): Promise<MelodyRecord[]> {
  const supabase = createBrowserClient();
  const { data, error } = await supabase
    .from("melodies")
    .select("id, title, tempo, beats_per_measure, beat_unit, default_key, created_at")
    .order("title");
  if (error) throw new Error(error.message);
  return (data ?? []) as MelodyRecord[];
}

/** Fetch a single melody including its MusicXML content. */
export async function fetchMelodyById(id: string): Promise<MelodyRecord> {
  const supabase = createBrowserClient();
  const { data, error } = await supabase
    .from("melodies")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Melody not found");
  return data as MelodyRecord;
}
