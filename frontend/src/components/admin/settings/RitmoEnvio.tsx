import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

// Ritmo de envio — os limites do worker (`backend/app/ritmo.py`), editáveis
// pela tela desde 07/10/2026. Antes só se mudavam por SQL.
//
// ⚠️ O salvar manda SÓ o que foi editado. Em produção os tetos estão em 90/dia
// e 90/h (plano gratuito do Resend); mexer no ritmo por segundo não pode
// regravar os tetos com o que estava no formulário.

type Campo = 'por_segundo' | 'teto_hora' | 'teto_dia' | 'aquecimento_dia1' | 'aquecimento_inicio';
type Origem = 'banco' | 'ambiente' | 'padrao';

interface InfoCampo {
  chave: string;
  valor: number | string | null;
  origem: Origem;
  padrao: number | string | null;
  invalido: string | null;
}

interface Ritmo {
  campos: Record<Campo, InfoCampo>;
  hoje: string;
  primeiro_envio: string | null;
  inicio_rampa: string | null;
  teto_hoje: number;
  enviados_hoje: number;
  enviados_ultima_hora: number;
}

const ROTA = '/config/envio/ritmo';

const CAMPOS: { campo: Campo; rotulo: string; ajuda: string }[] = [
  { campo: 'teto_dia', rotulo: 'Teto por dia',
    ajuda: 'Dia civil de Brasília. O que passar fica na fila e sai no dia seguinte.' },
  { campo: 'teto_hora', rotulo: 'Teto por hora', ajuda: 'Janela móvel dos últimos 60 minutos.' },
  { campo: 'por_segundo', rotulo: 'Envios por segundo',
    ajuda: 'Limite de taxa do Resend (2 por segundo no plano padrão).' },
  { campo: 'aquecimento_dia1', rotulo: 'Rampa: e-mails no dia 1',
    ajuda: 'Dobra a cada dia até o teto por dia. 0 desliga a rampa.' },
  { campo: 'aquecimento_inicio', rotulo: 'Rampa: data do dia 1',
    ajuda: 'Vazio = o dia do primeiro envio real.' },
];

const ORIGEM: Record<Origem, string> = {
  banco: 'gravado',
  ambiente: 'do ambiente',
  padrao: 'padrão do sistema',
};

function dataBr(iso: string | null): string {
  if (!iso) return '—';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

function comoTexto(v: number | string | null): string {
  return v === null || v === undefined ? '' : String(v);
}

// O mesmo que o backend aceita (RitmoIn). Devolve a mensagem do erro, ou null.
function erroDe(campo: Campo, texto: string): string | null {
  const t = texto.trim();
  if (campo === 'aquecimento_inicio') {
    if (t === '') return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return 'Data no formato AAAA-MM-DD.';
    const d = new Date(`${t}T00:00:00Z`);
    return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t ? 'Data inválida.' : null;
  }
  if (t === '') return 'Informe um número.';
  const n = Number(t.replace(',', '.'));
  if (!Number.isFinite(n)) return 'Informe um número.';
  if (campo === 'por_segundo') return n > 0 && n <= 100 ? null : 'Entre 0 (exclusive) e 100.';
  if (!Number.isInteger(n)) return 'Número inteiro.';
  if (campo === 'aquecimento_dia1') return n >= 0 ? null : '0 ou mais.';
  // Teto 0 o worker ignora e volta ao padrão: recusado aqui também.
  return n >= 1 ? null : '1 ou mais. Para parar uma campanha, use "Pausar envio".';
}

export default function RitmoEnvio() {
  const [ritmo, setRitmo] = useState<Ritmo | null>(null);
  const [form, setForm] = useState<Record<Campo, string> | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const preencher = useCallback((r: Ritmo) => {
    setRitmo(r);
    setForm(Object.fromEntries(
      CAMPOS.map(({ campo }) => [campo, comoTexto(r.campos[campo].valor)]),
    ) as Record<Campo, string>);
  }, []);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      preencher(await api.get<Ritmo>(ROTA));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao carregar o ritmo de envio');
    } finally {
      setCarregando(false);
    }
  }, [preencher]);

  useEffect(() => { carregar(); }, [carregar]);

  const editados = useMemo(() => {
    if (!ritmo || !form) return [] as Campo[];
    return CAMPOS.map(({ campo }) => campo)
      .filter((c) => form[c].trim() !== comoTexto(ritmo.campos[c].valor));
  }, [ritmo, form]);

  const erros = useMemo(() => {
    if (!form) return {} as Partial<Record<Campo, string>>;
    const saida: Partial<Record<Campo, string>> = {};
    for (const c of editados) {
      const e = erroDe(c, form[c]);
      if (e) saida[c] = e;
    }
    return saida;
  }, [form, editados]);

  const salvar = async () => {
    if (!form || editados.length === 0 || Object.keys(erros).length > 0) return;
    const corpo: Record<string, number | string | null> = {};
    for (const c of editados) {
      const t = form[c].trim();
      corpo[c] = c === 'aquecimento_inicio' ? (t === '' ? null : t) : Number(t.replace(',', '.'));
    }
    setSalvando(true);
    try {
      preencher(await api.put<Ritmo>(ROTA, corpo));
      toast.success('Ritmo de envio salvo. Vale no worker em até 1 minuto.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar o ritmo de envio');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="space-y-3 border-t pt-4">
      <div>
        <h4 className="text-sm font-medium">Ritmo de envio</h4>
        <p className="text-xs text-muted-foreground">
          Quanto o worker manda. O excedente nunca é descartado: espera na fila pela próxima hora ou dia.
        </p>
      </div>

      {carregando && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}

      {ritmo && form && (
        <>
          <p className="text-xs">
            Hoje ({dataBr(ritmo.hoje)}): até <strong>{ritmo.teto_hoje}</strong> e-mails
            {ritmo.inicio_rampa ? ` (rampa a partir de ${dataBr(ritmo.inicio_rampa)})` : ' (rampa desligada)'} ·
            {' '}{ritmo.enviados_hoje} enviados hoje · {ritmo.enviados_ultima_hora} na última hora.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            {CAMPOS.map(({ campo, rotulo, ajuda }) => {
              const info = ritmo.campos[campo];
              const id = `ritmo-${campo}`;
              return (
                <div key={campo} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Label htmlFor={id}>{rotulo}</Label>
                    <Badge variant="outline" className="text-xs font-normal">{ORIGEM[info.origem]}</Badge>
                  </div>
                  <Input
                    id={id}
                    type={campo === 'aquecimento_inicio' ? 'date' : 'text'}
                    inputMode={campo === 'por_segundo' ? 'decimal' : campo === 'aquecimento_inicio' ? undefined : 'numeric'}
                    value={form[campo]}
                    aria-invalid={!!erros[campo]}
                    onChange={(e) => setForm({ ...form, [campo]: e.target.value })}
                  />
                  {erros[campo]
                    ? <p className="text-xs text-[--on-tint-danger]">{erros[campo]}</p>
                    : <p className="text-xs text-muted-foreground">
                        {ajuda}
                        {info.padrao !== null && ` Padrão: ${info.padrao}.`}
                      </p>}
                  {info.invalido && (
                    <p className="text-xs text-[--on-tint-warning]">
                      O valor gravado "{info.invalido}" é inválido — o worker usa o padrão.
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {editados.includes('aquecimento_inicio') && form.aquecimento_inicio.trim() === '' && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Sem data, o dia 1 da rampa volta a ser o do primeiro envio real
                ({dataBr(ritmo.primeiro_envio)}).
              </AlertDescription>
            </Alert>
          )}

          <div className="flex items-center gap-3">
            <Button onClick={salvar}
                    disabled={salvando || editados.length === 0 || Object.keys(erros).length > 0}
                    className="gap-2">
              {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
              Salvar ritmo
            </Button>
            {editados.length > 0 && (
              <Button variant="ghost" onClick={() => preencher(ritmo)} disabled={salvando}>
                Desfazer
              </Button>
            )}
            <span className="text-xs text-muted-foreground">
              {editados.length === 0 ? 'Nada alterado.' : `Só ${editados.length === 1 ? 'o campo alterado é gravado' : `os ${editados.length} campos alterados são gravados`}.`}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
