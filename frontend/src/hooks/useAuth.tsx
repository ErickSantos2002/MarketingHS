import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { api, guardarToken, limparToken, lerToken, ErroApi } from '@/lib/api';

interface Usuario {
  id: string;
  email: string;
  papel: string;
}

interface AuthContextType {
  user: Usuario | null;
  isAdmin: boolean;
  isLoading: boolean;
  signIn: (email: string, senha: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Usuario | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // O papel vem do backend, que o relê do banco a cada request. Não há mais
  // cache de papel em sessionStorage: revogar admin passa a valer na hora.
  useEffect(() => {
    if (!lerToken()) { setIsLoading(false); return; }
    api.get<Usuario>('/auth/eu')
      .then(setUser)
      .catch(() => { limparToken(); setUser(null); })
      .finally(() => setIsLoading(false));
  }, []);

  const signIn = useCallback(async (email: string, senha: string) => {
    try {
      const r = await api.post<{ token: string; usuario: Usuario }>(
        '/auth/login', { email, senha });
      guardarToken(r.token);
      setUser(r.usuario);
      return { error: null };
    } catch (e) {
      return { error: e instanceof ErroApi ? new Error(e.message) : (e as Error) };
    }
  }, []);

  const signOut = useCallback(async () => {
    limparToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, isAdmin: user?.papel === 'admin', isLoading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) throw new Error('useAuth precisa estar dentro de AuthProvider');
  return ctx;
}
