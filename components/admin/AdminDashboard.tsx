"use client";
import React, { useCallback, useEffect, useState } from "react";
import type { AdminStudentRow } from "@/types/session";
import StudentTable from "./StudentTable";
import MelodyUploader from "./MelodyUploader";
import { buildAdminCsv, downloadCsv } from "@/lib/utils/csvExport";

export default function AdminDashboard() {
  const [rows, setRows] = useState<AdminStudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"students" | "upload">("students");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sessions", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(`Failed to fetch sessions (${res.status}): ${data.error ?? res.statusText}`);
      }
      setRows(data.rows ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error loading data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleExportCsv = () => {
    const csv = buildAdminCsv(rows);
    downloadCsv(csv, `ear-training-results-${Date.now()}.csv`);
  };

  return (
    <div className="flex flex-col gap-8">
      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl bg-zinc-100 p-1 w-fit">
        {(["students", "upload"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${
              tab === t ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
            }`}
          >
            {t === "students" ? "Students" : "Upload Melody"}
          </button>
        ))}
      </div>

      {tab === "students" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-700">
              {rows.length} student session{rows.length !== 1 ? "s" : ""}
            </h2>
            <div className="flex gap-2">
              <button
                onClick={handleExportCsv}
                className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Export CSV
              </button>
              <button
                onClick={fetchData}
                className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Refresh
              </button>
            </div>
          </div>

          {loading && <p className="text-sm text-zinc-400">Loading…</p>}
          {error && <p className="text-sm text-red-500">{error}</p>}
          {!loading && <StudentTable rows={rows} />}
        </div>
      )}

      {tab === "upload" && (
        <div className="max-w-md rounded-2xl border border-zinc-200 bg-white p-6">
          <MelodyUploader onUploaded={() => setTab("students")} />
        </div>
      )}
    </div>
  );
}
