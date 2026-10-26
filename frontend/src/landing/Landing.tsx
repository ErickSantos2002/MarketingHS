import type { CSSProperties } from "react";
import { Formulario } from "./Formulario";
import { COR_CTA_PADRAO } from "./padroes";
import {
  enderecoDaImagem, linkDoWhatsapp, paragrafosDoCorpo, textoDaConfig, urlSegura, type ConfigDaPagina,
} from "./campos";
import { Numeros, Secoes } from "./Secoes";
import { secoesDaConfig } from "./secoes";

export type { ConfigDaPagina } from "./campos";

// O acento da landing (botão sem cta_color, foco do campo, destaque da
// confirmação) sai da mesma constante que o editor mostra.
const ACENTO = { "--landing-accent": COR_CTA_PADRAO } as CSSProperties;

// O prefixo que a imagem do upload ganha (`enderecoDaImagem`, em campos.ts).
const BASE = import.meta.env.VITE_API_URL ?? "/api";

function IconeWhatsapp() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm5.8 14.08c-.24.68-1.42 1.3-1.95 1.35-.5.05-.97.23-3.27-.68-2.77-1.09-4.52-3.93-4.66-4.11-.13-.18-1.11-1.48-1.11-2.82 0-1.34.7-2 .95-2.27.25-.27.54-.34.72-.34h.52c.17 0 .4-.06.62.47.24.56.79 1.92.86 2.06.07.14.11.3.02.48-.09.18-.14.3-.27.46-.14.16-.29.36-.41.48-.14.14-.28.29-.12.56.16.27.71 1.17 1.52 1.9 1.05.93 1.93 1.22 2.2 1.36.27.14.43.11.59-.07.16-.18.68-.79.86-1.06.18-.27.36-.23.61-.14.25.09 1.59.75 1.86.89.27.14.45.2.52.32.07.11.07.66-.17 1.35Z" />
    </svg>
  );
}

function BotaoWhatsapp({ href }: { href: string }) {
  return (
    <a className="landing-whatsapp" href={href} target="_blank" rel="noopener noreferrer"
       aria-label="Falar no WhatsApp">
      <IconeWhatsapp />
    </a>
  );
}

export function Landing({ slug, config }: { slug: string; config: ConfigDaPagina }) {
  // Os padrões existem para a página nunca nascer vazia: enquanto o Nicholson
  // não decide a oferta, a landing mostra o que a HS vende de fato.
  const headline = config.headline || "Registre e prove cada teste de alcoolemia";
  const subheadline = config.subheadline ||
    "Bafômetro conectado para indústria e logística — o teste vira registro auditável.";
  // Texto puro em blocos — nunca `dangerouslySetInnerHTML`: a config é
  // editada no admin, mas a página é pública, e HTML colado viraria script.
  const corpo = textoDaConfig(config.corpo) ? paragrafosDoCorpo(config.corpo as string) : [];
  // Toda URL da config passa por `urlSegura` (só http/https) antes de virar
  // src/href. O link do WhatsApp é montado por nós sobre https://wa.me, mas
  // passa pela mesma régua.
  // `textoDaConfig` antes de qualquer .trim()/.replace(): a config é JSON
  // editável, e um número ou objeto no lugar do texto derrubaria a página
  // inteira (o bundle da landing não tem ErrorBoundary).
  const imagemDaConfig = textoDaConfig(config.imagem_url);
  const imagem = imagemDaConfig
    ? urlSegura(enderecoDaImagem(imagemDaConfig, BASE), window.location.origin)
    : null;
  const numeroDoWhatsapp = textoDaConfig(config.whatsapp?.numero).replace(/\D/g, "");
  const whatsapp = numeroDoWhatsapp
    ? urlSegura(linkDoWhatsapp(numeroDoWhatsapp, textoDaConfig(config.whatsapp?.mensagem)), window.location.origin)
    : null;
  // Página antiga (sem imagem, sem corpo e sem seções) fica no cartão único
  // de antes. Qualquer uma das três liga o topo largo (frente landing-visual).
  const completa = !!imagem || corpo.length > 0;
  // As seções vêm depois do topo, na ordem da config. Sem `secoes`, a lista
  // é vazia.
  const secoes = secoesDaConfig(config, window.location.origin, BASE);
  const rica = completa || secoes.length > 0;
  // Uma faixa de números SEM título logo na primeira posição encaixa no pé
  // do topo, ao lado do formulário que desce da borda (é onde ela lê como
  // prova do que o título promete). Com título, ou em outra posição, ela é
  // uma seção como as outras.
  const primeira = secoes[0];
  const numerosNoTopo = primeira?.tipo === "numeros" && !primeira.titulo && !primeira.subtitulo
    ? primeira : null;
  const depois = numerosNoTopo ? secoes.slice(1) : secoes;

  // `id="formulario"` no cartão: é para onde o botão da seção "chamada" rola.
  if (!rica) {
    return (
      <main className={["landing", whatsapp && "landing-com-whatsapp"].filter(Boolean).join(" ")} style={ACENTO}>
        <section id="formulario" className="hero">
          <h1>{headline}</h1>
          <p className="sub">{subheadline}</p>
          <Formulario slug={slug} config={config} />
        </section>
        {whatsapp && <BotaoWhatsapp href={whatsapp} />}
      </main>
    );
  }

  return (
    <main className={["landing", "landing-rica", depois.length === 0 && "landing-sem-secoes",
                      whatsapp && "landing-com-whatsapp"].filter(Boolean).join(" ")}
          style={ACENTO}>
      <header className={["topo", imagem && "topo-com-foto", numerosNoTopo && "topo-com-numeros"]
                         .filter(Boolean).join(" ")}>
        <div className="topo-fundo" aria-hidden="true" />
        {/* Alt vazio: a foto ilustra o título ao lado, e repetir o h1 no
            alt faria o leitor de tela dizer a mesma frase duas vezes. */}
        {imagem && (
          <div className="topo-foto">
            <img src={imagem} alt="" />
          </div>
        )}
        <div className="topo-texto">
          <h1>{headline}</h1>
          <p className="sub">{subheadline}</p>
          {corpo.length > 0 && (
            <div className="topo-corpo">
              {corpo.map((bloco, i) => bloco.tipo === "p"
                ? <p key={i}>{bloco.texto}</p>
                : <ul key={i}>{bloco.itens.map((item, j) => <li key={j}>{item}</li>)}</ul>)}
            </div>
          )}
        </div>
        <section id="formulario" className="topo-form" aria-label="Formulário de contato">
          <Formulario slug={slug} config={config} />
        </section>
        {numerosNoTopo && (
          <div className="topo-numeros">
            <Numeros secao={numerosNoTopo} />
          </div>
        )}
      </header>
      {depois.length > 0 && <Secoes secoes={depois} />}
      {whatsapp && <BotaoWhatsapp href={whatsapp} />}
    </main>
  );
}
