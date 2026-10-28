import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { AlertTriangle, ArrowDown, ArrowUp, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { api, ErroApi } from '@/lib/api';
import { toast } from 'sonner';

// Roleta de reunião do agendamento pela landing (frente agendamento, 28/10).
// Uma fila por ambiente do GrowthHS — os ids de vendedor são outros em cada
// um. Nome e e-mail vêm do GrowthHS; ninguém cadastra vendedor aqui.
// Tipos locais de propósito: `src/lib/api*` tem dono único (docs/frentes/README.md).
type Ambiente = 'homologacao' | 'producao';
const AMBIENTES: Ambiente[] = ['homologacao', 'producao'];
const NOME: Record<Ambiente, string> = { homologacao: 'Homologação', producao: 'Produção' };

type Vendedor = { id: number; nome: string; email: string };
type NaFila = { user_id: number; nome: string | null; email: string | null; posicao: number };
type EstadoRoleta = { fila: NaFila[]; vendedores: Vendedor[]; aviso?: string };

function FilaDoAmbiente({ ambiente }: { ambiente: Ambiente }) {
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [aviso, setAviso] = useState<string | undefined>();
  const [fila, setFila] = useState<Vendedor[]>([]);
  const [alterada, setAlterada] = useState(false);
  const [escolhido, setEscolhido] = useState<string>('');

  const aplicar = (e: EstadoRoleta) => {
    setVendedores(e.vendedores);
    setAviso(e.aviso);
    setFila(e.fila.map((f) => ({ id: f.user_id, nome: f.nome ?? `#${f.user_id}`, email: f.email ?? '' })));
    setAlterada(false);
  };

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const e = await api.get<EstadoRoleta>(`/config/growthhs/${ambiente}/roleta`);
        if (vivo) aplicar(e);
      } catch (e) {
        toast.error('Falha ao carregar a roleta de reunião', {
          description: e instanceof ErroApi ? e.message : undefined,
        });
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [ambiente]);

  const mover = (i: number, passo: -1 | 1) => {
    const j = i + passo;
    if (j < 0 || j >= fila.length) return;
    const nova = [...fila];
    [nova[i], nova[j]] = [nova[j], nova[i]];
    setFila(nova);
    setAlterada(true);
  };

  const remover = (i: number) => {
    setFila(fila.filter((_, k) => k !== i));
    setAlterada(true);
  };

  const adicionar = () => {
    const v = vendedores.find((x) => String(x.id) === escolhido);
    if (!v || fila.some((f) => f.id === v.id)) return;
    setFila([...fila, v]);
    setEscolhido('');
    setAlterada(true);
  };

  const salvar = async () => {
    setSalvando(true);
    try {
      const e = await api.put<EstadoRoleta>(`/config/growthhs/${ambiente}/roleta`, {
        user_ids: fila.map((f) => f.id),
      });
      aplicar(e);
      toast.success(`Roleta de ${NOME[ambiente]} salva`);
    } catch (e) {
      toast.error('Falha ao salvar a roleta', {
        description: e instanceof ErroApi ? e.message : undefined,
      });
    } finally {
      setSalvando(false);
    }
  };

  if (carregando) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando…
      </div>
    );
  }

  const disponiveis = vendedores.filter((v) => !fila.some((f) => f.id === v.id));

  return (
    <div className="space-y-3">
      {aviso && (
        <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-[--tint-warning] p-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-warning" />
          <p className="text-xs leading-relaxed text-[--on-tint-warning]">{aviso}</p>
        </div>
      )}

      {fila.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhum vendedor na roleta — a landing não oferece horário neste ambiente.
        </p>
      ) : (
        <ol className="space-y-1.5">
          {fila.map((v, i) => (
            <li
              key={v.id}
              className="flex items-center justify-between gap-2 rounded-md border border-border/40 px-2 py-1.5"
            >
              <div className="min-w-0">
                <p className="text-sm truncate">
                  <span className="text-muted-foreground mr-1.5">{i + 1}.</span>
                  {v.nome}
                </p>
                {v.email && <p className="text-xs text-muted-foreground truncate">{v.email}</p>}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Subir"
                  onClick={() => mover(i, -1)} disabled={i === 0}>
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Descer"
                  onClick={() => mover(i, 1)} disabled={i === fila.length - 1}>
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Remover"
                  onClick={() => remover(i)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Select value={escolhido} onValueChange={setEscolhido} disabled={disponiveis.length === 0}>
          <SelectTrigger className="h-8 w-60 text-xs">
            <SelectValue placeholder={disponiveis.length ? 'Adicionar vendedor…' : 'Nenhum vendedor a adicionar'} />
          </SelectTrigger>
          <SelectContent>
            {disponiveis.map((v) => (
              <SelectItem key={v.id} value={String(v.id)}>
                {v.nome} — {v.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={adicionar} disabled={!escolhido}>
          <Plus className="h-3.5 w-3.5" /> Adicionar
        </Button>
        <Button size="sm" className="gap-1.5 ml-auto" onClick={salvar} disabled={!alterada || salvando}>
          {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Salvar roleta
        </Button>
      </div>
    </div>
  );
}

export default function RoletaReuniaoCard() {
  const [aba, setAba] = useState<Ambiente>('homologacao');

  return (
    <Card className="border-border/40">
      <CardHeader>
        <CardTitle className="text-base">Roleta de reunião</CardTitle>
        <CardDescription className="text-xs">
          Quem atende os leads que agendam reunião pela landing
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground leading-relaxed">
          No horário escolhido pelo lead, a reunião vai para o primeiro da fila que está livre na
          agenda do Outlook, e ele passa para o fim. Quem estava ocupado guarda a vez. Lead que já
          tem card aberto no GrowthHS fica com o vendedor do card.
        </p>
        <Tabs value={aba} onValueChange={(v) => setAba(v as Ambiente)}>
          <TabsList>
            {AMBIENTES.map((a) => (
              <TabsTrigger key={a} value={a}>
                {NOME[a]}
              </TabsTrigger>
            ))}
          </TabsList>
          {AMBIENTES.map((a) => (
            <TabsContent key={a} value={a} className="pt-3">
              <FilaDoAmbiente ambiente={a} />
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}
