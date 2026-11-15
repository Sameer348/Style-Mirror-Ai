/*
 * StyleMirror AI runtime settings (static hosting).
 * Edit these values on the server; no rebuild needed. Only PUBLIC values belong here.
 * NEVER put the Supabase service-role key or any AI provider key in this file.
 *
 * apiUrl:          URL of the StyleMirror FastAPI backend (needed for AI clothes try-on and history),
 *                  e.g. "https://api.your-domain.com". Leave empty if you have not deployed it yet.
 * supabaseUrl:     your Supabase project URL (optional: enables sign-in)
 * supabaseAnonKey: your Supabase anon/public key (optional)
 */
window.STYLEMIRROR_CONFIG = {
  apiUrl: "",
  supabaseUrl: "",
  supabaseAnonKey: "",
};
