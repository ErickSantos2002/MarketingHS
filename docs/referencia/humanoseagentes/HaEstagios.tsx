import { trackCtaClick } from "@/lib/metaTracking";

interface Props { onOpenModal: () => void }

const cards = [
  {
    n: "01 →",
    title: "Sem IA",
    pill: "Preso no passado",
    pillClass: "ha-pill-red",
    body: "Operação 100% manual. O tempo humano faz tudo.",
    bullets: [
      "Processos manuais consumindo o time",
      "Sem dados estruturados para decisão",
      "Escala depende de contratar mais gente",
    ],
  },
  {
    n: "02 →",
    title: "IA Fragmentada",
    pill: "Fragmentada e instável",
    pillClass: "ha-pill-blue",
    body: "Cada um usa do seu jeito. Ninguém fala a mesma língua.",
    bullets: [
      "ChatGPT aqui, Gemini ali, Claude acolá — sem padrão",
      "Nenhum aprendizado acumula na empresa",
      "Parece produtivo. Não é escalável.",
    ],
  },
  {
    n: "03 →",
    title: "IA Centralizada",
    pill: "Padronizada, não integrada",
    pillClass: "ha-pill-amber",
    body: "Padronizada. O time usa a mesma IA, do mesmo jeito.",
    bullets: [
      "Uma plataforma central, todos conectados",
      "Processos padronizados por área",
      "Ainda depende de humanos acionando a IA",
    ],
  },
  {
    n: "04 →",
    title: "IA na Operação",
    pill: "IA como infraestrutura",
    pillClass: "ha-pill-blue",
    body: "Humanos e agentes de IA trabalhando juntos, 24h por dia.",
    bullets: [
      "Agentes autônomos com identidade e memória",
      "IA age sem ser acionada — detecta e resolve",
      "Escala sem contratar. Opera sem o dono.",
    ],
    highlight: true,
  },
];

export function HaEstagios({ onOpenModal }: Props) {
  return (
    <section id="estagios" className="ha-section" style={{ background: "#0A0A0A" }}>
      <div className="ha-container">
        <div className="ha-reveal" data-d="0" style={{ textAlign: "center", marginBottom: 56 }}>
          <div className="ha-eyebrow" style={{ opacity: 0.7, marginBottom: 12 }}>
            04 ESTÁGIOS DE MATURIDADE EM IA
          </div>
          <h2
            className="ha-display"
            style={{ fontSize: "clamp(32px, 4vw, 56px)", lineHeight: 1.05, marginBottom: 16, color: "#FAFAFA" }}
          >
            Sua empresa está em um desses 4 estágios.
          </h2>
          <p style={{ fontFamily: "Inter, sans-serif", fontSize: 15, color: "#555555" }}>
            Em 90 dias, sua empresa
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map((c, i) => (
            <div
              key={c.n}
              className={`ha-card ha-reveal ${c.highlight ? "ha-card-highlight" : ""}`}
              data-d={i % 4}
            >
              {c.highlight && (
                <span
                  className="ha-mono"
                  style={{
                    position: "absolute",
                    top: 12,
                    right: 12,
                    background: "#3D61FF",
                    color: "#FAFAFA",
                    fontSize: 9,
                    padding: "3px 8px",
                    borderRadius: 4,
                    letterSpacing: "0.1em",
                  }}
                >
                  META
                </span>
              )}
              <div className="ha-mono" style={{ fontSize: 10, color: "#3D61FF", marginBottom: 12 }}>
                {c.n}
              </div>
              <span className={`ha-pill ${c.pillClass}`}>{c.pill}</span>
              <h3 className="ha-display" style={{ fontSize: 24, color: "#FAFAFA", marginTop: 10 }}>
                {c.title}
              </h3>
              <p
                style={{
                  fontFamily: "Inter, sans-serif",
                  fontSize: 14,
                  color: "#A0A0A0",
                  lineHeight: 1.7,
                  marginTop: 8,
                  marginBottom: 16,
                }}
              >
                {c.body}
              </p>
              <ul className="ha-bullets">
                {c.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="ha-reveal" data-d="0" style={{ textAlign: "center", marginTop: 48 }}>
          <p style={{ fontFamily: "Inter, sans-serif", fontSize: 16, color: "#A0A0A0", marginBottom: 20 }}>
            A dn.ia leva sua empresa do Estágio 01 ao Estágio 04
          </p>
          <button
            className="ha-btn-primary"
            onClick={() => { trackCtaClick("ha_estagios_cta"); onOpenModal(); }}
          >
            Descubra em qual estágio está
          </button>
        </div>
      </div>
    </section>
  );
}
