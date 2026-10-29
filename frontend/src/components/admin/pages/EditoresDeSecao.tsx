import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Film, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  BOTAO_DA_CHAMADA_PADRAO, COLUNA_A_PADRAO, COLUNA_B_PADRAO,
  LIMITE_ITENS, LIMITE_LINHAS, LIMITE_NUMEROS, idDoVideoHospedado, idDoYoutube,
  type ItemDaConfig, type LinhaDaConfig, type SecaoDaConfig,
} from '@/landing/secoes';
import { CampoDeImagem } from './CampoDeImagem';
import { enderecoDaImagem } from '@/landing/campos';
import { BASE, ErroApi, lerToken, mensagemDoDetalhe } from '@/lib/api';

// Um editor por tipo de seção (frente landing-secoes, 26/10). Tudo aqui grava
// a forma CRUA (`SecaoDaConfig`) — a leitura defensiva é da landing
// (`secoesDaConfig`), que descarta o item vazio que ainda está sendo
// preenchido. Por isso o editor pode mostrar e guardar linha em branco.

type AoMudar = (s: SecaoDaConfig) => void;

const texto = (v: unknown) => (typeof v === 'string' ? v : '');
const listaDe = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

function Campo({ id, rotulo, valor, onChange, placeholder, longo, linhas = 3 }: {
  id: string; rotulo: string; valor: unknown; onChange: (v: string) => void;
  placeholder?: string; longo?: boolean; linhas?: number;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">{rotulo}</Label>
      {longo ? (
        <Textarea id={id} rows={linhas} value={texto(valor)} placeholder={placeholder}
                  onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input id={id} value={texto(valor)} placeholder={placeholder}
               onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

// Itens de uma seção: adicionar, remover, subir e descer. `desenhar` monta os
// campos de um item; `novo` é o item vazio que nasce no "Adicionar".
function ListaDeItens<T>({ itens, onChange, novo, teto, nomeDoItem, desenhar }: {
  itens: T[];
  onChange: (itens: T[]) => void;
  novo: () => T;
  teto: number;
  nomeDoItem: string;
  desenhar: (item: T, trocar: (parcial: Partial<T>) => void, i: number) => ReactNode;
}) {
  const mover = (i: number, passo: -1 | 1) => {
    const j = i + passo;
    if (j < 0 || j >= itens.length) return;
    const proximo = [...itens];
    [proximo[i], proximo[j]] = [proximo[j], proximo[i]];
    onChange(proximo);
  };
  return (
    <div className="space-y-2">
      {itens.map((item, i) => (
        <div key={i} className="flex items-start gap-2 rounded-md border border-borda p-2">
          <div className="flex-1 min-w-0 space-y-2">
            {desenhar(item, (parcial) => onChange(itens.map((x, j) => (j === i ? { ...x, ...parcial } : x))), i)}
          </div>
          <div className="flex flex-col gap-1">
            <Button type="button" variant="ghost" size="icon" aria-label={`Subir ${nomeDoItem} ${i + 1}`}
                    disabled={i === 0} onClick={() => mover(i, -1)}>
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" aria-label={`Descer ${nomeDoItem} ${i + 1}`}
                    disabled={i === itens.length - 1} onClick={() => mover(i, 1)}>
              <ArrowDown className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" aria-label={`Remover ${nomeDoItem} ${i + 1}`}
                    onClick={() => onChange(itens.filter((_, j) => j !== i))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={itens.length >= teto}
                onClick={() => onChange([...itens, novo()])}>
          <Plus className="h-4 w-4 mr-1" /> Adicionar {nomeDoItem}
        </Button>
        {itens.length >= teto && <span className="text-xs text-muted-foreground">Limite de {teto}.</span>}
      </div>
    </div>
  );
}

// Lista de frases, uma por linha (a lista com ✓ da chamada). O texto cru fica
// local: com o valor vindo do array já aparado, a linha recém-aberta com
// Enter sumiria a cada tecla — o mesmo cuidado do `OpcoesDaLista`.
function LinhasDeTexto({ id, rotulo, valores, onChange, placeholder }: {
  id: string; rotulo: string; valores: string[]; onChange: (v: string[]) => void; placeholder?: string;
}) {
  const [cru, setCru] = useState(valores.join('\n'));
  useEffect(() => {
    const atual = cru.split('\n').map((v) => v.trim()).filter(Boolean);
    if (atual.join('\n') !== valores.join('\n')) setCru(valores.join('\n'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valores.join('\n')]);
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">{rotulo}</Label>
      <Textarea id={id} rows={4} value={cru} placeholder={placeholder}
                onChange={(e) => {
                  setCru(e.target.value);
                  onChange(e.target.value.split('\n').map((v) => v.trim()).filter(Boolean).slice(0, LIMITE_ITENS));
                }} />
    </div>
  );
}

// ── Vídeo hospedado (frente video-proprio, 29/10) ────────────────────────────
// O mesmo teto do servidor (`app/routers/videos.py::TAMANHO_MAXIMO`): avisar
// aqui poupa subir 200 MB para levar 413 no fim.
const TETO_DO_VIDEO_MB = 60;

// Multipart com progresso: um vídeo de dezenas de MB leva tempo, e sem a
// porcentagem o botão parece travado. XHR porque o `fetch` não dá progresso
// de envio. ⚠️ Mesma autenticação de `subirImagemDeEmail` (Bearer).
function subirVideo(arquivo: File, aoProgredir: (pct: number) => void): Promise<{ url: string }> {
  return new Promise((resolver, rejeitar) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}/videos`);
    const token = lerToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) aoProgredir(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      let corpo: unknown = null;
      try { corpo = JSON.parse(xhr.responseText); } catch { /* sem corpo */ }
      if (xhr.status >= 200 && xhr.status < 300) resolver(corpo as { url: string });
      else {
        const detalhe = corpo && typeof corpo === 'object' ? (corpo as { detail?: unknown }).detail : null;
        // O 413 do nginx vem em HTML, sem `detail`.
        const padrao = xhr.status === 413
          ? `O vídeo passa de ${TETO_DO_VIDEO_MB} MB.` : `Erro ${xhr.status}`;
        rejeitar(new ErroApi(xhr.status, mensagemDoDetalhe(detalhe, padrao)));
      }
    };
    xhr.onerror = () => rejeitar(new ErroApi(0, 'Sem conexão com o servidor.'));
    const corpo = new FormData();
    corpo.append('arquivo', arquivo);
    xhr.send(corpo);
  });
}

function CampoDeVideo({ id, valor, onChange }: {
  id: string; valor: string; onChange: (url: string) => void;
}) {
  const [progresso, setProgresso] = useState<number | null>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);
  // ⚠️ O upload termina bem depois do clique: o `onChange` daquela
  // renderização gravaria a seção velha por cima do que se digitou enquanto
  // isso (mesma armadilha do `CampoDeImagem`).
  const onChangeAtual = useRef(onChange);
  onChangeAtual.current = onChange;

  const subir = async (arquivo: File) => {
    if (arquivo.size > TETO_DO_VIDEO_MB * 1024 * 1024) {
      toast.error(`O vídeo tem ${Math.ceil(arquivo.size / (1024 * 1024))} MB; o limite é ${TETO_DO_VIDEO_MB} MB.`);
      if (arquivoRef.current) arquivoRef.current.value = '';
      return;
    }
    setProgresso(0);
    try {
      const { url } = await subirVideo(arquivo, setProgresso);
      onChangeAtual.current(url);
      toast.success('Vídeo subido.');
    } catch (e) {
      toast.error(e instanceof ErroApi ? e.message : 'Erro ao subir o vídeo');
    } finally {
      setProgresso(null);
      if (arquivoRef.current) arquivoRef.current.value = '';
    }
  };

  const subido = !!idDoVideoHospedado(valor);
  const subindo = progresso !== null;
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-xs">Arquivo de vídeo</Label>
      <div className="flex flex-wrap items-center gap-2">
        <input ref={arquivoRef} id={id} type="file" accept="video/mp4,video/webm,.mp4,.webm" className="hidden"
               onChange={(e) => { const f = e.target.files?.[0]; if (f) subir(f); }} />
        <Button type="button" variant="outline" size="sm" disabled={subindo}
                onClick={() => arquivoRef.current?.click()}>
          {subindo ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Film className="h-4 w-4 mr-1" />}
          {subindo ? `Subindo… ${progresso}%` : subido ? 'Trocar vídeo' : 'Subir vídeo'}
        </Button>
        {subido && !subindo && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange('')}>
            Tirar
          </Button>
        )}
      </div>
      {subido && (
        <video src={enderecoDaImagem(valor, BASE)} controls preload="metadata" playsInline
               aria-label="Prévia do vídeo subido"
               className="max-h-48 rounded-lg border border-borda bg-surface" />
      )}
      <p className="text-xs text-muted-foreground">
        MP4 (H.264, o padrão de exportação) ou WebM, até {TETO_DO_VIDEO_MB} MB. Com arquivo, a página toca o vídeo
        no nosso próprio player, sem nada do YouTube — e o link do YouTube abaixo deixa de ser usado.
      </p>
    </div>
  );
}

export function EditorDeSecao({ secao, prefixo, onChange }: {
  secao: SecaoDaConfig; prefixo: string; onChange: AoMudar;
}) {
  const mudar = (parcial: Partial<SecaoDaConfig>) => onChange({ ...secao, ...parcial });
  const id = (sufixo: string) => `${prefixo}-${sufixo}`;
  const itens = listaDe<ItemDaConfig>(secao.itens);

  const cabeca = (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Campo id={id('titulo')} rotulo="Título da seção" valor={secao.titulo}
             onChange={(v) => mudar({ titulo: v })} />
      <Campo id={id('subtitulo')} rotulo="Linha de apoio (opcional)" valor={secao.subtitulo}
             onChange={(v) => mudar({ subtitulo: v })} />
    </div>
  );

  let corpo: ReactNode = null;
  switch (secao.tipo) {
    case 'numeros':
      corpo = (
        <ListaDeItens<ItemDaConfig> itens={itens} onChange={(x) => mudar({ itens: x })}
          novo={() => ({ valor: '', rotulo: '' })} teto={LIMITE_NUMEROS} nomeDoItem="número"
          desenhar={(item, trocar, i) => (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr]">
              <Campo id={id(`item-${i}-valor`)} rotulo="Número" valor={item.valor} placeholder="770+"
                     onChange={(v) => trocar({ valor: v })} />
              <Campo id={id(`item-${i}-rotulo`)} rotulo="Legenda" valor={item.rotulo} placeholder="aparelhos conectados"
                     onChange={(v) => trocar({ rotulo: v })} />
            </div>
          )} />
      );
      break;
    case 'comparativo': {
      const colunas = secao.colunas && typeof secao.colunas === 'object' ? secao.colunas : {};
      const nomeA = texto(colunas.a) || COLUNA_A_PADRAO;
      const nomeB = texto(colunas.b) || COLUNA_B_PADRAO;
      corpo = (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Campo id={id('coluna-a')} rotulo="Coluna 1" valor={colunas.a} placeholder={COLUNA_A_PADRAO}
                   onChange={(v) => mudar({ colunas: { ...colunas, a: v } })} />
            <Campo id={id('coluna-b')} rotulo="Coluna 2 (a destacada)" valor={colunas.b} placeholder={COLUNA_B_PADRAO}
                   onChange={(v) => mudar({ colunas: { ...colunas, b: v } })} />
          </div>
          <ListaDeItens<LinhaDaConfig> itens={listaDe<LinhaDaConfig>(secao.linhas)}
            onChange={(x) => mudar({ linhas: x })} novo={() => ({ criterio: '', a: '', b: '' })}
            teto={LIMITE_LINHAS} nomeDoItem="linha"
            desenhar={(linha, trocar, i) => (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Campo id={id(`linha-${i}-criterio`)} rotulo="Critério" valor={linha.criterio}
                       onChange={(v) => trocar({ criterio: v })} />
                <Campo id={id(`linha-${i}-a`)} rotulo={nomeA} valor={linha.a} onChange={(v) => trocar({ a: v })} />
                <Campo id={id(`linha-${i}-b`)} rotulo={nomeB} valor={linha.b} onChange={(v) => trocar({ b: v })} />
              </div>
            )} />
        </div>
      );
      break;
    }
    case 'passos':
      corpo = (
        <ListaDeItens<ItemDaConfig> itens={itens} onChange={(x) => mudar({ itens: x })}
          novo={() => ({ titulo: '', texto: '' })} teto={LIMITE_ITENS} nomeDoItem="passo"
          desenhar={(item, trocar, i) => (
            <>
              <Campo id={id(`item-${i}-titulo`)} rotulo={`Passo ${i + 1}`} valor={item.titulo}
                     onChange={(v) => trocar({ titulo: v })} />
              <Campo id={id(`item-${i}-texto`)} rotulo="Texto" valor={item.texto} longo linhas={2}
                     onChange={(v) => trocar({ texto: v })} />
            </>
          )} />
      );
      break;
    case 'cartoes':
      corpo = (
        <ListaDeItens<ItemDaConfig> itens={itens} onChange={(x) => mudar({ itens: x })}
          novo={() => ({ titulo: '', texto: '', imagem_url: '' })} teto={LIMITE_ITENS} nomeDoItem="cartão"
          desenhar={(item, trocar, i) => (
            <>
              <Campo id={id(`item-${i}-titulo`)} rotulo="Título" valor={item.titulo}
                     onChange={(v) => trocar({ titulo: v })} />
              <Campo id={id(`item-${i}-texto`)} rotulo="Texto" valor={item.texto} longo linhas={2}
                     onChange={(v) => trocar({ texto: v })} />
              <CampoDeImagem id={id(`item-${i}-imagem`)} rotulo="Imagem (opcional)" valor={texto(item.imagem_url)}
                             onChange={(v) => trocar({ imagem_url: v })} />
            </>
          )} />
      );
      break;
    case 'texto_imagem':
      corpo = (
        <div className="space-y-3">
          <Campo id={id('texto')} rotulo="Texto" valor={secao.texto} longo linhas={6}
                 placeholder={'Um parágrafo por bloco, separados por linha em branco.\n\n- Linha começando com "- " vira item de lista'}
                 onChange={(v) => mudar({ texto: v })} />
          <CampoDeImagem id={id('imagem')} rotulo="Imagem (opcional)" valor={texto(secao.imagem_url)}
                         onChange={(v) => mudar({ imagem_url: v })}
                         ajuda="O texto alternativo é o título da seção." />
          <div className="space-y-1">
            <Label className="text-xs">Imagem no computador</Label>
            <Select value={secao.lado === 'esquerda' ? 'esquerda' : 'direita'}
                    onValueChange={(v) => mudar({ lado: v as 'esquerda' | 'direita' })}>
              <SelectTrigger aria-label="Lado da imagem" className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="direita">À direita do texto</SelectItem>
                <SelectItem value="esquerda">À esquerda do texto</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      );
      break;
    case 'logos':
      corpo = (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Logo sem imagem aparece com o nome em texto. Na página, os logos ficam em cinza.
          </p>
          <ListaDeItens<ItemDaConfig> itens={itens} onChange={(x) => mudar({ itens: x })}
            novo={() => ({ nome: '', imagem_url: '' })} teto={LIMITE_ITENS} nomeDoItem="logo"
            desenhar={(item, trocar, i) => (
              <>
                <Campo id={id(`item-${i}-nome`)} rotulo="Nome (vira o texto alternativo)" valor={item.nome}
                       onChange={(v) => trocar({ nome: v })} />
                <CampoDeImagem id={id(`item-${i}-imagem`)} rotulo="Logo" valor={texto(item.imagem_url)}
                               onChange={(v) => trocar({ imagem_url: v })} />
              </>
            )} />
        </div>
      );
      break;
    case 'perguntas':
      corpo = (
        <ListaDeItens<ItemDaConfig> itens={itens} onChange={(x) => mudar({ itens: x })}
          novo={() => ({ pergunta: '', resposta: '' })} teto={LIMITE_ITENS} nomeDoItem="pergunta"
          desenhar={(item, trocar, i) => (
            <>
              <Campo id={id(`item-${i}-pergunta`)} rotulo="Pergunta" valor={item.pergunta}
                     onChange={(v) => trocar({ pergunta: v })} />
              <Campo id={id(`item-${i}-resposta`)} rotulo="Resposta" valor={item.resposta} longo linhas={3}
                     onChange={(v) => trocar({ resposta: v })} />
            </>
          )} />
      );
      break;
    case 'chamada':
      corpo = (
        <div className="space-y-3">
          <Campo id={id('texto')} rotulo="Texto" valor={secao.texto} longo linhas={3}
                 onChange={(v) => mudar({ texto: v })} />
          <LinhasDeTexto id={id('itens')} rotulo="Lista com ✓ (um item por linha)"
                         valores={listaDe<unknown>(secao.itens).filter((v): v is string => typeof v === 'string' && !!v.trim())}
                         onChange={(v) => mudar({ itens: v })}
                         placeholder={'O aparelho completo, enviado até você\nA plataforma liberada por 1 mês'} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Campo id={id('botao')} rotulo="Texto do botão" valor={secao.botao}
                   placeholder={BOTAO_DA_CHAMADA_PADRAO} onChange={(v) => mudar({ botao: v })} />
            <Campo id={id('nota')} rotulo="Letra miúda (opcional)" valor={secao.nota}
                   onChange={(v) => mudar({ nota: v })} />
          </div>
          <p className="text-xs text-muted-foreground">
            O botão rola a página até o formulário do topo. Sem texto, usa o do botão do formulário.
          </p>
        </div>
      );
      break;
    case 'certificacoes':
      corpo = (
        <div className="space-y-3">
          <Campo id={id('texto')} rotulo="Texto (opcional)" valor={secao.texto} longo linhas={3}
                 placeholder="Os bafômetros Health Safety são certificados pela ISO 9001 da TÜV NORD."
                 onChange={(v) => mudar({ texto: v })} />
          <ListaDeItens<ItemDaConfig> itens={itens} onChange={(x) => mudar({ itens: x })}
            novo={() => ({ nome: '', imagem_url: '' })} teto={LIMITE_ITENS} nomeDoItem="selo"
            desenhar={(item, trocar, i) => (
              <>
                <Campo id={id(`item-${i}-nome`)} rotulo="Nome (legenda e texto alternativo)" valor={item.nome}
                       placeholder="ISO 9001 — TÜV NORD" onChange={(v) => trocar({ nome: v })} />
                <CampoDeImagem id={id(`item-${i}-imagem`)} rotulo="Selo" valor={texto(item.imagem_url)}
                               onChange={(v) => trocar({ imagem_url: v })} />
              </>
            )} />
          <p className="text-xs text-muted-foreground">Selo sem imagem não aparece na página.</p>
        </div>
      );
      break;
    case 'depoimentos':
      corpo = (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            O primeiro depoimento aparece em destaque. Sem texto ou sem nome, o depoimento não aparece.
          </p>
          <ListaDeItens<ItemDaConfig> itens={itens} onChange={(x) => mudar({ itens: x })}
            novo={() => ({ texto: '', nome: '', cargo: '', empresa: '', logo_url: '' })} teto={LIMITE_ITENS}
            nomeDoItem="depoimento"
            desenhar={(item, trocar, i) => (
              <>
                <Campo id={id(`item-${i}-texto`)} rotulo="Depoimento (sem aspas — a página põe)" valor={item.texto}
                       longo linhas={3} onChange={(v) => trocar({ texto: v })} />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <Campo id={id(`item-${i}-nome`)} rotulo="Nome" valor={item.nome}
                         onChange={(v) => trocar({ nome: v })} />
                  <Campo id={id(`item-${i}-cargo`)} rotulo="Cargo (opcional)" valor={item.cargo}
                         onChange={(v) => trocar({ cargo: v })} />
                  <Campo id={id(`item-${i}-empresa`)} rotulo="Empresa (opcional)" valor={item.empresa}
                         onChange={(v) => trocar({ empresa: v })} />
                </div>
                <CampoDeImagem id={id(`item-${i}-logo`)} rotulo="Logo da empresa (opcional)"
                               valor={texto(item.logo_url)} onChange={(v) => trocar({ logo_url: v })} />
              </>
            )} />
        </div>
      );
      break;
    case 'video': {
      const url = texto(secao.url);
      const invalida = !!url.trim() && !idDoYoutube(url);
      const temArquivo = !!idDoVideoHospedado(secao.arquivo_url);
      corpo = (
        <div className="space-y-3">
          <CampoDeVideo id={id('arquivo')} valor={texto(secao.arquivo_url)}
                        onChange={(v) => mudar({ arquivo_url: v })} />
          {temArquivo && (
            <CampoDeImagem id={id('capa')} rotulo="Capa do vídeo (opcional)" valor={texto(secao.imagem_url)}
                           onChange={(v) => mudar({ imagem_url: v })}
                           ajuda="A imagem que aparece antes do play. Sem capa, o navegador mostra o primeiro quadro (no iPhone, o quadro fica escuro até o play)." />
          )}
          <div className="space-y-1">
            <Label htmlFor={id('url')} className="text-xs">
              {temArquivo ? 'Link do YouTube (não usado: o arquivo acima vale)' : 'Link do YouTube'}
            </Label>
            <Input id={id('url')} value={url} placeholder="https://www.youtube.com/watch?v=…"
                   aria-invalid={invalida || undefined}
                   aria-describedby={invalida ? id('url-erro') : undefined}
                   onChange={(e) => mudar({ url: e.target.value })} />
            {invalida ? (
              <p id={id('url-erro')} className="text-xs text-[--on-tint-danger]">
                Link não aceito: use o endereço do vídeo no YouTube (youtube.com/watch?v=…, youtu.be/…,
                youtube.com/shorts/… ou youtube.com/embed/…). O servidor recusa, e nenhuma alteração da página é
                salva até corrigir.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Na página aparece só a miniatura; o vídeo carrega quando a pessoa clica.
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Formato do vídeo</Label>
            <Select value={secao.formato === 'vertical' ? 'vertical' : 'horizontal'}
                    onValueChange={(v) => mudar({ formato: v as 'horizontal' | 'vertical' })}>
              <SelectTrigger aria-label="Formato do vídeo" className="w-64"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="horizontal">Deitado (16:9)</SelectItem>
                <SelectItem value="vertical">Em pé (celular, Shorts)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Campo id={id('texto')} rotulo="Texto ao lado (opcional)" valor={secao.texto} longo linhas={3}
                 onChange={(v) => mudar({ texto: v })} />
        </div>
      );
      break;
    }
  }

  return (
    <div className="space-y-3">
      {cabeca}
      {corpo}
    </div>
  );
}
