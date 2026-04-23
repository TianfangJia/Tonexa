import { createClient } from "@supabase/supabase-js";

/**
 * Supabase server client with service-role key.
 * Use only in API routes / Server Components – never expose to the browser.
 *
 * The `global.fetch` override is important: Next.js 14 wraps every server-side
 * `fetch()` and caches the response by default — including the ones supabase-js
 * makes internally. That caused the admin `/api/sessions` endpoint to keep
 * returning a stale session list even after new rows were inserted. Passing
 * `cache: "no-store"` opts every Supabase query out of Next's data cache.
 */
export function createServerClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false },
      global: {
        fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
      },
    },
  );
}
