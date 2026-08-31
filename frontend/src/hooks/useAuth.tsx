import { useState, useEffect, useRef, useCallback, createContext, useContext, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isAdmin: boolean;
  isLoading: boolean;
  isRoleLoading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: Error | null }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const ROLE_CACHE_PREFIX = 'dnia-admin-role:';
const ROLE_TIMEOUT_MS = 3000;

function readCachedRole(userId: string): boolean | null {
  try {
    const raw = sessionStorage.getItem(ROLE_CACHE_PREFIX + userId);
    if (raw === '1') return true;
    if (raw === '0') return false;
    return null;
  } catch {
    return null;
  }
}

function writeCachedRole(userId: string, isAdmin: boolean) {
  try {
    sessionStorage.setItem(ROLE_CACHE_PREFIX + userId, isAdmin ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRoleLoading, setIsRoleLoading] = useState(false);
  // Avoids duplicate role queries triggered by getSession + INITIAL_SESSION
  const roleCheckedFor = useRef<string | null>(null);

  const checkAdminRole = useCallback(async (userId: string, force = false) => {
    if (!force && roleCheckedFor.current === userId) return;
    roleCheckedFor.current = userId;

    // Optimistic: serve cached role instantly, revalidate in background
    const cached = readCachedRole(userId);
    if (cached !== null) {
      setIsAdmin(cached);
      setIsRoleLoading(false);
    } else {
      setIsRoleLoading(true);
    }

    try {
      const query = supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .eq('role', 'admin')
        .maybeSingle();

      const result = await Promise.race([
        query,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), ROLE_TIMEOUT_MS)),
      ]);

      if (result === null) {
        // Timed out: keep whatever we have (cached or unprivileged) and stop blocking UI
        console.warn('Role check timed out, proceeding without privilege upgrade');
        return;
      }

      if (result.error) {
        console.error('Error checking admin role:', result.error);
        if (cached === null) setIsAdmin(false);
        return;
      }

      const admin = !!result.data;
      setIsAdmin(admin);
      writeCachedRole(userId, admin);
    } catch (error) {
      console.error('Error checking admin role:', error);
      if (cached === null) setIsAdmin(false);
    } finally {
      setIsRoleLoading(false);
    }
  }, []);

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        setIsLoading(false);

        if (session?.user) {
          const userId = session.user.id;
          const cached = readCachedRole(userId);
          if (cached !== null) setIsAdmin(cached);
          // Defer role check with setTimeout to avoid deadlock
          setTimeout(() => {
            checkAdminRole(userId, event === 'SIGNED_IN');
          }, 0);
        } else {
          roleCheckedFor.current = null;
          setIsAdmin(false);
          setIsRoleLoading(false);
        }
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setIsLoading(false);

      if (session?.user) {
        checkAdminRole(session.user.id);
      }
    });

    return () => subscription.unsubscribe();
  }, [checkAdminRole]);


  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  };

  const signUp = async (email: string, password: string) => {
    const redirectUrl = `${window.location.origin}/`;
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: redirectUrl }
    });
    return { error: error as Error | null };
  };

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    const userId = user?.id;
    await supabase.auth.signOut();
    if (userId) {
      try { sessionStorage.removeItem(ROLE_CACHE_PREFIX + userId); } catch { /* ignore */ }
    }
    roleCheckedFor.current = null;
    setUser(null);
    setSession(null);
    setIsAdmin(false);
  };

  return (
    <AuthContext.Provider value={{ user, session, isAdmin, isLoading, isRoleLoading, signIn, signUp, signOut, resetPassword }}>

      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
