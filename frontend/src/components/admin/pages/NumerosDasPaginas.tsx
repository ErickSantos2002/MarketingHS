// Visitas, visitantes únicos, conversões e taxa — por página da casa e por
// formulário de site de fora, com abertura por canal. Tudo agregado no
// servidor (GET /paginas/numeros); aqui só se mostra.
import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, ChevronDown, ChevronRight, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  type NumerosPorCanal, lerNumeros, formatarTaxa, formatarDia, nomeDoCanal, periodoDosUltimos,
} from '@/lib/numeros';

const PERIODOS = [7, 30, 90] as const;

const num = (n: number | undefined) => (n ?? 0).toLocaleString('pt-BR');

function mensagem(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return 'erro desconhecido';
}

function LinhasDeCanal({ canais, comVisitas, recuo }: { canais: NumerosPorCanal[]; comVisitas: boolean; recuo: number }) {
  if (canais.length === 0) {
    return (
      <TableRow className="bg-muted/20 hover:bg-muted/20">
        <TableCell colSpan={recuo + (comVisitas ? 4 : 3)} className="py-2 pl-10 text-xs text-muted-foreground">
          Sem dado por canal no período
        </TableCell>
      </TableRow>
    );
  }
  return (
    <>
      {canais.map(c => (
        <TableRow key={c.canal} className="bg-muted/20 hover:bg-muted/20">
          <TableCell colSpan={recuo} className="py-2 pl-10 text-xs text-muted-foreground">{nomeDoCanal(c.canal)}</TableCell>
          {comVisitas && <TableCell className="py-2 text-xs text-right tabular-nums">{num(c.visitas)}</TableCell>}
          <TableCell className="py-2 text-xs text-right tabular-nums">{num(c.visitantes)}</TableCell>
          <TableCell className="py-2 text-xs text-right tabular-nums">{num(c.conversoes)}</TableCell>
          <TableCell className="py-2 text-xs text-right tabular-nums">{formatarTaxa(c.taxa)}</TableCell>
        </TableRow>
      ))}
    </>
  );
}

function BotaoAbrir({ aberto, onClick, rotulo }: { aberto: boolean; onClick: () => void; rotulo: string }) {
  return (
    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClick}
      aria-expanded={aberto} aria-label={`${aberto ? 'Fechar' : 'Abrir'} canais de ${rotulo}`}>
      {aberto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
    </Button>
  );
}

export function NumerosDasPaginas() {
  const [dias, setDias] = useState<number>(30);
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const { de, ate } = periodoDosUltimos(dias);
  const { data, isLoading, error } = useQuery({
    queryKey: ['paginas-numeros', de, ate],
    queryFn: () => lerNumeros(de, ate),
    retry: false,
  });

  const alternar = (chave: string) => setAbertos(s => {
    const novo = new Set(s);
    if (novo.has(chave)) novo.delete(chave); else novo.add(chave);
    return novo;
  });

  const paginas = data?.paginas ?? [];
  const formularios = data?.formularios ?? [];

  return (
    <section className="space-y-4" aria-labelledby="numeros-titulo">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-muted-foreground" />
          <div>
            <h3 id="numeros-titulo" className="text-base font-semibold">Números</h3>
            <p className="text-xs text-muted-foreground">
              Taxa = conversões ÷ visitantes únicos · {formatarDia(data?.de ?? de)} a {formatarDia(data?.ate ?? ate)}
            </p>
          </div>
        </div>
        <ToggleGroup type="single" variant="outline" size="sm" value={String(dias)}
          onValueChange={v => v && setDias(Number(v))} aria-label="Período">
          {PERIODOS.map(p => (
            <ToggleGroupItem key={p} value={String(p)} className="h-9">{p} dias</ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-[--tint-danger] border border-danger/30">
          <AlertTriangle className="h-4 w-4 text-[--on-tint-danger] flex-shrink-0 mt-0.5" />
          <p className="text-xs text-[--on-tint-danger]">Não foi possível carregar os números ({mensagem(error)}).</p>
        </div>
      ) : (
        <>
          <div className="border border-border/40 rounded-lg overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs h-9 w-8" />
                  <TableHead className="text-xs h-9">Página</TableHead>
                  <TableHead className="text-xs h-9 text-right">Visitas</TableHead>
                  <TableHead className="text-xs h-9 text-right">Visitantes</TableHead>
                  <TableHead className="text-xs h-9 text-right">Conversões</TableHead>
                  <TableHead className="text-xs h-9 text-right">Taxa</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginas.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={6} className="py-6 text-center text-xs text-muted-foreground">
                      Nenhuma visita nem conversão em página no período
                    </TableCell>
                  </TableRow>
                ) : paginas.map(p => {
                  const chave = `p:${p.slug}`;
                  const aberto = abertos.has(chave);
                  return (
                    <Fragment key={chave}>
                      <TableRow>
                        <TableCell className="py-2"><BotaoAbrir aberto={aberto} onClick={() => alternar(chave)} rotulo={p.nome || p.slug} /></TableCell>
                        <TableCell className="py-2">
                          <p className="text-xs font-medium">{p.nome || p.slug}</p>
                          <code className="text-xs text-muted-foreground font-mono">/{p.slug}</code>
                        </TableCell>
                        <TableCell className="py-2 text-xs text-right tabular-nums">{num(p.visitas)}</TableCell>
                        <TableCell className="py-2 text-xs text-right tabular-nums">{num(p.visitantes)}</TableCell>
                        <TableCell className="py-2 text-xs text-right tabular-nums">{num(p.conversoes)}</TableCell>
                        <TableCell className="py-2 text-xs text-right tabular-nums font-semibold">{formatarTaxa(p.taxa)}</TableCell>
                      </TableRow>
                      {aberto && <LinhasDeCanal canais={p.por_canal ?? []} comVisitas recuo={2} />}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="border border-border/40 rounded-lg overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs h-9 w-8" />
                  <TableHead className="text-xs h-9">Formulário de site</TableHead>
                  <TableHead className="text-xs h-9 text-right">Visitantes</TableHead>
                  <TableHead className="text-xs h-9 text-right">Conversões</TableHead>
                  <TableHead className="text-xs h-9 text-right">Taxa</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {formularios.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={5} className="py-6 text-center text-xs text-muted-foreground">
                      Nenhum formulário de site com conversão no período
                    </TableCell>
                  </TableRow>
                ) : formularios.map(f => {
                  const chave = `f:${f.site_id}:${f.form_id}:${f.page_path}`;
                  const aberto = abertos.has(chave);
                  return (
                    <Fragment key={chave}>
                      <TableRow>
                        <TableCell className="py-2"><BotaoAbrir aberto={aberto} onClick={() => alternar(chave)} rotulo={f.form_id} /></TableCell>
                        <TableCell className="py-2">
                          <p className="text-xs font-medium font-mono break-all">{f.form_id}</p>
                          <p className="text-xs text-muted-foreground break-all">{f.site_nome} · {f.page_path || '/'}</p>
                        </TableCell>
                        <TableCell className="py-2 text-xs text-right tabular-nums">{num(f.visitantes)}</TableCell>
                        <TableCell className="py-2 text-xs text-right tabular-nums">{num(f.conversoes)}</TableCell>
                        <TableCell className="py-2 text-xs text-right tabular-nums font-semibold">{formatarTaxa(f.taxa)}</TableCell>
                      </TableRow>
                      {aberto && <LinhasDeCanal canais={f.por_canal ?? []} comVisitas={false} recuo={2} />}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </section>
  );
}
