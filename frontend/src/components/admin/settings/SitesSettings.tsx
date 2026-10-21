// Sites de fora (o da H&S, de começo) que mandam visita e conversão pelo
// `rastreio.js`. Cadastro, snippet de instalação e rotação do token.
//
// ⚠️ Rotacionar o token mata o snippet instalado: o site para de mandar
// conversão até alguém colar o snippet novo. Por isso pede confirmação.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Globe, Plus, Copy, Check, Pencil, RefreshCw, Loader2, Trash2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import {
  type Site, listarSites, criarSite, atualizarSite, rotacionarToken,
  snippetDoSite, normalizarDominio, lerLista,
} from '@/lib/sites';

const CHAVE_CAMPO = /^[a-z][a-z0-9_]{0,39}$/;

// O servidor já sabe estes nomes (mapa padrão, Tarefa 4 do plano). O mapa do
// site só precisa do que fugir disso.
const MAPA_PADRAO_RESUMO = 'pnome, pemail, pwhatsapp, pmensagem, passunto, name, email, phone, telefone, celular, empresa, cargo, mensagem';

type LinhaMapa = { nome: string; campo: string };

type Formulario = {
  nome: string;
  dominios: string;
  tags: string;
  ativo: boolean;
  mapa: LinhaMapa[];
};

const VAZIO: Formulario = { nome: '', dominios: '', tags: '', ativo: true, mapa: [] };

function doSite(s: Site): Formulario {
  return {
    nome: s.nome,
    dominios: s.dominios.join('\n'),
    tags: s.tags.join(', '),
    ativo: s.ativo,
    mapa: Object.entries(s.mapa_campos ?? {}).map(([nome, campo]) => ({ nome, campo })),
  };
}

function mensagem(e: unknown, padrao: string): string {
  if (e instanceof Error && e.message && e.message !== '[object Object]') return e.message;
  return padrao;
}

function errosDoFormulario(f: Formulario): string[] {
  const erros: string[] = [];
  if (!f.nome.trim()) erros.push('Dê um nome ao site.');
  if (lerLista(f.dominios, normalizarDominio).length === 0) erros.push('Informe ao menos um domínio.');
  for (const l of f.mapa) {
    if (!l.nome.trim() && !l.campo.trim()) continue;
    if (!l.nome.trim()) erros.push('Toda linha do mapa precisa do name do campo no site.');
    else if (!CHAVE_CAMPO.test(l.campo.trim())) erros.push(`Campo inválido para "${l.nome.trim()}": use letras minúsculas, números e _ (ex.: empresa).`);
  }
  return erros;
}

export default function SitesSettings() {
  const qc = useQueryClient();
  const { data: sites = [], isLoading, error } = useQuery({ queryKey: ['sites'], queryFn: listarSites, retry: false });

  const [editando, setEditando] = useState<Site | 'novo' | null>(null);
  const [form, setForm] = useState<Formulario>(VAZIO);
  const [paraRotacionar, setParaRotacionar] = useState<Site | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);

  const origem = window.location.origin;

  const salvar = useMutation({
    mutationFn: async () => {
      const mapa_campos: Record<string, string> = {};
      for (const l of form.mapa) {
        if (l.nome.trim() && l.campo.trim()) mapa_campos[l.nome.trim()] = l.campo.trim();
      }
      const dados = {
        nome: form.nome.trim(),
        dominios: lerLista(form.dominios, normalizarDominio),
        tags: lerLista(form.tags),
        mapa_campos,
      };
      if (editando === 'novo') return criarSite(dados);
      if (editando) return atualizarSite(editando.id, { ...dados, ativo: form.ativo });
      throw new Error('Nada para salvar.');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sites'] });
      toast.success(editando === 'novo' ? 'Site cadastrado' : 'Site atualizado');
      setEditando(null);
    },
    onError: (e) => toast.error(mensagem(e, 'Não foi possível salvar o site')),
  });

  const rotacionar = useMutation({
    mutationFn: (id: string) => rotacionarToken(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sites'] });
      toast.success('Token novo gerado. Instale o snippet novo no site.');
      setParaRotacionar(null);
    },
    onError: (e) => toast.error(mensagem(e, 'Não foi possível rotacionar o token')),
  });

  const abrir = (s: Site | 'novo') => {
    setForm(s === 'novo' ? VAZIO : doSite(s));
    setEditando(s);
  };

  const copiar = async (s: Site) => {
    try {
      await navigator.clipboard.writeText(snippetDoSite(s, origem));
      setCopiado(s.id);
      toast.success('Snippet copiado');
      setTimeout(() => setCopiado(null), 2000);
    } catch {
      toast.error('Não foi possível copiar');
    }
  };

  const erros = errosDoFormulario(form);
  const mudarLinha = (i: number, parte: Partial<LinhaMapa>) =>
    setForm(f => ({ ...f, mapa: f.mapa.map((l, j) => (j === i ? { ...l, ...parte } : l)) }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold">Sites</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Sites de fora que mandam visitas e formulários ao MarketingHS pelo código de monitoramento
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => abrir('novo')}>
          <Plus className="h-3.5 w-3.5" /> Novo site
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-[--tint-danger] border border-danger/30">
          <AlertTriangle className="h-4 w-4 text-[--on-tint-danger] flex-shrink-0 mt-0.5" />
          <p className="text-xs text-[--on-tint-danger]">
            Não foi possível carregar os sites ({mensagem(error, 'erro desconhecido')}).
          </p>
        </div>
      ) : sites.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center mb-3">
            <Globe className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">Nenhum site cadastrado</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-xs">
            Cadastre o site, copie o snippet e cole no &lt;head&gt; dele — convive com o código do RD
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sites.map(s => (
            <div key={s.id} className="rounded-xl border border-border/40 bg-card p-4 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">{s.nome}</p>
                    {s.ativo ? <Badge variant="success">Ativo</Badge> : <Badge variant="secondary">Inativo</Badge>}
                    {s.tags.map(t => <Badge key={t} variant="outline">{t}</Badge>)}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 break-all">
                    {s.dominios.length ? s.dominios.join(' · ') : 'Sem domínio — nenhuma origem aceita'}
                  </p>
                  {Object.keys(s.mapa_campos ?? {}).length > 0 && (
                    <p className="text-xs text-muted-foreground mt-0.5 break-all">
                      Mapa: {Object.entries(s.mapa_campos).map(([n, c]) => `${n} → ${c}`).join(', ')}
                    </p>
                  )}
                </div>
                <div className="flex gap-1.5">
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => abrir(s)}>
                    <Pencil className="h-3.5 w-3.5" /> Editar
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setParaRotacionar(s)}>
                    <RefreshCw className="h-3.5 w-3.5" /> Rotacionar token
                  </Button>
                </div>
              </div>
              <div className="flex gap-2">
                <Input readOnly value={snippetDoSite(s, origem)} className="text-xs font-mono bg-muted/30" aria-label={`Snippet de ${s.nome}`} />
                <Button variant="outline" size="sm" className="flex-shrink-0" onClick={() => copiar(s)} aria-label="Copiar snippet">
                  {copiado === s.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={editando !== null} onOpenChange={o => !o && !salvar.isPending && setEditando(null)}>
        <DialogContent className="max-w-[560px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">{editando === 'novo' ? 'Novo site' : 'Editar site'}</DialogTitle>
            <DialogDescription className="text-xs">
              O token só vale vindo dos domínios abaixo. O snippet sai pronto depois de salvar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="site-nome" className="text-xs">Nome</Label>
              <Input id="site-nome" value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                placeholder="Site da H&S" className="text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="site-dominios" className="text-xs">Domínios permitidos</Label>
              <Textarea id="site-dominios" value={form.dominios}
                onChange={e => setForm(f => ({ ...f, dominios: e.target.value }))}
                placeholder={'www.healthsafety.com.br\nhealthsafety.com.br'}
                className="text-xs font-mono min-h-[64px]" />
              <p className="text-xs text-muted-foreground">
                Um por linha. Vale o host exato — <code>www.</code> e sem <code>www.</code> são dois. Fica:{' '}
                {lerLista(form.dominios, normalizarDominio).join(', ') || '—'}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="site-tags" className="text-xs">Tags aplicadas na conversão</Label>
              <Input id="site-tags" value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
                placeholder="prova-rd" className="text-xs" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs">Mapa de campos (name no site → campo)</Label>
                <Button variant="ghost" size="sm" className="gap-1.5"
                  onClick={() => setForm(f => ({ ...f, mapa: [...f.mapa, { nome: '', campo: '' }] }))}>
                  <Plus className="h-3.5 w-3.5" /> Linha
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Já reconhecidos sem mapa: {MAPA_PADRAO_RESUMO}. Campo de senha, cartão e captcha nunca é lido.
              </p>
              {form.mapa.map((l, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input value={l.nome} onChange={e => mudarLinha(i, { nome: e.target.value })}
                    placeholder="name no site (ex.: pempresa)" className="text-xs font-mono" aria-label="name no site" />
                  <span className="text-xs text-muted-foreground">→</span>
                  <Input value={l.campo} onChange={e => mudarLinha(i, { campo: e.target.value })}
                    placeholder="campo (ex.: empresa)" className="text-xs font-mono" aria-label="campo" />
                  <Button variant="ghost" size="sm" aria-label="Remover linha"
                    onClick={() => setForm(f => ({ ...f, mapa: f.mapa.filter((_, j) => j !== i) }))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            {editando !== 'novo' && (
              <div className="flex items-center justify-between">
                <Label htmlFor="site-ativo" className="text-xs">Ativo</Label>
                <Switch id="site-ativo" checked={form.ativo} onCheckedChange={v => setForm(f => ({ ...f, ativo: v }))} />
              </div>
            )}
            {erros.length > 0 && (
              <ul className="text-xs text-[--on-tint-danger] space-y-0.5">
                {erros.map(e => <li key={e}>{e}</li>)}
              </ul>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditando(null)} disabled={salvar.isPending}>Cancelar</Button>
            <Button onClick={() => salvar.mutate()} disabled={salvar.isPending || erros.length > 0}>
              {salvar.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={paraRotacionar !== null} onOpenChange={o => !o && !rotacionar.isPending && setParaRotacionar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rotacionar o token de {paraRotacionar?.nome}?</AlertDialogTitle>
            <AlertDialogDescription>
              O snippet antigo para de funcionar na hora: o site deixa de mandar visitas e formulários
              até o snippet novo ser instalado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rotacionar.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={rotacionar.isPending}
              onClick={e => { e.preventDefault(); if (paraRotacionar) rotacionar.mutate(paraRotacionar.id); }}>
              {rotacionar.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Rotacionar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
