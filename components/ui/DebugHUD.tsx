"use client";
// ── Debug HUD ─────────────────────────────────────────────────────────────
// Floating bottom-right pill that shows live audio-pipeline state. Written
// to help diagnose the "no pitch line on iPad" bug where Web Inspector
// access is limited — every relevant state transition is pushed into the
// ring buffer here so the user can read it straight from the device screen.
//
// Safe to leave enabled in production. To turn it off, simply remove the
// <DebugHUD/> render in PracticePage. The component auto-hides when no
// entries have been logged.

import React, { useEffect, useState } from "react";

export type DebugEntry = { at: number; msg: string };

// Module-level ring buffer. Any file can call `debugLog("…")` and the HUD
// polls it. Keeping state outside React avoids re-renders in hot paths.
const BUFFER: DebugEntry[] = [];
const MAX = 40;
const listeners = new Set<() => void>();

export function debugLog(msg: string): void {
  BUFFER.push({ at: Date.now(), msg });
  if (BUFFER.length > MAX) BUFFER.shift();
  listeners.forEach((l) => l());
  // Also mirror to console for anyone who does have dev tools.
  // eslint-disable-next-line no-console
  console.log("[debugLog]", msg);
}

export default function DebugHUD() {
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const onChange = () => setTick((t) => t + 1);
    listeners.add(onChange);
    return () => { listeners.delete(onChange); };
  }, []);

  if (BUFFER.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        right: 8,
        bottom: 8,
        zIndex: 9999,
        maxWidth: 360,
        maxHeight: open ? 240 : 32,
        overflowY: "auto",
        background: "rgba(0,0,0,0.82)",
        color: "#e5e7eb",
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: 11,
        lineHeight: 1.35,
        padding: "6px 8px",
        borderRadius: 8,
        border: "1px solid #374151",
        pointerEvents: "auto",
      }}
    >
      <div
        onClick={() => setOpen((v) => !v)}
        style={{ display: "flex", justifyContent: "space-between", cursor: "pointer", marginBottom: 4, color: "#9ca3af" }}
      >
        <span>debug ({BUFFER.length})</span>
        <span>{open ? "▾" : "▸"}</span>
      </div>
      {open && BUFFER.slice().reverse().map((e, i) => (
        <div key={`${e.at}-${i}`} style={{ whiteSpace: "pre-wrap" }}>
          {new Date(e.at).toLocaleTimeString()} {e.msg}
        </div>
      ))}
      {/* tick kept in deps so React re-renders when listeners fire */}
      <span style={{ display: "none" }}>{tick}</span>
    </div>
  );
}
