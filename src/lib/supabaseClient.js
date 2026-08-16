import { createClient } from "@supabase/supabase-js";

// Both values are the public/anon pair from Supabase (Project Settings → API) — safe to
// ship to the browser, access is enforced by Row Level Security policies (see
// supabase/schema.sql), NOT by keeping this key secret. Never put the service_role key here.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Fails loudly at startup instead of silently no-op-ing every query — easier to diagnose
  // than "why is my data empty" once real screens depend on Supabase.
  console.error(
    "Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copia .env.local.example a .env.local " +
    "y completa los valores desde tu proyecto de Supabase (Project Settings → API)."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
