import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Loader2 } from 'lucide-react';
import { destinoDoLogin } from '@/lib/destino';

interface ProtectedRouteProps {
  children: ReactNode;
  requireAdmin?: boolean;
}

export function ProtectedRoute({ children, requireAdmin = true }: ProtectedRouteProps) {
  const { user, isAdmin, isLoading } = useAuth();
  const local = useLocation();

  // O papel chega junto com o usuário em /auth/eu, então não há mais um
  // segundo carregamento só para descobri-lo.
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Verificando autenticação...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    // A6: o destino (caminho + query) vai no `state`, e o login volta a ele
    // — o link `/contacts?contato=<id>` do aviso abre a ficha depois de entrar.
    return <Navigate to="/login" replace state={{ de: destinoDoLogin(local) }} />;
  }

  if (requireAdmin && !isAdmin) {

    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-[--on-tint-danger] mb-2">Acesso Negado</h1>
          <p className="text-muted-foreground">Você não tem permissão para acessar esta página.</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
