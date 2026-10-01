import type { CSSProperties } from "react";
import { Formulario } from "./Formulario";
import { COR_CTA_PADRAO } from "./padroes";

// O acento da landing (botão sem cta_color, foco do campo, destaque da
// confirmação) sai da mesma constante que o editor mostra.
const ACENTO = { "--landing-accent": COR_CTA_PADRAO } as CSSProperties;

export type ConfigDaPagina = {
  nome_da_pagina?: string;
  headline?: string;
  subheadline?: string;
  cta_text?: string;
  cta_color?: string;
  visible_fields?: string[];
  redirect_url?: string;
};

export function Landing({ slug, config }: { slug: string; config: ConfigDaPagina }) {
  // Os padrões existem para a página nunca nascer vazia: enquanto o Nicholson
  // não decide a oferta, a landing mostra o que a HS vende de fato.
  const headline = config.headline || "Registre e prove cada teste de alcoolemia";
  const subheadline = config.subheadline ||
    "Bafômetro conectado para indústria e logística — o teste vira registro auditável.";

  return (
    <main className="landing" style={ACENTO}>
      <section className="hero">
        <h1>{headline}</h1>
        <p className="sub">{subheadline}</p>
        <Formulario slug={slug} config={config} />
      </section>
    </main>
  );
}
