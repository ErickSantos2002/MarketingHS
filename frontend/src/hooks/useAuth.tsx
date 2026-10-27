import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { api, guardarToken, limparToken, lerToken, ErroApi } from '@/lib/api';

// `leitura` (frente papel-leitura, 27/10): vê as telas do admin e não altera
// nada — o backend responde 403 a toda escrita desse papel. A tela esconde
// as ações para o leitor não esbarrar no 403; a garantia é o servidor.
export type Papel = 'admin' | 'user' | 'leitura';

interface Usuario {
  id: string;
  email: string;
  papel: Papel | string;
}

interface AuthContextType {
  user: Usuario | null;
  /** Papel cru vindo de /auth/eu; null deslogado. */
  papel: string | null;
  /** Só admin. Para "pode alterar?", use `usePodeEditar()`. */
  isAdmin: boolean;
  isLeitura: boolean;
  /** Admin ou leitura: quem entra nas telas do admin. */
  podeVerAdmin: boolean;
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

  const papel = user?.papel ?? null;
  const isAdmin = papel === 'admin';
  const isLeitura = papel === 'leitura';

  return (
    <AuthContext.Provider
      value={{
        user, papel, isAdmin, isLeitura, podeVerAdmin: isAdmin || isLeitura,
        isLoading, signIn, signOut,
      }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) throw new Error('useAuth precisa estar dentro de AuthProvider');
  return ctx;
}

/**
 * Pode alterar dado? Só admin. É o helper único para esconder/desabilitar
 * botão de ação e para não disparar query de rota admin-only (`enabled:`).
 * O leitor (`leitura`) vê as telas mas não escreve — o servidor dá 403.
 */
export function usePodeEditar(): boolean {
  return useAuth().isAdmin;
}
