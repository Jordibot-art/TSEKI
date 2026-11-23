import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "../lib/supabase";
import { checkTeacherAccountApproval } from "../lib/teacherApproval";
import type { User, Session } from "@supabase/supabase-js";

type AuthContextType = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  signIn: async () => ({ error: null }),
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function applyValidatedSession(nextSession: Session | null) {
      if (!nextSession?.user) {
        if (active) {
          setSession(null);
          setUser(null);
          setLoading(false);
        }
        return;
      }

      const userMeta = (nextSession.user.user_metadata || {}) as Record<string, unknown>;
      const approval = await checkTeacherAccountApproval(
        supabase,
        nextSession.user.id,
        userMeta
      );
      if (!active) return;

      if (!approval.allowed) {
        // If the user still needs to finish Step 2 (ID + Selfie), keep the Supabase session
        // alive for Storage upload while keeping protected dashboard routes locked (user = null).
        if (!approval.needsIdentityVerification) {
          await supabase.auth.signOut();
        }
        if (active) {
          setSession(null);
          setUser(null);
          setLoading(false);
        }
        return;
      }

      setSession(nextSession);
      setUser(nextSession.user);
      setLoading(false);
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      void applyValidatedSession(session);
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      void applyValidatedSession(session);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    const approval = await checkTeacherAccountApproval(supabase, data.user?.id);
    if (!approval.allowed) {
      await supabase.auth.signOut();
      return {
        error: approval.message || "Your teacher account is awaiting administrator approval.",
      };
    }
    return { error: null };
  }

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
  }

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
