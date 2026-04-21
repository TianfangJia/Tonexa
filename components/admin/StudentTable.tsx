"use client";
import type { AdminStudentRow } from "@/types/session";
import { getRecordingSignedUrl } from "@/lib/utils/audioStorage";
import { useState } from "react";

interface Props {
  rows: AdminStudentRow[];
}

const STATUS_LABEL: Record<string, string> = {
  completed: "Done",
  in_progress: "Active",
  not_started: "—",
};

function modeStatus(row: AdminStudentRow, mode: 1 | 2 | 3 | 4): string {
  const r = row.results[mode];
  if (!r) return "not_started";
  if (r.completed) return "completed";
  return "in_progress";
}

export default function StudentTable({ rows }: Props) {
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const handleDownload = async (row: AdminStudentRow) => {
    if (!row.recording) return;
    setDownloadingId(row.session.id);
    try {
      const url = await getRecordingSignedUrl(row.recording.storage_path);
      window.open(url, "_blank");
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="overflow-x-auto rounded-2xl border border-zinc-200">
      <table className="min-w-full text-sm">
        <thead className="bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          <tr>
            <th className="px-4 py-3 text-left">Student</th>
            <th className="px-4 py-3 text-left">Melody</th>
            <th className="px-4 py-3 text-left">Key</th>
            <th className="px-4 py-3 text-center">Mode 1</th>
            <th className="px-4 py-3 text-center">Mode 2</th>
            <th className="px-4 py-3 text-center">Mode 3</th>
            <th className="px-4 py-3 text-center">Mode 4</th>
            <th className="px-4 py-3 text-left">Started</th>
            <th className="px-4 py-3 text-center">Recording</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 bg-white">
          {rows.map((row) => (
            <tr key={row.session.id} className="hover:bg-zinc-50">
              <td className="px-4 py-3 font-medium text-zinc-800">{row.studentName}</td>
              <td className="px-4 py-3 text-zinc-600">{row.melodyTitle}</td>
              <td className="px-4 py-3 text-zinc-600">{row.session.transposition}</td>
              {([1, 2, 3, 4] as const).map((mode) => {
                const status = modeStatus(row, mode);
                const score = row.results[mode]?.score_pct;
                return (
                  <td key={mode} className="px-4 py-3 text-center">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        status === "completed"
                          ? "bg-green-100 text-green-700"
                          : status === "in_progress"
                          ? "bg-yellow-100 text-yellow-700"
                          : "text-zinc-300"
                      }`}
                    >
                      {status === "completed" && score !== null && score !== undefined
                        ? `${Math.round(score)}%`
                        : STATUS_LABEL[status]}
                    </span>
                  </td>
                );
              })}
              <td className="px-4 py-3 text-xs text-zinc-400">
                {new Date(row.session.started_at).toLocaleString()}
              </td>
              <td className="px-4 py-3 text-center">
                {row.recording ? (
                  <button
                    onClick={() => handleDownload(row)}
                    disabled={downloadingId === row.session.id}
                    className="rounded-lg bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-100 disabled:opacity-50"
                  >
                    {downloadingId === row.session.id ? "…" : "Download"}
                  </button>
                ) : (
                  <span className="text-zinc-300">—</span>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={9} className="px-4 py-8 text-center text-sm text-zinc-400">
                No students yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
