"use client";
import { useState, useCallback } from "react";
import { createStudent, createSession, updateSessionTransposition } from "@/lib/db/sessions";
import type { SessionRecord, StudentRecord } from "@/types/session";

export function useSession() {
  const [student, setStudent] = useState<StudentRecord | null>(null);
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initSession = useCallback(
    async (name: string, melodyId: string, transposition: string) => {
      setLoading(true);
      setError(null);
      try {
        const s = await createStudent(name);
        const sess = await createSession(s.id, melodyId, transposition);
        setStudent(s);
        setSession(sess);
        return sess;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to start session";
        setError(msg);
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const changeTransposition = useCallback(
    async (newKey: string) => {
      if (!session) return;
      await updateSessionTransposition(session.id, newKey);
      setSession((prev) => prev ? { ...prev, transposition: newKey } : prev);
    },
    [session]
  );

  return { student, session, loading, error, initSession, changeTransposition };
}
