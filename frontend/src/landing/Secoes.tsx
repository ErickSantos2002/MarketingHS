import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type SyntheticEvent } from "react";
import type { BlocoDoCorpo } from "./campos";
import { miniaturaDoYoutube, type Secao } from "./secoes";
import {
  ESTADO, SALTO, alvoDoSeek, alvoNoArquivo, carregarApiDoYoutube, chegouAoFim, formatarTempo, opcoesDoPlayer,
  tempoPorExtenso, type PlayerDoYoutube,
} from "./player";

// Colunas da grade no desktop: o maior divisor de `n` até `teto`, para não
// sobrar um cartão órfão na última linha (4 cartões viram 2×2, 8 logos 4×2).
// Sem divisor bom, o teto. No celular a grade é `auto-fit` (landing.css).
function colunas(n: number, teto: number): CSSProperties {
  let c = Math.min(n, teto);
  while (c > 2 && n % c !== 0) c--;
  if (n > teto && n % c !== 0) c = teto;
  return { "--colunas": c } as CSSProperties;
}

// As seções da landing, depois do topo (frente landing-secoes, 26/10).
//
// Recebem a lista já lida por `secoesDaConfig` — tipo conhecido, texto
// aparado, imagem só http(s). Mesmo assim, tudo aqui é texto puro: nunca
// `dangerouslySetInnerHTML`. A config é editada no admin, mas a página é
// pública, e HTML colado viraria script.

type DaSecao<T extends Secao["tipo"]> = Extract<Secao, { tipo: T }>;

// O primeiro campo de verdade do formulário do topo — nunca a isca
// (`.captura-isca`), que fica fora da tela e fora do Tab.
const PRIMEIRO_CAMPO = [
  "#formulario .captura-campo input",
  "#formulario .captura-campo select",
  "#formulario .captura-campo textarea",
  "#formulario .captura-grupo input",
].join(", ");

// O botão da chamada é uma âncora (`#formulario`): sem JS, ou se algo falhar
// aqui, o navegador ainda rola até o formulário. Com JS, rola suave e põe o
// foco no primeiro campo — a pessoa clicou para preencher.
function irParaFormulario(evento: MouseEvent<HTMLAnchorElement>) {
  const alvo = document.getElementById("formulario");
  if (!alvo) return;
  evento.preventDefault();
  const suave = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  alvo.scrollIntoView({ behavior: suave ? "smooth" : "auto", block: "start" });
  document.querySelector<HTMLElement>(PRIMEIRO_CAMPO)?.focus({ preventScroll: true });
}

function Cabeca({ secao, idTitulo }: { secao: Secao; idTitulo: string }) {
  if (!secao.titulo && !secao.subtitulo) return null;
  return (
    <header className="secao-cabeca">
      {secao.titulo && <h2 id={idTitulo}>{secao.titulo}</h2>}
      {secao.subtitulo && <p className="secao-sub">{secao.subtitulo}</p>}
    </header>
  );
}

export function Numeros({ secao }: { secao: DaSecao<"numeros"> }) {
  return (
    <ul className="numeros">
      {secao.itens.map((item, i) => (
        <li key={i}>
          <strong className="numeros-valor">{item.valor}</strong>
          {item.rotulo && <span className="numeros-rotulo">{item.rotulo}</span>}
        </li>
      ))}
    </ul>
  );
}

// Uma tabela de verdade (leitor de tela anuncia linha e coluna). No celular o
// CSS empilha cada linha num cartão e o `data-rotulo` vira o nome da coluna
// ao lado do valor — sem rolagem horizontal da página.
function Comparativo({ secao }: { secao: DaSecao<"comparativo"> }) {
  const { a, b } = secao.colunas;
  return (
    <div className="comparativo">
      <table>
        <thead>
          <tr>
            <td aria-hidden="true" />
            <th scope="col">{a}</th>
            <th scope="col" className="comparativo-b">{b}</th>
          </tr>
        </thead>
        <tbody>
          {secao.linhas.map((linha, i) => (
            <tr key={i}>
              <th scope="row">{linha.criterio}</th>
              <td data-rotulo={a}>{linha.a || "—"}</td>
              <td data-rotulo={b} className="comparativo-b">{linha.b || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Passos({ secao }: { secao: DaSecao<"passos"> }) {
  return (
    <ol className="passos">
      {secao.itens.map((item, i) => (
        <li key={i}>
          <span className="passos-numero" aria-hidden="true">{i + 1}</span>
          <div>
            {item.titulo && <h3>{item.titulo}</h3>}
            {item.texto && <p>{item.texto}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

// Com foto, a foto manda: até 4 por linha, sem caixa em volta. Sem foto, uma
// lista em grade com fio no topo de cada item (landing.css).
function Cartoes({ secao }: { secao: DaSecao<"cartoes"> }) {
  const comFoto = secao.itens.some((item) => item.imagem);
  return (
    <ul className={comFoto ? "cartoes cartoes-com-foto" : "cartoes"}
        style={colunas(secao.itens.length, comFoto ? 4 : 3)}>
      {secao.itens.map((item, i) => (
        <li key={i} className={item.imagem ? "cartao cartao-com-imagem" : "cartao"}>
          {/* Alt vazio: a imagem ilustra o título que vem logo abaixo. */}
          {item.imagem && <img src={item.imagem} alt="" loading="lazy" />}
          <div className="cartao-texto">
            {item.titulo && <h3>{item.titulo}</h3>}
            {item.texto && <p>{item.texto}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function TextoImagem({ secao, idTitulo }: { secao: DaSecao<"texto_imagem">; idTitulo: string }) {
  return (
    <div className={["texto-imagem", secao.imagem && "texto-imagem-com-imagem",
                     secao.lado === "esquerda" && "texto-imagem-esquerda"].filter(Boolean).join(" ")}>
      <div className="texto-imagem-texto">
        <Cabeca secao={secao} idTitulo={idTitulo} />
        <Blocos blocos={secao.blocos} />
      </div>
      {secao.imagem && (
        <img className="texto-imagem-foto" src={secao.imagem} alt={secao.titulo} loading="lazy" />
      )}
    </div>
  );
}

// Logos têm proporções muito diferentes (CCR é quadrado, Mineração Caraíba é
// quatro vezes mais largo que alto). Mesma altura para todos faria o quadrado
// sumir; mesma largura faria o largo gritar. A altura sai da proporção
// (raiz quadrada, o ajuste de peso visual usual), entre 34 e 76 px.
function alturaDoLogo(largura: number, altura: number): number {
  if (!largura || !altura) return 44;
  const proporcao = largura / altura;
  return Math.round(Math.min(76, Math.max(34, 46 * Math.sqrt(2.6 / proporcao))));
}

function ImagemDeLogo({ src, nome, className }: { src: string; nome: string; className?: string }) {
  const [altura, setAltura] = useState<number | null>(null);
  const aoCarregar = (e: SyntheticEvent<HTMLImageElement>) =>
    setAltura(alturaDoLogo(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight));
  return (
    <img className={className} src={src} alt={nome} loading="lazy" onLoad={aoCarregar}
         style={altura ? ({ "--altura-logo": `${altura}px` } as CSSProperties) : undefined} />
  );
}

// Logo sem arquivo ainda aparece como o nome em texto, no mesmo ladrilho —
// a grade fica alinhada com ou sem imagem.
//
// Quatro colunas fixas no desktop (pedido do Nicholson, 27/10), e não o
// maior divisor de `colunas()`: com 14 logos, o divisor dava 2 colunas de
// logo gigante. A última linha pode ficar incompleta — é uma lista, não um
// mosaico. Menos de 4 logos, uma coluna por logo.
function Logos({ secao }: { secao: DaSecao<"logos"> }) {
  const n = secao.itens.length;
  const estilo = { "--colunas": Math.min(n, 4), "--colunas-meio": Math.min(n, 3) } as CSSProperties;
  return (
    <ul className="logos" style={estilo}>
      {secao.itens.map((item, i) => (
        <li key={i}>
          {item.imagem
            ? <ImagemDeLogo src={item.imagem} nome={item.nome} />
            : <span>{item.nome}</span>}
        </li>
      ))}
    </ul>
  );
}

// `<details>`/`<summary>`: abre e fecha sem JS, e o leitor de tela já
// anuncia como expansível.
function Perguntas({ secao }: { secao: DaSecao<"perguntas"> }) {
  return (
    <div className="perguntas">
      {secao.itens.map((item, i) => (
        <details key={i}>
          <summary>{item.pergunta}</summary>
          <p>{item.resposta}</p>
        </details>
      ))}
    </div>
  );
}

function Chamada({ secao, idTitulo }: { secao: DaSecao<"chamada">; idTitulo: string }) {
  return (
    <div className="chamada">
      <div className="chamada-texto-bloco">
        <Cabeca secao={secao} idTitulo={idTitulo} />
        {secao.texto && <p className="chamada-texto">{secao.texto}</p>}
        {secao.itens.length > 0 && (
          <ul className="chamada-itens">
            {secao.itens.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        )}
      </div>
      <div className="chamada-acao">
        <a className="chamada-botao" href="#formulario" onClick={irParaFormulario}>{secao.botao}</a>
        {secao.nota && <p className="chamada-nota">{secao.nota}</p>}
      </div>
    </div>
  );
}

// Parágrafos e listas do texto de uma seção (a regra do `corpo`).
function Blocos({ blocos }: { blocos: BlocoDoCorpo[] }) {
  return (
    <>
      {blocos.map((bloco, i) => bloco.tipo === "p"
        ? <p key={i}>{bloco.texto}</p>
        : <ul key={i}>{bloco.itens.map((item, j) => <li key={j}>{item}</li>)}</ul>)}
    </>
  );
}

// Selos ao lado do texto (no celular, abaixo). O selo é a prova: grande,
// na cor original, com o nome embaixo — o mesmo nome é o alt, então o
// leitor de tela ouve "ISO 9001" uma vez só (legenda `aria-hidden`).
function Certificacoes({ secao, idTitulo }: { secao: DaSecao<"certificacoes">; idTitulo: string }) {
  return (
    <div className="certificacoes">
      <div className="certificacoes-texto">
        <Cabeca secao={secao} idTitulo={idTitulo} />
        <Blocos blocos={secao.blocos} />
      </div>
      <ul className="selos">
        {secao.itens.map((item, i) => (
          <li key={i}>
            <img src={item.imagem} alt={item.nome || "Selo de certificação"} loading="lazy" />
            {item.nome && <span aria-hidden="true">{item.nome}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

// A primeira citação abre em corpo grande; as outras seguem em colunas,
// menores. Aspas tipográficas penduradas na margem (`.depoimento p`), sem
// caixa, sem ícone de pessoa: o que dá peso é o nome e a empresa.
function Depoimentos({ secao }: { secao: DaSecao<"depoimentos"> }) {
  return (
    <ul className="depoimentos" style={colunas(Math.max(secao.itens.length - 1, 1), 3)}>
      {secao.itens.map((item, i) => {
        const quem = [item.cargo, item.empresa].filter(Boolean).join(", ");
        return (
          <li key={i} className={i === 0 ? "depoimento depoimento-destaque" : "depoimento"}>
            <figure>
              <blockquote>
                <p>“{item.texto}”</p>
              </blockquote>
              {/* O logo vem depois do nome, pequeno, com alt vazio: a
                  empresa já está escrita (e, sem ela, o logo é enfeite). A
                  altura sai da proporção, como na seção de logos. */}
              <figcaption>
                <span className="depoimento-quem">
                  <strong>{item.nome}</strong>
                  {quem && <span>{quem}</span>}
                </span>
                {item.logo && <ImagemDeLogo className="depoimento-logo" src={item.logo} nome="" />}
              </figcaption>
            </figure>
          </li>
        );
      })}
    </ul>
  );
}

// O vídeo: fachada até o clique, depois o player FECHADO (frente
// landing-nicholson, 27/10). Pedido do Nicholson: quem assiste só dá play,
// pausa, avança e volta — não sai da página para o YouTube e não vê as
// recomendações no fim.
//
// - Até o clique, só a miniatura (de i.ytimg.com) e um botão: nenhum script
//   nem cookie do YouTube carrega antes de a pessoa pedir.
// - O clique carrega a IFrame API (`player.ts`) e monta o player
//   youtube-nocookie SEM os controles do YouTube.
// - O iframe fica numa caixa `inert` + `aria-hidden` (nem Tab, nem leitor
//   de tela, nem clique entram nele) e debaixo de um escudo transparente
//   que recebe todo clique — inclusive o botão direito, que no iframe daria
//   o menu "copiar URL do vídeo".
// - Os controles são nossos, embaixo do quadro: play/pausa, ±10 s e a barra
//   de tempo (um `<input type="range">`, que já é acessível por teclado).
// - Pausado, carregando ou no fim, a miniatura cobre o iframe: é ali que o
//   YouTube põe o "mais vídeos" e o título. No fim, o vídeo é pausado um
//   segundo e meio antes de acabar (`FOLGA_DO_FIM`) e volta a fachada, com
//   "Assistir de novo" — a grade de recomendações do `ENDED` não chega a
//   aparecer.
type FaseDoVideo = "fachada" | "carregando" | "tocando" | "pausado" | "fim" | "erro";

// Se o navegador recusar o autoplay (o clique foi na nossa página, não no
// iframe), o player fica parado; depois disto, a fase vira "pausado" e o
// nosso botão de play aparece.
const ESPERA_DO_AUTOPLAY_MS = 2500;
// Sem o player pronto neste prazo, a fase vira "erro" (com "tentar de novo").
const PRAZO_DO_PLAYER_MS = 15000;

const ICONES = {
  play: "M8 5.5v13l10.5-6.5z",
  pausa: "M7 5h3.5v14H7zM13.5 5H17v14h-3.5z",
  voltar: "M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z",
  avancar: "M12 5V2l5 4-5 4V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z",
  telaCheia: "M5 5h5v2H7v3H5zm9 0h5v5h-2V7h-3zM5 14h2v3h3v2H5zm12 0h2v5h-5v-2h3z",
  sairDaTelaCheia: "M8 5h2v5H5V8h3zm6 0h2v3h3v2h-5zM5 14h5v5H8v-3H5zm9 0h5v2h-3v3h-2z",
} as const;

// `numero`: o "10" dentro da seta dos saltos.
function IconeDoVideo({ tipo, numero }: { tipo: keyof typeof ICONES; numero?: number }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" focusable="false" aria-hidden="true">
      <path fill="currentColor" d={ICONES[tipo]} />
      {numero !== undefined && (
        <text x="12" y="15.6" textAnchor="middle" fontSize="7" fontWeight="700" fill="currentColor">{numero}</text>
      )}
    </svg>
  );
}

function Video({ secao, idTitulo }: { secao: DaSecao<"video">; idTitulo: string }) {
  const [fase, setFase] = useState<FaseDoVideo>("fachada");
  // Cada "tentar de novo" remonta o player do zero.
  const [tentativa, setTentativa] = useState(0);
  const [pronto, setPronto] = useState(false);
  const [atual, setAtual] = useState(0);
  const [duracao, setDuracao] = useState(0);
  // O furo: o autoplay foi recusado e o vídeo nunca tocou (Safari/iPhone,
  // que não repassa ao iframe o gesto feito na nossa página). Só então um
  // quadrado no MEIO do escudo deixa o toque chegar ao iframe — ali, com
  // `controls=0`, só há o play do próprio YouTube, longe do título e do
  // logo. Fecha no primeiro PLAYING e não volta.
  const [furo, setFuro] = useState(false);
  // `maxresdefault` não existe em todo vídeo — e quando falta, o YouTube
  // devolve 200 com um cinza de 120×90, não um erro. Os dois casos caem no
  // `hqdefault`, que todo vídeo tem.
  const [grande, setGrande] = useState(true);
  const caixa = useRef<HTMLDivElement>(null);
  const player = useRef<PlayerDoYoutube | null>(null);
  const botaoPlay = useRef<HTMLButtonElement>(null);
  const botaoTentar = useRef<HTMLButtonElement>(null);
  // O que a pessoa pediu por último (tocar ou não). Os eventos do YouTube
  // chegam atrasados: um PLAYING que chega depois de um "pausar" não pode
  // tirar a capa — ele vira `pauseVideo()`.
  const querTocar = useRef(false);
  const jaTocou = useRef(false);
  // Arrastando a barra, o relógio não mexe no `atual` (o botão pularia).
  const arrastando = useRef(false);
  // O furo também é lido dentro dos eventos do YouTube.
  const furoAberto = useRef(false);
  furoAberto.current = furo;
  const iniciado = fase !== "fachada";

  const rotulo = secao.titulo ? `Assistir ao vídeo: ${secao.titulo}` : "Assistir ao vídeo";
  const temTexto = !!(secao.titulo || secao.subtitulo || secao.blocos.length);

  // Monta o player quando a fachada sai (e em cada "tentar de novo").
  useEffect(() => {
    if (!iniciado) return;
    const alvo = caixa.current;
    if (!alvo) return;
    let vivo = true;
    let criado: PlayerDoYoutube | null = null;
    let espera: number | undefined;
    querTocar.current = true;  // o clique na fachada foi o play
    jaTocou.current = false;
    // Sem `onReady` neste prazo (script do YouTube bloqueado, rede ruim),
    // erro com "tentar de novo" — e não um anel girando para sempre.
    let expirou = false;
    const prazo = window.setTimeout(() => {
      expirou = true;
      if (vivo) setFase("erro");
    }, PRAZO_DO_PLAYER_MS);
    // A API TROCA o elemento que recebe pelo iframe: ele nasce aqui, fora do
    // React, para o React nunca perder um nó que acha que é dele.
    const ponto = document.createElement("div");
    alvo.appendChild(ponto);
    carregarApiDoYoutube().then((Player) => {
      if (!vivo) return;
      criado = new Player(ponto, {
        ...opcoesDoPlayer(secao.video, window.location.origin),
        events: {
          onReady: (e) => {
            // Atrasado demais: a tela já diz "erro"; tocar por baixo dela
            // seria som sem imagem. O "tentar de novo" remonta tudo.
            if (!vivo || expirou) return;
            window.clearTimeout(prazo);
            player.current = e.target;
            e.target.getIframe().setAttribute("tabindex", "-1");
            setDuracao(e.target.getDuration() || 0);
            setPronto(true);
            if (querTocar.current) e.target.playVideo();
            espera = window.setTimeout(() => {
              if (!vivo || jaTocou.current) return;
              // Recusado: o próximo play é pedido novo, não pausa.
              querTocar.current = false;
              setFase((f) => (f === "carregando" ? "pausado" : f));
              setFuro(true);
            }, ESPERA_DO_AUTOPLAY_MS);
          },
          onStateChange: (e) => {
            if (!vivo) return;
            const d = e.target.getDuration();
            if (d > 0) setDuracao(d);
            if (e.data === ESTADO.tocando) {
              jaTocou.current = true;
              setFuro(false);
              // Tocou pelo furo (toque direto no iframe): conta como pedido.
              if (!querTocar.current && furoAberto.current) querTocar.current = true;
              if (querTocar.current) setFase("tocando");
              else e.target.pauseVideo();
            } else if (e.data === ESTADO.pausado) {
              setFase((f) => (f === "fim" ? f : "pausado"));
            } else if (e.data === ESTADO.terminado) {
              // Chegou ao fim entre duas leituras (aba em segundo plano, por
              // exemplo): a fachada cobre na hora.
              querTocar.current = false;
              setAtual(d > 0 ? d : 0);
              setFase("fim");
            }
          },
          onError: () => { if (vivo) setFase("erro"); },
        },
      });
    }).catch(() => { if (vivo) setFase("erro"); });
    return () => {
      vivo = false;
      window.clearTimeout(espera);
      window.clearTimeout(prazo);
      try { criado?.destroy(); } catch { /* o player já não existe */ }
      player.current = null;
      setPronto(false);
      setFuro(false);
      alvo.replaceChildren();
    };
    // `fase` fica de fora de propósito: o player nasce uma vez por tentativa.
  }, [iniciado, tentativa, secao.video]);

  // O `title` do iframe acompanha o da seção sem remontar o player (na
  // prévia do editor, o título muda a cada tecla).
  useEffect(() => {
    if (pronto) player.current?.getIframe().setAttribute("title", secao.titulo || "Vídeo");
  }, [pronto, secao.titulo]);

  // `inert` (o React 18 não conhece o atributo): nem Tab, nem clique, nem
  // leitor de tela entram no iframe — a não ser pelo furo.
  useLayoutEffect(() => {
    const el = caixa.current;
    if (!el) return;
    if (furo) el.removeAttribute("inert");
    else el.setAttribute("inert", "");
  }, [furo, iniciado]);

  // Tocando, lê o tempo quatro vezes por segundo — e pausa na folga do fim.
  useEffect(() => {
    if (fase !== "tocando") return;
    const relogio = window.setInterval(() => {
      const p = player.current;
      if (!p) return;
      const t = p.getCurrentTime();
      const d = p.getDuration();
      if (!arrastando.current) setAtual(t);
      if (d > 0) setDuracao(d);
      if (chegouAoFim(t, d)) {
        querTocar.current = false;
        p.pauseVideo();
        setAtual(d);  // a barra fecha cheia: acabou
        setFase("fim");
      }
    }, 250);
    return () => window.clearInterval(relogio);
  }, [fase]);

  // O foco vai para o play/pausa quando o player fica pronto: a pessoa
  // pediu o vídeo, e é dali que ela o controla. No erro, para o "tentar".
  useEffect(() => {
    if (pronto) botaoPlay.current?.focus({ preventScroll: true });
  }, [pronto]);
  useEffect(() => {
    if (fase === "erro") botaoTentar.current?.focus({ preventScroll: true });
  }, [fase]);

  // `final`: arrastando, o seek é só visual (`allowSeekAhead=false`, como a
  // API recomenda); ao soltar (ou pelo teclado), busca de verdade.
  const irPara = (segundos: number, final = true) => {
    const p = player.current;
    if (!p) return;
    const alvo = alvoDoSeek(segundos, duracao);
    p.seekTo(alvo, final);
    setAtual(alvo);
    // Voltou do fim: fica pausado onde a pessoa pôs, coberto, até o play.
    if (fase === "fim") setFase("pausado");
  };

  const soltarBarra = (valor: number) => {
    if (!arrastando.current) return;
    arrastando.current = false;
    irPara(valor, true);
  };

  const alternar = () => {
    const p = player.current;
    if (!p) return;
    if (querTocar.current && fase !== "fim") {
      // A capa entra já, sem esperar o evento do YouTube: o "mais vídeos"
      // da pausa aparece no primeiro quadro pausado.
      querTocar.current = false;
      setFase("pausado");
      p.pauseVideo();
    } else if (fase === "fim") {
      querTocar.current = true;
      p.seekTo(0, true);
      setAtual(0);
      setFase("carregando");
      p.playVideo();
    } else {
      querTocar.current = true;
      p.playVideo();
    }
  };

  const tentarDeNovo = () => {
    setFase("carregando");
    setTentativa((n) => n + 1);
  };

  const miniatura = (
    <img src={miniaturaDoYoutube(secao.video, grande)} alt="" loading="lazy"
         onLoad={(e) => { if (grande && e.currentTarget.naturalWidth <= 120) setGrande(false); }}
         onError={() => { if (grande) setGrande(false); }} />
  );
  const coberto = fase !== "tocando";
  const ativo = pronto && fase !== "erro";
  const posicao = Math.min(atual, duracao || 0);
  const progresso = duracao ? `${(posicao / duracao) * 100}%` : "0%";
  const pausaria = fase === "tocando" || (fase === "carregando" && querTocar.current);
  const rotuloDoPlay = pausaria ? "Pausar" : fase === "fim" ? "Assistir de novo" : "Reproduzir";

  return (
    <div className={["video", temTexto && "video-com-texto", secao.vertical && "video-vertical"]
                    .filter(Boolean).join(" ")}>
      {temTexto && (
        <div className="video-texto">
          <Cabeca secao={secao} idTitulo={idTitulo} />
          <Blocos blocos={secao.blocos} />
        </div>
      )}
      <div className={iniciado ? "video-palco video-palco-ativo" : "video-palco"}>
        <div className="video-quadro">
          {!iniciado ? (
            <button type="button" className="video-fachada" aria-label={rotulo} onClick={() => setFase("carregando")}>
              {miniatura}
              <span className="video-play" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="28" height="28" focusable="false">
                  <path fill="currentColor" d={ICONES.play} />
                </svg>
              </span>
            </button>
          ) : (
            <>
              <div ref={caixa} className={furo ? "video-iframe video-iframe-furo" : "video-iframe"}
                   aria-hidden="true" />
              {/* O escudo: todo clique no quadro para aqui e vira play/pausa.
                  Nada chega ao iframe. Teclado e leitor de tela usam os
                  controles de baixo. */}
              <div className={["video-escudo", coberto && "video-escudo-coberto", furo && "video-escudo-furo"]
                                .filter(Boolean).join(" ")}
                   aria-hidden="true"
                   onClick={fase === "fim" || fase === "erro" ? undefined : alternar}
                   onContextMenu={(e) => e.preventDefault()}>
                {coberto && miniatura}
                {fase === "carregando" && <span className="video-carregando" />}
                {fase === "pausado" && (
                  <span className="video-play"><IconeDoVideo tipo="play" /></span>
                )}
              </div>
              {fase === "fim" && (
                <button type="button" className="video-de-novo" onClick={alternar}>
                  <IconeDoVideo tipo="voltar" />
                  Assistir de novo
                </button>
              )}
              {fase === "erro" && (
                <div className="video-erro" role="alert">
                  <p>Não foi possível carregar o vídeo agora.</p>
                  <button type="button" ref={botaoTentar} onClick={tentarDeNovo}>Tentar de novo</button>
                </div>
              )}
            </>
          )}
        </div>
        {iniciado && (
          <div className="video-controles" role="group" aria-label="Controles do vídeo">
            <input type="range" className="video-barra" min={0} max={duracao > 0 ? duracao : 1} step={1}
                   value={posicao} disabled={!ativo || !duracao}
                   aria-label="Posição no vídeo"
                   aria-valuetext={`${tempoPorExtenso(posicao)} de ${tempoPorExtenso(duracao)}`}
                   style={{ "--progresso": progresso } as CSSProperties}
                   onPointerDown={() => { arrastando.current = true; }}
                   onPointerUp={(e) => soltarBarra(Number(e.currentTarget.value))}
                   onPointerCancel={(e) => soltarBarra(Number(e.currentTarget.value))}
                   onChange={(e) => irPara(Number(e.currentTarget.value), !arrastando.current)} />
            <div className="video-botoes">
              <button type="button" className="video-botao" onClick={() => irPara(atual - SALTO)}
                      disabled={!ativo} aria-label={`Voltar ${SALTO} segundos`}>
                <IconeDoVideo tipo="voltar" numero={SALTO} />
              </button>
              <button type="button" ref={botaoPlay} className="video-botao video-botao-play"
                      onClick={alternar} disabled={!ativo} aria-label={rotuloDoPlay}>
                <IconeDoVideo tipo={pausaria ? "pausa" : "play"} />
              </button>
              <button type="button" className="video-botao" onClick={() => irPara(atual + SALTO)}
                      disabled={!ativo} aria-label={`Avançar ${SALTO} segundos`}>
                <IconeDoVideo tipo="avancar" numero={SALTO} />
              </button>
              <span className="video-tempo" aria-hidden="true">
                {formatarTempo(posicao)} <span className="video-tempo-total">/ {formatarTempo(duracao)}</span>
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── O vídeo hospedado (frente video-proprio, 29/10/2026) ─────────────────────
//
// Quando a seção tem arquivo subido no editor, a página toca num `<video>`
// nosso, servido pelo nosso domínio com Range (o Safari do iPhone exige):
// nada do YouTube — nem cromo de título e "mais vídeos", nem id no HTML,
// nem recomendações no fim. Os controles são os MESMOS do player fechado
// (mesmas classes do landing.css): play/pausa, ±10 s, barra de tempo, tempo
// — mais tela cheia, que aqui é segura (é o nosso quadro, não o YouTube).
//
// - `preload="metadata"` + `poster` (a capa do editor): antes do play, só o
//   cabeçalho do arquivo desce, não o vídeo.
// - `playsInline`: no iPhone, toca na página e não pula para tela cheia.
// - Sem autoplay: o primeiro play é o clique da pessoa (que também é o gesto
//   que o Safari exige para tocar com som).
// - Tela cheia: o palco inteiro (quadro + nossos controles) onde o navegador
//   deixa; no iPhone, que só põe o próprio `<video>` em tela cheia, a do
//   sistema (`webkitEnterFullscreen`), com os controles nativos.
type FaseDoArquivo = "parado" | "tocando" | "pausado" | "fim" | "erro";

type VideoDoSafari = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

function VideoHospedado({ secao, idTitulo }: { secao: DaSecao<"video">; idTitulo: string }) {
  const [fase, setFase] = useState<FaseDoArquivo>("parado");
  const [esperando, setEsperando] = useState(false);
  const [atual, setAtual] = useState(0);
  const [duracao, setDuracao] = useState(0);
  const [cheia, setCheia] = useState(false);
  const video = useRef<VideoDoSafari>(null);
  const palco = useRef<HTMLDivElement>(null);
  const botaoPlay = useRef<HTMLButtonElement>(null);
  const botaoTentar = useRef<HTMLButtonElement>(null);
  // Arrastando a barra, o `timeupdate` não mexe no `atual` (o botão pularia).
  const arrastando = useRef(false);
  const iniciado = fase !== "parado";

  const rotulo = secao.titulo ? `Assistir ao vídeo: ${secao.titulo}` : "Assistir ao vídeo";
  const temTexto = !!(secao.titulo || secao.subtitulo || secao.blocos.length);

  useEffect(() => {
    const mudou = () => setCheia(!!palco.current && document.fullscreenElement === palco.current);
    document.addEventListener("fullscreenchange", mudou);
    return () => document.removeEventListener("fullscreenchange", mudou);
  }, []);

  useEffect(() => {
    if (fase === "erro") botaoTentar.current?.focus({ preventScroll: true });
  }, [fase]);

  const tocar = () => {
    const v = video.current;
    if (!v) return;
    if (v.ended) v.currentTime = 0;
    // Recusado (economia de dados, política do navegador): fica pausado, e o
    // nosso play continua lá para a próxima tentativa.
    v.play().catch(() => setFase((f) => (f === "erro" ? f : "pausado")));
  };

  const comecar = () => {
    setFase("pausado");
    tocar();
    // O botão da fachada some; o foco vai para o play/pausa, de onde a
    // pessoa controla o vídeo (como no player do YouTube).
    window.setTimeout(() => botaoPlay.current?.focus({ preventScroll: true }), 0);
  };

  const alternar = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused || v.ended) tocar();
    else v.pause();
  };

  const irPara = (segundos: number) => {
    const v = video.current;
    if (!v) return;
    const alvo = alvoNoArquivo(segundos, duracao);
    v.currentTime = alvo;
    setAtual(alvo);
    if (fase === "fim") setFase("pausado");
  };

  const soltarBarra = (valor: number) => {
    if (!arrastando.current) return;
    arrastando.current = false;
    irPara(valor);
  };

  const telaCheia = () => {
    const v = video.current;
    const p = palco.current;
    if (!v || !p) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else if (typeof p.requestFullscreen === "function" && document.fullscreenEnabled) {
      p.requestFullscreen().catch(() => v.webkitEnterFullscreen?.());
    } else {
      v.webkitEnterFullscreen?.();
    }
  };

  const tentarDeNovo = () => {
    const v = video.current;
    if (!v) return;
    setFase("pausado");
    v.load();
    tocar();
  };

  const lerDuracao = () => {
    const d = video.current?.duration ?? 0;
    if (Number.isFinite(d) && d > 0) setDuracao(d);
  };

  const ativo = iniciado && fase !== "erro";
  const posicao = Math.min(atual, duracao || 0);
  const progresso = duracao ? `${(posicao / duracao) * 100}%` : "0%";
  const pausaria = fase === "tocando";
  const rotuloDoPlay = pausaria ? "Pausar" : fase === "fim" ? "Assistir de novo" : "Reproduzir";

  return (
    <div className={["video", temTexto && "video-com-texto", secao.vertical && "video-vertical"]
                    .filter(Boolean).join(" ")}>
      {temTexto && (
        <div className="video-texto">
          <Cabeca secao={secao} idTitulo={idTitulo} />
          <Blocos blocos={secao.blocos} />
        </div>
      )}
      <div ref={palco} className={iniciado ? "video-palco video-palco-ativo" : "video-palco"}>
        <div className="video-quadro">
          {/* Sem `controls`: os controles são os nossos, embaixo. O clique no
              quadro é play/pausa, como no player do YouTube. */}
          <video ref={video} className="video-arquivo" src={secao.arquivo ?? undefined}
                 poster={secao.capa ?? undefined} preload="metadata" playsInline
                 aria-label={secao.titulo || "Vídeo"} tabIndex={-1}
                 onClick={iniciado && fase !== "erro" && fase !== "fim" ? alternar : undefined}
                 onContextMenu={(e) => e.preventDefault()}
                 onLoadedMetadata={lerDuracao} onDurationChange={lerDuracao}
                 onTimeUpdate={(e) => { if (!arrastando.current) setAtual(e.currentTarget.currentTime); }}
                 onPlay={() => setFase("tocando")}
                 onPause={(e) => { if (!e.currentTarget.ended) setFase((f) => (f === "erro" || f === "parado" ? f : "pausado")); }}
                 onEnded={(e) => { setAtual(e.currentTarget.duration || 0); setFase("fim"); }}
                 onWaiting={() => setEsperando(true)}
                 onPlaying={() => setEsperando(false)}
                 onCanPlay={() => setEsperando(false)}
                 onError={() => { if (iniciado) setFase("erro"); }} />
          {!iniciado ? (
            <button type="button" className="video-fachada video-fachada-arquivo" aria-label={rotulo}
                    onClick={comecar}>
              <span className="video-play" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="28" height="28" focusable="false">
                  <path fill="currentColor" d={ICONES.play} />
                </svg>
              </span>
            </button>
          ) : (
            <>
              {esperando && fase === "tocando" && <span className="video-carregando" aria-hidden="true" />}
              {fase === "pausado" && (
                <span className="video-play video-play-sobre" aria-hidden="true"><IconeDoVideo tipo="play" /></span>
              )}
              {fase === "fim" && (
                <button type="button" className="video-de-novo" onClick={tocar}>
                  <IconeDoVideo tipo="voltar" />
                  Assistir de novo
                </button>
              )}
              {fase === "erro" && (
                <div className="video-erro" role="alert">
                  <p>Não foi possível carregar o vídeo agora.</p>
                  <button type="button" ref={botaoTentar} onClick={tentarDeNovo}>Tentar de novo</button>
                </div>
              )}
            </>
          )}
        </div>
        {iniciado && (
          <div className="video-controles" role="group" aria-label="Controles do vídeo">
            <input type="range" className="video-barra" min={0} max={duracao > 0 ? duracao : 1} step={1}
                   value={posicao} disabled={!ativo || !duracao}
                   aria-label="Posição no vídeo"
                   aria-valuetext={`${tempoPorExtenso(posicao)} de ${tempoPorExtenso(duracao)}`}
                   style={{ "--progresso": progresso } as CSSProperties}
                   onPointerDown={() => { arrastando.current = true; }}
                   onPointerUp={(e) => soltarBarra(Number(e.currentTarget.value))}
                   onPointerCancel={(e) => soltarBarra(Number(e.currentTarget.value))}
                   onChange={(e) => {
                     const t = Number(e.currentTarget.value);
                     if (arrastando.current) setAtual(t);
                     else irPara(t);
                   }} />
            <div className="video-botoes">
              <button type="button" className="video-botao" onClick={() => irPara(atual - SALTO)}
                      disabled={!ativo} aria-label={`Voltar ${SALTO} segundos`}>
                <IconeDoVideo tipo="voltar" numero={SALTO} />
              </button>
              <button type="button" ref={botaoPlay} className="video-botao video-botao-play"
                      onClick={alternar} disabled={!ativo} aria-label={rotuloDoPlay}>
                <IconeDoVideo tipo={pausaria ? "pausa" : "play"} />
              </button>
              <button type="button" className="video-botao" onClick={() => irPara(atual + SALTO)}
                      disabled={!ativo} aria-label={`Avançar ${SALTO} segundos`}>
                <IconeDoVideo tipo="avancar" numero={SALTO} />
              </button>
              <span className="video-tempo" aria-hidden="true">
                {formatarTempo(posicao)} <span className="video-tempo-total">/ {formatarTempo(duracao)}</span>
              </span>
              <button type="button" className="video-botao" onClick={telaCheia} disabled={!ativo}
                      aria-label={cheia ? "Sair da tela cheia" : "Tela cheia"}>
                <IconeDoVideo tipo={cheia ? "sairDaTelaCheia" : "telaCheia"} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Corpo({ secao, idTitulo }: { secao: Secao; idTitulo: string }) {
  switch (secao.tipo) {
    case "numeros": return <Numeros secao={secao} />;
    case "comparativo": return <Comparativo secao={secao} />;
    case "passos": return <Passos secao={secao} />;
    case "cartoes": return <Cartoes secao={secao} />;
    case "texto_imagem": return <TextoImagem secao={secao} idTitulo={idTitulo} />;
    case "logos": return <Logos secao={secao} />;
    case "perguntas": return <Perguntas secao={secao} />;
    case "chamada": return <Chamada secao={secao} idTitulo={idTitulo} />;
    case "certificacoes": return <Certificacoes secao={secao} idTitulo={idTitulo} />;
    case "depoimentos": return <Depoimentos secao={secao} />;
    // `key` pelo id do vídeo: trocou o link, a fachada recomeça (miniatura
    // grande, sem tocar).
    // Com arquivo subido, o `<video>` nosso; senão, o YouTube fechado.
    case "video":
      return secao.arquivo
        ? <VideoHospedado key={secao.arquivo} secao={secao} idTitulo={idTitulo} />
        : <Video key={secao.video} secao={secao} idTitulo={idTitulo} />;
  }
  return null;
}

export function Secoes({ secoes }: { secoes: Secao[] }) {
  return (
    <div className="landing-secoes">
      {secoes.map((secao, i) => {
        // Id do título pela posição, não pelo `id` da config: aquele é texto
        // livre e pode ter espaço, o que quebraria o `aria-labelledby`.
        const idTitulo = `secao-${i}-titulo`;
        // Estes põem o cabeçalho dentro do próprio leiaute (texto ao lado).
        const cabecaPropria = secao.tipo === "texto_imagem" || secao.tipo === "chamada"
          || secao.tipo === "certificacoes" || secao.tipo === "video";
        return (
          <section key={secao.id} className={`secao secao-${secao.tipo}`}
                   aria-labelledby={secao.titulo ? idTitulo : undefined}>
            <div className="secao-miolo">
              {!cabecaPropria && <Cabeca secao={secao} idTitulo={idTitulo} />}
              <Corpo secao={secao} idTitulo={idTitulo} />
            </div>
          </section>
        );
      })}
    </div>
  );
}
