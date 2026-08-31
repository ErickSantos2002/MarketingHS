import { Check, X as XIcon } from "lucide-react";
import { trackCtaClick } from "@/lib/metaTracking";

interface Props { onOpenModal: () => void }

const opcoes = [
  {
    title: "Por conta própria",
    pill: "Não funciona",
    body: "Você tentou. O time não sustentou. A automação foi abandonada. Voltou ao ponto zero.",
    bullets: ["Retrabalho constante", "Conhecimento não acumula", "Ciclo sem fim"],
    bad: true,
  },
  {
    title: "Consultoria tradicional",
    pill: "Cria dependência",
    body: "Entrega um plano. Vai embora. O conhecimento não fica no time. O gargalo volta sempre.",
    bullets: ["Plano sem execução", "Time não aprende", "Resultado não sustenta"],
    bad: true,
  },
];

export function HaTresOpcoes({ onOpenModal }: Props) {
  return (
    <section
      id="diagnostico"
      className="ha-section"
      style={{
        background:
          "radial-gradient(ellipse 60% 80% at center, rgba(61,97,255,0.05) 0%, transparent 70%), #0A0A0A",
      }}
    >
      <div className="ha-container">
        <div className="ha-reveal" data-d="0" style={{ textAlign: "center", marginBottom: 56 }}>
          <div className="ha-eyebrow" style={{ opacity: 0.7, marginBottom: 12 }}>
            VOCÊ TEM TRÊS CAMINHOS
          </div>
          <h2
            className="ha-display"
            style={{ fontSize: "clamp(32px, 4vw, 56px)", lineHeight: 1.05, color: "#FAFAFA" }}
          >
            Você tem três caminhos.
            <br />
            Dois já não funcionaram.
          </h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {opcoes.map((o, i) => (
            <div
              key={o.title}
              className="ha-card ha-reveal"
              data-d={i}
              style={{ border: "1px solid rgba(228,26,17,0.2)" }}
            >
              <div
                style={{
                  width: 40, height: 40, borderRadius: "50%",
                  border: "2px solid #E41A11", color: "#E41A11",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  marginBottom: 16,
                }}
              >
                <XIcon size={20} />
              </div>
              <h3 className="ha-display" style={{ fontSize: 24, color: "#FAFAFA" }}>{o.title}</h3>
              <span className="ha-pill ha-pill-red" style={{ marginTop: 10 }}>{o.pill}</span>
              <p style={{ fontFamily: "Inter, sans-serif", fontSize: 14, color: "#A0A0A0", lineHeight: 1.75, marginTop: 16 }}>
                {o.body}
              </p>
              <ul className="ha-bullets" style={{ marginTop: 16 }}>
                {o.bullets.map((b) => <li key={b}>{b}</li>)}
              </ul>
            </div>
          ))}

          {/* Card destaque dn.ia */}
          <div
            className="ha-card ha-reveal"
            data-d="2"
            style={{
              border: "1px solid rgba(61,97,255,0.5)",
              background: "rgba(61,97,255,0.05)",
              boxShadow: "0 0 48px rgba(61,97,255,0.1)",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 0, left: 0, right: 0, height: 2,
                background: "linear-gradient(90deg, #3D61FF, #8B5CF6)",
              }}
            />
            <div
              style={{
                width: 40, height: 40, borderRadius: "50%",
                background: "#3D61FF", color: "#FAFAFA",
                display: "flex", alignItems: "center", justifyContent: "center",
                marginBottom: 16,
              }}
            >
              <Check size={20} />
            </div>
            <span className="ha-pill ha-pill-blue">Com método</span>
            <h3 className="ha-display" style={{ fontSize: 28, color: "#3D61FF", marginTop: 10 }}>
              dn.ia — com você
            </h3>
            <p style={{ fontFamily: "Inter, sans-serif", fontSize: 14, color: "#A0A0A0", lineHeight: 1.75, marginTop: 12 }}>
              Diagnóstico real. Plano por função. Time operando IA em 90 dias. O conhecimento fica.
              O resultado tem nome e número.
            </p>
            <ul className="ha-bullets-arrow" style={{ marginTop: 16 }}>
              <li>Diagnóstico de maturidade em IA</li>
              <li>Organogram.ia personalizado</li>
              <li>Acompanhamento de 12 meses</li>
              <li>Time capacitado por função</li>
            </ul>
            <button
              className="ha-btn-primary"
              style={{ width: "100%", marginTop: 24 }}
              onClick={() => { trackCtaClick("ha_3opcoes_destaque"); onOpenModal(); }}
            >
              Quero começar com método
            </button>
            <p style={{ fontFamily: "Inter, sans-serif", fontSize: 11, color: "#555555", textAlign: "center", marginTop: 10 }}>
              <br />
            </p>
          </div>
        </div>

        {/* Bloco fechamento */}
        <div
          className="ha-reveal"
          data-d="0"
          style={{
            marginTop: 72,
            textAlign: "center",
            paddingTop: 56,
            borderTop: "1px solid hsl(0 0% 9%)",
          }}
        >

          <h3
            className="ha-display"
            style={{ fontSize: "clamp(36px, 5vw, 64px)", lineHeight: 0.95, color: "#FAFAFA", marginBottom: 8 }}
          >
            O próximo case
            <br />pode ser o seu.
          </h3>
          <p style={{ fontFamily: "Inter, sans-serif", fontSize: 15, color: "#555555", marginBottom: 32 }}>
            O diagnóstico é gratuito. O método é comprovado.
          </p>
          <button
            className="ha-btn-primary lg"
            onClick={() => { trackCtaClick("ha_final_cta"); onOpenModal(); }}
          >
            Descubra em qual estágio está
          </button>
          <p style={{ fontFamily: "Inter, sans-serif", fontSize: 12, color: "#555555", marginTop: 12 }}>
            <br />
          </p>
        </div>
      </div>
    </section>
  );
}
