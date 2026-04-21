export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

/** POST /api/results – upsert a practice result for a session+mode. */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { session_id, mode, completed, score_pct, details } = body;

  if (!session_id || !mode) {
    return NextResponse.json({ error: "session_id and mode are required" }, { status: 400 });
  }

  const supabase = createServerClient();
  const { error } = await supabase.from("practice_results").upsert(
    {
      session_id,
      mode,
      completed: completed ?? false,
      score_pct: score_pct ?? null,
      details: details ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "session_id,mode" }
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
