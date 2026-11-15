import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseAnonKey, supabaseUrl } from "./config";

let client: SupabaseClient | null | undefined;

/** Browser Supabase client using the public anon key, or null when not configured. */
export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  if (typeof window === "undefined") return null;
  const url = supabaseUrl();
  const key = supabaseAnonKey();
  client =
    url && key
      ? createClient(url, key, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
        })
      : null;
  return client;
}
