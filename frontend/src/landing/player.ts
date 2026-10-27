// O player fechado do YouTube (frente landing-nicholson, 27/10/2026).
//
// Pedido do Nicholson: quem assiste só pode dar play, pausar, avançar e
// voltar — não pode sair da página para o YouTube, e no fim não podem
// aparecer as recomendações. O caminho é a IFrame Player API sem os
// controles do YouTube (`controls=0`) e com controles nossos por cima; o
// `Video` do `Secoes.tsx` desenha, e aqui fica a parte que se testa no Node.
//
// ⚠️ Só sintaxe apagável (o teste node importa este arquivo direto): nada de
// `enum`, `namespace` nem parâmetro com modificador. `document` e `window` só
// dentro de função, nunca no topo — o Node não tem nenhum dos dois.

/** Faltando menos que isto (em segundos), o vídeo conta como terminado. A
 * tela final do YouTube (a grade de recomendações) aparece no `ENDED`, e o
 * vídeo nunca chega lá: pausamos antes e cobrimos com a fachada.
 *
 * ⚠️ Não é 0,5 s porque o `getDuration()` da API ARREDONDA PARA CIMA:
 * medido em 27/10 com o sByexR1w9vw, a API diz 30 s e o vídeo acaba em
 * 29,00 s. Com folga de meio segundo, o vídeo chegava ao `ENDED` antes de a
 * folga começar. 1,5 s cobre o arredondamento (até 1 s) e as leituras de
 * 250 ms; o que se perde é o último segundo e meio, em geral o logo parado. */
export const FOLGA_DO_FIM = 1.5;
/** O salto dos botões de avançar e voltar. */
export const SALTO = 10;
/** O seek nunca vai além do fim menos isto: cair dentro da folga do fim
 * encerraria o vídeo na hora, e arrastar até o fim parece "quebrou". */
export const MARGEM_DO_SEEK = 2;

/** Estados do player da API (`YT.PlayerState`), sem depender do objeto. */
export const ESTADO = { naoIniciado: -1, terminado: 0, tocando: 1, pausado: 2, carregando: 3, pronto: 5 } as const;

/** "1:05", ou "1:02:05" quando passa de uma hora. Lixo vira "0:00". */
export function formatarTempo(segundos: number): string {
  const total = Number.isFinite(segundos) && segundos > 0 ? Math.floor(segundos) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** O tempo por extenso, para o leitor de tela ("1 minuto e 5 segundos"). */
export function tempoPorExtenso(segundos: number): string {
  const total = Number.isFinite(segundos) && segundos > 0 ? Math.floor(segundos) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const partes: string[] = [];
  if (h) partes.push(`${h} ${h === 1 ? "hora" : "horas"}`);
  if (m) partes.push(`${m} ${m === 1 ? "minuto" : "minutos"}`);
  if (s || !partes.length) partes.push(`${s} ${s === 1 ? "segundo" : "segundos"}`);
  return partes.length > 1 ? `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}` : partes[0];
}

/** Para onde o seek vai: entre 0 e o fim menos a margem. Sem duração ainda
 * (o player não sabe), só não deixa ficar negativo. */
export function alvoDoSeek(segundos: number, duracao: number): number {
  const alvo = Number.isFinite(segundos) ? segundos : 0;
  if (!(duracao > 0)) return Math.max(0, alvo);
  return Math.min(Math.max(0, alvo), Math.max(0, duracao - MARGEM_DO_SEEK));
}

/** Se o vídeo já está na folga do fim (e deve virar fachada). */
export function chegouAoFim(atual: number, duracao: number): boolean {
  return duracao > 0 && Number.isFinite(atual) && duracao - atual < FOLGA_DO_FIM;
}

/** As opções do `new YT.Player(...)`. O id já passou pela régua de
 * `idDoYoutube`; `origem` é o `location.origin` da página (a API exige para
 * aceitar os comandos por `postMessage`). */
export function opcoesDoPlayer(id: string, origem: string) {
  return {
    videoId: id,
    host: "https://www.youtube-nocookie.com",
    width: "100%",
    height: "100%",
    playerVars: {
      autoplay: 1,         // o clique na fachada já foi o play
      controls: 0,         // sem a barra do YouTube (e o logo dela)
      disablekb: 1,        // sem os atalhos de teclado do YouTube
      fs: 0,               // sem o botão de tela cheia
      rel: 0,              // recomendações, se aparecerem, só do mesmo canal
      iv_load_policy: 3,   // sem anotações
      playsinline: 1,      // no iPhone, toca na página e não em tela cheia
      modestbranding: 1,   // obsoleto no YouTube, inofensivo
      enablejsapi: 1,
      origin: origem,
    },
  };
}

export const URL_DA_API = "https://www.youtube.com/iframe_api";

// ── O carregador da API ──────────────────────────────────────────────────────
// Uma vez por página: o script define `window.YT` e chama
// `window.onYouTubeIframeAPIReady`. Falhou (bloqueador de anúncio, rede),
// a promessa rejeita e a próxima tentativa recomeça do zero.

export type PlayerDoYoutube = {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(segundos: number, permitirBuscaAdiante: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getIframe(): HTMLIFrameElement;
  destroy(): void;
};

export type EventoDoPlayer = { data: number; target: PlayerDoYoutube };

type ConstrutorDoPlayer = new (
  alvo: HTMLElement,
  opcoes: ReturnType<typeof opcoesDoPlayer> & {
    events: {
      onReady?: (e: EventoDoPlayer) => void;
      onStateChange?: (e: EventoDoPlayer) => void;
      onError?: (e: EventoDoPlayer) => void;
    };
  },
) => PlayerDoYoutube;

type JanelaComYoutube = Window & {
  YT?: { Player?: ConstrutorDoPlayer };
  onYouTubeIframeAPIReady?: () => void;
};

let carregando: Promise<ConstrutorDoPlayer> | null = null;

export function carregarApiDoYoutube(): Promise<ConstrutorDoPlayer> {
  const janela = window as JanelaComYoutube;
  if (janela.YT?.Player) return Promise.resolve(janela.YT.Player);
  if (carregando) return carregando;
  carregando = new Promise<ConstrutorDoPlayer>((resolver, rejeitar) => {
    const anterior = janela.onYouTubeIframeAPIReady;
    janela.onYouTubeIframeAPIReady = () => {
      anterior?.();
      if (janela.YT?.Player) resolver(janela.YT.Player);
      else rejeitar(new Error("API do YouTube sem Player"));
    };
    const script = document.createElement("script");
    script.src = URL_DA_API;
    script.async = true;
    script.onerror = () => {
      script.remove();
      rejeitar(new Error("API do YouTube não carregou"));
    };
    document.head.appendChild(script);
  }).catch((erro) => {
    carregando = null;
    throw erro;
  });
  return carregando;
}
