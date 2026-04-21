export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import type { AdminStudentRow, PracticeMode } from "@/types/session";

/**
 * GET /api/sessions – admin view: all sessions with student info,
 * melody info, per-mode results, and recording references.
 */
export async function GET() {
  const supabase = createServerClient();

  const { data: sessions, error: sessErr } = await supabase
    .from("sessions")
    .select("*, students(id, name, created_at)")
    .order("started_at", { ascending: false });

  if (sessErr) return NextResponse.json({ error: sessErr.message }, { status: 500 });

  const sessionIds = (sessions ?? []).map((s: { id: string }) => s.id);
  const melodyIdsSet = new Set((sessions ?? []).map((s: { melody_id: string }) => s.melody_id));
  const melodyIds = Array.from(melodyIdsSet);

  const [melodiesRes, resultsRes, recordingsRes] = await Promise.all([
    supabase.from("melodies").select("id, title").in("id", melodyIds),
    supabase.from("practice_results").select("*").in("session_id", sessionIds),
    supabase.from("recordings").select("*").in("session_id", sessionIds),
  ]);

  const melodyMap: Record<string, string> = Object.fromEntries(
    (melodiesRes.data ?? []).map((m: { id: string; title: string }) => [m.id, m.title])
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resultsMap: Record<string, Record<PracticeMode, any>> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of (resultsRes.data ?? []) as any[]) {
    if (!resultsMap[r.session_id]) resultsMap[r.session_id] = {} as never;
    resultsMap[r.session_id][r.mode as PracticeMode] = r;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recordingMap: Record<string, any> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const rec of (recordingsRes.data ?? []) as any[]) {
    recordingMap[rec.session_id] = rec;
  }

  const rows: AdminStudentRow[] = (sessions ?? []).map((s) => ({
    session: s,
    studentName: (s.students as { name: string } | null)?.name ?? "Unknown",
    melodyTitle: melodyMap[s.melody_id] ?? "Unknown",
    results: resultsMap[s.id] ?? {},
    recording: recordingMap[s.id] ?? null,
  }));

  return NextResponse.json({ rows });
}
