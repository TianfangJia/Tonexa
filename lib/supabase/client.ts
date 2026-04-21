import { createBrowserClient as _createBrowserClient } from "@supabase/ssr";

/** Supabase browser client – use in Client Components and hooks. */
export function createBrowserClient() {
  return _createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
