"use client";
// ── Admin Page ─────────────────────────────────────────────────────────────
// Protected by a simple client-side password gate.
// For production, replace with Supabase auth or server-side session.

import React, { useState } from "react";
import dynamic from "next/dynamic";

const AdminDashboard = dynamic(() => import("@/components/admin/AdminDashboard"), {
  ssr: false,
  loading: () => <p className="text-sm text-zinc-400">Loading…</p>,
});

export default function AdminPage() {
  const expectedPassword = process.env.NEXT_PUBLIC_ADMIN_PASSWORD ?? "admin";
  const [input, setInput] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [error, setError] = useState(false);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (input === expectedPassword) {
      setAuthenticated(true);
    } else {
      setError(true);
      setTimeout(() => setError(false), 2000);
    }
  };

  if (!authenticated) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-4 md:px-6 lg:px-9 xl:px-12">
        <div className="w-full max-w-xs">
          <h1 className="mb-6 text-xl font-bold text-zinc-800">Admin</h1>
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <input
              type="password"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Password"
              autoFocus
              className="rounded-xl border border-zinc-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            {error && <p className="text-sm text-red-500">Incorrect password.</p>}
            <button
              type="submit"
              className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-700"
            >
              Enter
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-6 py-8 md:px-6 lg:px-9 xl:px-12">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-zinc-900">Admin Dashboard</h1>
            <p className="text-sm text-zinc-400">Ear Training App</p>
          </div>
          <button
            onClick={() => setAuthenticated(false)}
            className="text-xs text-zinc-400 hover:text-zinc-600"
          >
            Sign out
          </button>
        </div>
        <AdminDashboard />
      </div>
    </main>
  );
}
