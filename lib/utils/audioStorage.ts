import { createBrowserClient } from "@/lib/supabase/client";

const BUCKET = "recordings";

/** Upload a raw audio Blob (webm/ogg/mp4/mpeg) and return its storage path. */
export async function uploadRecording(
  sessionId: string,
  audioBlob: Blob
): Promise<string> {
  const supabase = createBrowserClient();
  const t = audioBlob.type;
  // Match the MIME type the recorder actually produced. Safari hands back
  // audio/mp4 or audio/mpeg; Chrome/Firefox give audio/webm or audio/ogg.
  const ext =
    t.includes("mp4")  ? "m4a" :
    t.includes("mpeg") ? "mp3" :
    t.includes("ogg")  ? "ogg" :
                         "webm";
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
