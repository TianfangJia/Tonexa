export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

/**
 * GET /api/recordings/[id] – admin download: returns a signed URL for the recording.
 * Requires x-admin-password header.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const adminPassword = process.env.ADMIN_PASSWORD;
  const authHeader = req.headers.get("x-admin-password");
  if (adminPassword && authHeader !== adminPassword) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServerClient();
  const { data: recording, error } = await supabase
    .from("recordings")
    .select("storage_path")
    .eq("id", params.id)
    .single();

  if (error || !recording) {
    return NextResponse.json({ error: "Recording not found" }, { status: 404 });
  }

  const { data: urlData, error: urlErr } = await supabase.storage
    .from("recordings")
    .createSignedUrl(recording.storage_path, 3600);

  if (urlErr || !urlData) {
    return NextResponse.json({ error: "Failed to generate URL" }, { status: 500 });
  }

  return NextResponse.json({ url: urlData.signedUrl });
}
