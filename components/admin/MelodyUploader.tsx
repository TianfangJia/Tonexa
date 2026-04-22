"use client";
import React, { useCallback, useState } from "react";

interface Props {
  onUploaded: () => void;
}

export default function MelodyUploader({ onUploaded }: Props) {
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!file || !title.trim()) return;
      setLoading(true);
      setError(null);
      setSuccess(false);

      try {
        const xmlText = await file.text();
        const res = await fetch("/api/melodies", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-admin-password": process.env.NEXT_PUBLIC_ADMIN_PASSWORD ?? "",
          },
          body: JSON.stringify({ title: title.trim(), musicxml_content: xmlText }),
        });
        if (!res.ok) {
          let msg = "Upload failed";
          try { const d = await res.json(); msg = d.error ?? msg; } catch {}
          throw new Error(msg);
        }
        setSuccess(true);
        setTitle("");
        setFile(null);
        onUploaded();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    },
    [file, title, onUploaded]
  );

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <h3 className="text-sm font-semibold text-zinc-700">Upload Melody</h3>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-zinc-500">Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Twinkle Twinkle"
          className="rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          required
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-zinc-500">MusicXML File</label>
        <input
          type="file"
          accept=".xml,.musicxml,.mxl"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm text-zinc-600"
          required
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {success && <p className="text-sm text-green-600">Melody uploaded successfully.</p>}

      <button
        type="submit"
        disabled={loading || !file || !title.trim()}
        className="self-start rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
      >
        {loading ? "Uploading…" : "Upload"}
      </button>
    </form>
  );
}
