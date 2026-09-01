import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, MailX, Check, AlertCircle } from 'lucide-react';

// Página PÚBLICA do descadastro. É o destino do link assinado que o worker põe
// em todo e-mail de campanha.
//
// ⚠️ NÃO usa `@/lib/api`. Aquele cliente anexa o JWT e, num 401, limpa a sessão
// e manda para /login — o que aqui seria absurdo: quem chega é um contato sem
// conta nenhuma, e um token de descadastro inválido o jogaria numa tela de
// login que ele não tem como usar.
const BASE = import.meta.env.VITE_API_URL ?? '/api';

type Estado =
  | { fase: 'conferindo' }
  | { fase: 'confirmar'; email: string }
  | { fase: 'saindo'; email: string }
  | { fase: 'pronto'; email: string }
  | { fase: 'erro'; mensagem: string };

export default function Descadastrar() {
  const [estado, setEstado] = useState<Estado>({ fase: 'conferindo' });
  const params = new URLSearchParams(window.location.search);
  const lid = params.get('lid') ?? '';
  const e = params.get('e') ?? '';
  const t = params.get('t') ?? '';

  // ⚠️ O GET só valida e devolve o e-mail — ele NÃO descadastra. É a RFC 8058:
  // o link do corpo do e-mail é pré-carregado por muitos clientes, e um GET com
  // efeito colateral tiraria o contato da lista sem ele ter clicado em nada.
  useEffect(() => {
    if (!lid || !e || !t) {
      setEstado({ fase: 'erro', mensagem: 'Este link está incompleto.' });
      return;
    }
    const q = new URLSearchParams({ lid, e, t }).toString();
    fetch(`${BASE}/publico/descadastro?${q}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? 'Link inválido.');
        return r.json();
      })
      .then((d) => setEstado({ fase: 'confirmar', email: d.email }))
      .catch((err) =>
        setEstado({ fase: 'erro', mensagem: err?.message || 'Este link não é válido ou expirou.' }));
  }, [lid, e, t]);

  const confirmar = useCallback(async () => {
    if (estado.fase !== 'confirmar') return;
    setEstado({ fase: 'saindo', email: estado.email });
    try {
      const r = await fetch(`${BASE}/publico/descadastro`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lid, e, t }),
      });
      if (!r.ok) throw new Error('Não foi possível concluir o descadastro.');
      setEstado({ fase: 'pronto', email: estado.email });
    } catch (err) {
      setEstado({
        fase: 'erro',
        mensagem: err instanceof Error ? err.message : 'Não foi possível concluir.',
      });
    }
  }, [estado, lid, e, t]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-xl border bg-card p-8 text-center space-y-4">
        {estado.fase === 'conferindo' && (
          <>
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Conferindo o link…</p>
          </>
        )}

        {(estado.fase === 'confirmar' || estado.fase === 'saindo') && (
          <>
            <MailX className="h-10 w-10 mx-auto text-muted-foreground" />
            <h1 className="text-lg font-semibold">Descadastrar-se</h1>
            <p className="text-sm text-muted-foreground">
              Confirme para deixar de receber nossos e-mails em{' '}
              <span className="font-medium text-foreground">{estado.email}</span>.
            </p>
            <Button
              onClick={confirmar}
              disabled={estado.fase === 'saindo'}
              className="w-full gap-2"
            >
              {estado.fase === 'saindo' && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirmar descadastro
            </Button>
          </>
        )}

        {estado.fase === 'pronto' && (
          <>
            <div className="h-10 w-10 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto">
              <Check className="h-5 w-5 text-emerald-500" />
            </div>
            <h1 className="text-lg font-semibold">Pronto</h1>
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{estado.email}</span> não
              receberá mais nossos e-mails.
            </p>
          </>
        )}

        {estado.fase === 'erro' && (
          <>
            <AlertCircle className="h-10 w-10 mx-auto text-muted-foreground" />
            <h1 className="text-lg font-semibold">Link inválido</h1>
            <p className="text-sm text-muted-foreground">{estado.mensagem}</p>
          </>
        )}
      </div>
    </div>
  );
}
