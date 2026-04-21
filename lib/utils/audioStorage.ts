import { createBrowserClient } from "@/lib/supabase/client";

const BUCKET = "recordings";

/** Upload a raw audio Blob (webm/ogg) and return its storage path. */
export async function uploadRecording(
  sessionId: string,
  audioBlob: Blob
): Promise<string> {
  const supabase = createBrowserClient();
  const ext = audioBlob.type.includes("ogg") ? "ogg" : "webm";
  const path = `${sessionId}/recording.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, audioBlob, {
    contentType: audioBlob.type,
    upsert: true,
  });

  if (error) throw new Error(`Upload failed: ${error.message}`);
  return path;
}

/** Get a signed URL for admin download (valid 60 minutes). */
export async function getRecordingSignedUrl(storagePath: string): Promise<string> {
  const supabase = createBrowserClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 3600);

  if (error || !data) throw new Error(`Signed URL failed: ${error?.message}`);
  return data.signedUrl;
}
