export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

/** GET /api/melodies – list all melodies (no content, for dropdown). */
export async function GET() {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("melodies")
    .select("id, title, tempo, beats_per_measure, beat_unit, default_key, created_at")
    .order("title");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ melodies: data });
}

/** POST /api/melodies – admin upload a new melody. */
export async function POST(req: NextRequest) {
  // Simple password gate for MVP
  const adminPassword = process.env.ADMIN_PASSWORD;
  const authHeader = req.headers.get("x-admin-password");
  if (adminPassword && authHeader !== adminPassword) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { title, musicxml_content, tempo, beats_per_measure, beat_unit, default_key } = body;

  if (!title || !musicxml_content) {
    return NextResponse.json({ error: "title and musicxml_content are required" }, { status: 400 });
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("melodies")
    .insert({
      title,
      musicxml_content,
      tempo: tempo ?? 120,
      beats_per_measure: beats_per_measure ?? 4,
      beat_unit: beat_unit ?? 4,
      default_key: default_key ?? "C",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ melody: data }, { status: 201 });
}
