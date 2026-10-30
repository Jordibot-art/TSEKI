import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://gpqssirhcgelceoemysg.supabase.co";
const supabaseAnonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdwcXNzaXJoY2dlbGNlb2VteXNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgxOTM0NzUsImV4cCI6MjEwMzc2OTQ3NX0.No_hvc_Vm9n1KgHr63BfFyqhdMtlTHP5dSSdrWKyBrQ";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});
