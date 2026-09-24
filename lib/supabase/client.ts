import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/types";

/**
 * Browser-side Supabase client (Client Components, event handlers, realtime).
 *
 * Memoised on purpose: Client Components re-render often and each
 * `createBrowserClient` call would open its own auth/realtime connection.
 */
let browserClient: SupabaseClient<Database> | undefined;

export function createClient(): SupabaseClient<Database> {
  if (browserClient) return browserClient;

  const { url, key } = requireSupabaseEnv();
  browserClient = createBrowserClient<Database>(url, key);
  return browserClient;
}

export type { Database };
