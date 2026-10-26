import { useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  LIMITE_SECOES, TIPOS_DE_SECAO, secaoVazia, type SecaoDaConfig, type TipoDeSecao,
} from '@/landing/secoes';
import { EditorDeSecao } from './EditoresDeSecao';

// O nome de cada tipo em português e uma linha do que ele é — a lista que
// aparece em "Adicionar seção".
const NOMES_DE_SECAO: Record<TipoDeSecao, { nome: string; descricao: string }> = {
  numeros: { nome: 'Números', descricao: 'Faixa com até 6 números em destaque (ex.: 770+ aparelhos).' },
  comparativo: { nome: 'Comparativo', descricao: 'Tabela de duas colunas; a segunda é a destacada.' },
  passos: { nome: 'Passo a passo', descricao: 'Etapas numeradas, com título e texto.' },
  cartoes: { nome: 'Cartões', descricao: 'Grade de cartões com título, texto e imagem opcional.' },
  texto_imagem: { nome: 'Texto e imagem', descricao: 'Texto corrido ao lado de uma imagem.' },
  logos: { nome: 'Logos', descricao: 'Clientes ou parceiros; sem imagem, mostra o nome.' },
  perguntas: { nome: 'Perguntas frequentes', descricao: 'Pergunta que abre a resposta ao clicar.' },
  chamada: { nome: 'Chamada', descricao: 'Faixa final com lista e botão que leva ao formulário.' },
};

function novoId(): string {
  // randomUUID só existe em contexto seguro (https ou localhost) — é o caso
  // do admin; o resto é rede de segurança, o id só precisa ser único na página.
  return globalThis.crypto?.randomUUID?.() ?? `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function tipoConhecido(s: unknown): s is SecaoDaConfig {
  return !!s && typeof s === 'object' && TIPOS_DE_SECAO.includes((s as SecaoDaConfig).tipo);
}

export function SecoesEditor({ secoes, onChange }: {
  secoes: unknown[];
  onChange: (s: unknown[]) => void;
}) {
  const [escolhendo, setEscolhendo] = useState(false);
  // Recolhidas por padrão (a página do Phoebus tem nove); a recém-criada abre.
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  // Remover pede confirmação na própria tela — nada de window.confirm, que
  // trava a automação do navegador.
  const [removendo, setRemovendo] = useState<number | null>(null);

  const chave = (s: unknown, i: number) => (tipoConhecido(s) && s.id ? s.id : `posicao-${i}`);
  const alternar = (k: string) => setAbertas((antes) => {
    const proximo = new Set(antes);
    if (proximo.has(k)) proximo.delete(k); else proximo.add(k);
    return proximo;
  });
  const trocar = (i: number, nova: SecaoDaConfig) => onChange(secoes.map((s, j) => (j === i ? nova : s)));
  const mover = (i: number, passo: -1 | 1) => {
    const j = i + passo;
    if (j < 0 || j >= secoes.length) return;
    const proximo = [...secoes];
    [proximo[i], proximo[j]] = [proximo[j], proximo[i]];
    setRemovendo(null);
    onChange(proximo);
  };
  const remover = (i: number) => {
    setRemovendo(null);
    onChange(secoes.filter((_, j) => j !== i));
  };
  const adicionar = (tipo: TipoDeSecao) => {
    const id = novoId();
    setAbertas((antes) => new Set(antes).add(id));
    setEscolhendo(false);
    onChange([...secoes, secaoVazia(tipo, id)]);
  };
  const noLimite = secoes.length >= LIMITE_SECOES;

  return (
    <div className="space-y-3">
      {secoes.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Nenhuma seção: a página mostra só o topo com o formulário.
        </p>
      )}
      {secoes.map((secao, i) => {
        const k = chave(secao, i);
        const conhecida = tipoConhecido(secao);
        const aberta = abertas.has(k);
        const nome = conhecida ? NOMES_DE_SECAO[secao.tipo].nome : 'Seção não reconhecida';
        const titulo = conhecida && typeof secao.titulo === 'string' ? secao.titulo.trim() : '';
        const idCorpo = `secao-${i}-corpo`;
        return (
          <div key={k} className="rounded-lg border border-borda bg-surface">
            <div className="flex items-center gap-1 p-2">
              <Button type="button" variant="ghost" size="sm" className="flex-1 justify-start min-w-0"
                      aria-expanded={conhecida ? aberta : undefined} aria-controls={conhecida ? idCorpo : undefined}
                      disabled={!conhecida} onClick={() => alternar(k)}>
                {aberta ? <ChevronDown className="h-4 w-4 mr-1 shrink-0" /> : <ChevronRight className="h-4 w-4 mr-1 shrink-0" />}
                <span className="font-medium shrink-0">{i + 1}. {nome}</span>
                {titulo && <span className="ml-2 truncate text-muted-foreground font-normal">— {titulo}</span>}
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label={`Subir seção ${i + 1}`}
                      disabled={i === 0} onClick={() => mover(i, -1)}>
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label={`Descer seção ${i + 1}`}
                      disabled={i === secoes.length - 1} onClick={() => mover(i, 1)}>
                <ArrowDown className="h-4 w-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remover seção ${i + 1}`}
                      onClick={() => setRemovendo(i)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            {removendo === i && (
              <div role="alert" className="mx-2 mb-2 flex flex-wrap items-center gap-2 rounded-md border border-borda bg-surface-elevated p-2">
                <span className="text-sm flex-1">Remover a seção “{titulo || nome}”? O conteúdo dela se perde.</span>
                <Button type="button" variant="destructive" size="sm" onClick={() => remover(i)}>Remover</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setRemovendo(null)}>Cancelar</Button>
              </div>
            )}
            {!conhecida && (
              <p className="px-3 pb-3 text-xs text-muted-foreground">
                Chegou por fora do editor e a página não mostra. Pode remover.
              </p>
            )}
            {conhecida && aberta && (
              <div id={idCorpo} className="border-t border-borda p-3">
                <EditorDeSecao secao={secao} prefixo={`secao-${i}`} onChange={(nova) => trocar(i, nova)} />
              </div>
            )}
          </div>
        );
      })}

      {escolhendo ? (
        <div className="rounded-lg border border-borda p-3 space-y-2">
          <p className="text-sm font-medium">Que tipo de seção?</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {TIPOS_DE_SECAO.map((tipo) => (
              <Button key={tipo} type="button" variant="outline"
                      className="h-auto flex-col items-start whitespace-normal py-2 text-left"
                      onClick={() => adicionar(tipo)}>
                <span className="font-medium">{NOMES_DE_SECAO[tipo].nome}</span>
                <span className="text-xs font-normal text-muted-foreground">{NOMES_DE_SECAO[tipo].descricao}</span>
              </Button>
            ))}
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setEscolhendo(false)}>Cancelar</Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={noLimite} onClick={() => setEscolhendo(true)}>
            <Plus className="h-4 w-4 mr-1" /> Adicionar seção
          </Button>
          {noLimite && <span className="text-xs text-muted-foreground">Limite de {LIMITE_SECOES} seções.</span>}
        </div>
      )}
    </div>
  );
}
