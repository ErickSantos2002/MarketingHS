import { Component, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { MARCA_NAO_PORTADO } from '@/integrations/supabase/client';

interface Props { children: ReactNode; area?: string }
interface State { erro: Error | null }

/**
 * Contém a explosão de uma tela ainda não portada.
 *
 * Sem isto, o toco do Supabase cumpre metade do trabalho: ele grita, mas a
 * exceção sobe até a raiz e o React desmonta a árvore inteira — a sidebar some
 * junto e o painel vira uma página em branco. Aí não dá para navegar até uma
 * tela que JÁ funciona, e o erro que era informativo vira um beco.
 *
 * Com o limite, a casca sobrevive: a tela quebrada mostra o que falta portar,
 * e o resto do admin continua navegável.
 */
export class LimiteDeErro extends Component<Props, State> {
  state: State = { erro: null };

  static getDerivedStateFromError(erro: Error): State {
    return { erro };
  }

  render() {
    const { erro } = this.state;
    if (!erro) return this.props.children;

    const naoPortado = erro.message.startsWith(MARCA_NAO_PORTADO);

    return (
      <div className="flex items-center justify-center p-8">
        <div className="max-w-lg rounded-lg border border-border/60 bg-card p-6 text-center">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-amber-500" />
          <h2 className="mb-2 text-base font-semibold">
            {naoPortado ? 'Tela ainda não portada' : 'Algo quebrou nesta tela'}
          </h2>
          <p className="text-sm text-muted-foreground">
            {naoPortado
              ? erro.message.replace(MARCA_NAO_PORTADO, '').trim()
              : erro.message}
          </p>
          {this.props.area && (
            <p className="mt-3 text-xs text-muted-foreground/70">área: {this.props.area}</p>
          )}
        </div>
      </div>
    );
  }
}
