import { createBrowserClient } from "@/lib/supabase/client";
import type { SessionRecord, StudentRecord } from "@/types/session";

/** Create a student record and return it. */
export async function createStudent(name: string): Promise<StudentRecord> {
  const supabase = createBrowserClient();
  const { data, error } = await supabase
    .from("students")
    .insert({ name })
    .select()
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to create student");
  return data as StudentRecord;
}

/** Create a new practice session. */
export async function createSession(
  studentId: string,
  melodyId: string,
  transposition: string
): Promise<SessionRecord> {
  const supabase = createBrowserClient();
  const { data, error } = await supabase
    .from("sessions")
    .insert({ student_id: studentId, melody_id: melodyId, transposition })
    .select()
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to create session");
  return data as SessionRecord;
}

/** Update transposition on an existing session. */
export async function updateSessionTransposition(
  sessionId: string,
  transposition: string
): Promise<void> {
  const supabase = createBrowserClient();
  const { error } = await supabase
    .from("sessions")
    .update({ transposition, updated_at: new Date().toISOString() })
    .eq("id", sessionId);
  if (error) throw new Error(error.message);
}
