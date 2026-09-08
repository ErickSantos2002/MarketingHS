import { Formulario } from "./Formulario";

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
    <main className="landing">
      <section className="hero">
        <h1>{headline}</h1>
        <p className="sub">{subheadline}</p>
        <Formulario slug={slug} config={config} />
      </section>
    </main>
  );
}
