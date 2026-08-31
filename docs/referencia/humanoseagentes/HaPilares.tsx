import { trackCtaClick } from "@/lib/metaTracking";

interface Props { onOpenModal: () => void }

const pilares = [
  {
    n: "01",
    eyebrow: "01 · EMPRESA",
    title: "IAficação da Empresa",
    body:
      "Matriz 360° do seu negócio. Plano personalizado por função e área. Acompanhamento de 12 meses. O ponto de partida de todo organogram.ia.",
    list: [
      "Diagnóstico real de maturidade em IA",
      "Organogram.ia personalizado por área",
      "Plano de execução com acompanhamento de 12 meses",
      "Base para construir sua operação com IA",
    ],
    cta: "Quero IAficar minha empresa",
  },
  {
    n: "02",
    eyebrow: "02 · TIME",
    title: "IAficação do Time",
    body:
      "Seu time capacitado por cargo e função. O conhecimento fica na empresa — não nas pessoas. É o que quebra o ciclo vicioso de depender do dono para tudo.",
    list: [
      "Capacitação por área e cargo específico",
      "Prompts, rotinas e processos prontos por função",
      "Time que sustenta o organogram.ia sem o dono",
      "Conhecimento que fica na empresa, não nas pessoas",
    ],
    cta: "Quero IAficar meu time",
  },
  {
    n: "03",
    eyebrow: "03 · TECNOLOGIA",
    title: "Tecnologia (dn.os)",
    body:
      "O sistema operacional do organogram.ia. Super Agentes com nome, foto e cargo — membros reais do time. +11 ferramentas integradas com CRM, dados e gestão.",
    list: [
      "dn.os: o sistema operacional do organogram.ia",
      "Super Agentes autônomos com identidade e memória",
      "+11 ferramentas integradas com seus processos",
      "Integração com CRM, dados e gestão",
    ],
    cta: "Conhecer o dn.os",
  },
  {
    n: "04",
    eyebrow: "04 · COMUNIDADE",
    title: "Comunidade Executiva",
    body:
      "Networking com empresários que já operam com IA. Benchmark real de resultados. Encontros presenciais que geram novos negócios.",
    list: [
      "Rede de operadores de IA — sem iniciantes",
      "Benchmark real de resultados com nome e número",
      "Encontros presenciais e rede que gera negócios",
      "Acesso a novos cases antes de virarem públicos",
    ],
    cta: "Quero fazer parte",
  },
];

export function HaPilares({ onOpenModal }: Props) {
  return (
    <section
      id="pilares"
      className="ha-section"
      style={{
        background: "#111111",
        borderTop: "1px solid hsl(0 0% 9%)",
        borderBottom: "1px solid hsl(0 0% 9%)",
      }}
    >
      <div className="ha-container">
        <div className="ha-reveal" data-d="0" style={{ textAlign: "center", marginBottom: 56 }}>
          <div className="ha-eyebrow" style={{ opacity: 0.7, marginBottom: 12 }}>
            A DN.IA RESOLVE EM 4 FRENTES
          </div>
          <h2
            className="ha-display"
            style={{ fontSize: "clamp(30px, 4vw, 52px)", lineHeight: 1.05, marginBottom: 12, color: "#FAFAFA" }}
          >
            Diagnóstico, time, tecnologia
            <br />e comunidade — no mesmo ecossistema.
          </h2>
          <p style={{ fontFamily: "Inter, sans-serif", fontSize: 15, color: "#555555" }}>
            Tudo integrado. Do plano à operação. Com você.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {pilares.map((p, i) => (
            <div key={p.n} className="ha-card ha-reveal" data-d={i % 4}>
              <span
                className="ha-display"
                style={{
                  position: "absolute",
                  top: -10,
                  right: 16,
                  fontSize: 100,
                  color: "rgba(61,97,255,0.06)",
                  lineHeight: 1,
                  pointerEvents: "none",
                }}
              >
                {p.n}
              </span>
              <div className="ha-eyebrow" style={{ opacity: 0.7 }}>{p.eyebrow}</div>
              <h3 className="ha-display" style={{ fontSize: 28, color: "#FAFAFA", marginTop: 8 }}>
                {p.title}
              </h3>
              <p
                style={{
                  fontFamily: "Inter, sans-serif",
                  fontSize: 14,
                  color: "#A0A0A0",
                  lineHeight: 1.75,
                  marginTop: 12,
                }}
              >
                {p.body}
              </p>
              <ul className="ha-bullets-arrow" style={{ marginTop: 16 }}>
                {p.list.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              <button
                className="ha-btn-ghost"
                style={{ marginTop: 24 }}
                onClick={() => { trackCtaClick(`ha_pilar_${p.n}`); onOpenModal(); }}
              >
                {p.cta}
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
