import { trackCtaClick } from "@/lib/metaTracking";

interface Props { onOpenModal: () => void }

export function HaJuntos({ onOpenModal }: Props) {
  return (
    <section
      id="juntos"
      style={{
        background:
          "radial-gradient(ellipse 60% 80% at center, rgba(61,97,255,0.05) 0%, transparent 70%), #111111",
        padding: "60px 0",
      }}
    >
      <div className="ha-container">
        <div className="ha-reveal" data-d="0" style={{ marginBottom: 8 }}>
          <div className="ha-eyebrow">2026 · O NOVO PADRÃO</div>
        </div>

        <h2
          className="ha-display ha-reveal ha-juntos-h2"
          data-d="0"
          style={{
            fontSize: "clamp(36px, 4vw, 64px)",
            lineHeight: 1.0,
            letterSpacing: "-0.02em",
            color: "#FAFAFA",
            maxWidth: 860,
            margin: 0,
          }}
        >
          A empresa que escala e reduz custos em 2026 tem humanos e IA trabalhando no mesmo time.
        </h2>

        <div
          className="ha-display ha-reveal ha-juntos-h2"
          data-d="1"
          style={{
            fontSize: "clamp(36px, 4vw, 64px)",
            lineHeight: 1.0,
            letterSpacing: "-0.02em",
            color: "#555555",
            maxWidth: 860,
            marginTop: 8,
          }}
        >
          Não separados. Juntos.
        </div>

        <p
          className="ha-reveal ha-juntos-sub"
          data-d="1"
          style={{
            fontFamily: "Inter, sans-serif",
            fontWeight: 400,
            fontSize: 18,
            color: "#A0A0A0",
            lineHeight: 1.7,
            maxWidth: 620,
            marginTop: 16,
          }}
        >
          Não é sobre usar IA. É sobre operar com IA — com agentes que executam, monitoram e
          entregam resultado enquanto seu time foca no que só humano faz.
        </p>

        <div
          className="ha-reveal ha-juntos-cta"
          data-d="2"
          style={{
            marginTop: 24,
            display: "flex",
            alignItems: "center",
            gap: 20,
            flexWrap: "wrap",
          }}
        >
          <button
            className="ha-btn-primary lg"
            onClick={() => {
              trackCtaClick("ha_juntos_cta");
              onOpenModal();
            }}
          >
            Quero ter IA na minha empresa!
          </button>
          <span
            style={{
              fontFamily: "Inter, sans-serif",
              fontSize: 13,
              color: "#333333",
            }}
          >
            Sem compromisso. Com método.
          </span>
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .ha-juntos-h2 { font-size: clamp(32px, 8vw, 40px) !important; }
          .ha-juntos-sub { font-size: 16px !important; }
          .ha-juntos-cta { flex-direction: column; align-items: flex-start !important; gap: 12px !important; }
        }
      `}</style>
    </section>
  );
}
