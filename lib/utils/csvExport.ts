import Papa from "papaparse";
import type { AdminStudentRow } from "@/types/session";

/** Generate a CSV string from admin student rows. */
export function buildAdminCsv(rows: AdminStudentRow[]): string {
  const data = rows.map((row) => ({
    Student: row.studentName,
    Melody: row.melodyTitle,
    Transposition: row.session.transposition,
    Started: row.session.started_at,
    "Mode 1 Completed": row.results[1]?.completed ?? false,
    "Mode 1 Score %": row.results[1]?.score_pct ?? "",
    "Mode 2 Completed": row.results[2]?.completed ?? false,
    "Mode 2 Score %": row.results[2]?.score_pct ?? "",
    "Mode 3 Completed": row.results[3]?.completed ?? false,
    "Mode 3 Score %": row.results[3]?.score_pct ?? "",
    "Mode 4 Completed": row.results[4]?.completed ?? false,
    "Mode 4 Score %": row.results[4]?.score_pct ?? "",
    "Has Recording": row.recording !== null,
  }));

  return Papa.unparse(data);
}

/** Trigger a browser download of a CSV string. */
export function downloadCsv(csvContent: string, filename: string): void {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
