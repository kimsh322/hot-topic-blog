import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder";

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  console.warn("[supabase] NEXT_PUBLIC_SUPABASE_URL is not set");
}
if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  console.warn("[supabase] NEXT_PUBLIC_SUPABASE_ANON_KEY is not set");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
