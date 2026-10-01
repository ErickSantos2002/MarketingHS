// A aba do DataCore na tela de Importar.
//
// ⚠️ O número que importa aqui é quantos têm E-MAIL, não quantos existem. Um
// botão "Importar 2.081 clientes" faz quem clica esperar 2.081 contatos
// mailáveis; chegam ~190. A tela diz isso ANTES do botão, não depois da carga.
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, Download } from 'lucide-react';
import {
  previaDatacore, sincronizarDatacore,
  type PreviaDatacore, type ResumoSincronizacao,
} from '@/lib/datacore';
import { ErroApi } from '@/lib/api';

export function DatacoreImport() {
  const [previa, setPrevia] = useState<PreviaDatacore | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [rodando, setRodando] = useState(false);
  const [resumo, setResumo] = useState<ResumoSincronizacao | null>(null);
  const [indisponivel, setIndisponivel] = useState<string | null>(null);

  const recarregar = useCallback(() => {
    setCarregando(true);
    previaDatacore()
      .then((p) => { setPrevia(p); setIndisponivel(null); })
      .catch((e) => {
        // 503 é estado esperado (DATACORE_URL não configurada), não erro de
        // uso — a tela explica em vez de mostrar um toast vermelho.
        if (e instanceof ErroApi && e.status === 503) setIndisponivel(e.message);
        else toast.error(e instanceof ErroApi ? e.message : 'Erro ao ler o DataCore');
      })
      .finally(() => setCarregando(false));
  }, []);

  useEffect(() => { recarregar(); }, [recarregar]);

  const sincronizar = async () => {
    setRodando(true);
    try {
      const r = await sincronizarDatacore();
      setResumo(r);
      toast.success(`${r.criados} criados, ${r.atualizados} atualizados`);
      recarregar();
    } catch (e) {
      toast.error(e instanceof ErroApi ? e.message : 'Erro na sincronização');
    } finally {
      setRodando(false);
    }
  };

  if (carregando) return <Skeleton className="h-40 w-full rounded-lg" />;

  if (indisponivel) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-[--tint-warning] p-3">
        <AlertTriangle className="h-4 w-4 shrink-0 text-warning mt-0.5" />
        <p className="text-xs text-[--on-tint-warning]">{indisponivel}</p>
      </div>
    );
  }

  if (!previa) return null;

  const semEmail = previa.total - previa.com_email_cadastro;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="py-4 space-y-1 text-sm">
          <p><strong>{previa.total}</strong> clientes no ERP</p>
          <p><strong>{previa.com_email_cadastro}</strong> com e-mail — só esses podem receber campanha</p>
          <p className="text-muted-foreground">{previa.ja_importados} já importados</p>
        </CardContent>
      </Card>

      <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-[--tint-warning] p-3">
        <AlertTriangle className="h-4 w-4 shrink-0 text-warning mt-0.5" />
        <p className="text-xs text-[--on-tint-warning]">
          <strong>{semEmail}</strong> dos {previa.total} clientes não têm e-mail. Eles entram
          como contato para segmentação — você passa a conseguir separar cliente de lead —,
          mas não recebem e-mail enquanto não tiverem endereço.
          {!previa.email_de_notas_ligado && (
            <>{' '}Varrendo nota fiscal e conta a receber, o alcance subiria para{' '}
              <strong>{previa.com_email_incluindo_notas}</strong>. Isso está desligado, e
              ligar é decisão de negócio: e-mail de nota fiscal foi coletado para faturar.</>
          )}
        </p>
      </div>

      <Button onClick={sincronizar} disabled={rodando} className="gap-2">
        <Download className="h-4 w-4" />
        {rodando ? 'Sincronizando...' : 'Sincronizar agora'}
      </Button>

      {resumo && (
        <Card>
          <CardContent className="py-4 text-sm space-y-1">
            <p>{resumo.criados} criados · {resumo.atualizados} atualizados</p>
            <p className="text-muted-foreground">
              {resumo.sem_email} sem e-mail · {resumo.colisoes_de_email} com e-mail já usado
              por outro contato
            </p>
            {resumo.total_de_erros > 0 && (
              <p className="text-[--on-tint-danger]">
                {resumo.total_de_erros} com erro — os primeiros: {resumo.erros.slice(0, 3).join(' · ')}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
