import { trackCtaClick } from "@/lib/metaTracking";

interface Props { onOpenModal: () => void }

export function HaCtaIntermediario({ onOpenModal }: Props) {
  return (
    <section
      id="cta-organograma"
      style={{ background: "#0A0A0A", padding: "80px 0" }}
    >
      <div className="ha-container" style={{ textAlign: "center" }}>
        <div className="ha-eyebrow ha-reveal" data-d="0" style={{ marginBottom: 16 }}>
          PRÓXIMO PASSO
        </div>
        <h3
          className="ha-display ha-reveal"
          data-d="0"
          style={{
            fontSize: "clamp(28px, 3.2vw, 40px)",
            lineHeight: 1.1,
            color: "#FAFAFA",
            margin: "0 auto 32px",
            maxWidth: 720,
          }}
        >
          Quer ver seu organogram.ia montado?
        </h3>
        <div
          className="ha-reveal"
          data-d="1"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
          }}
        >
          <button
            className="ha-btn-primary lg"
            onClick={() => {
              trackCtaClick("ha_cta_pos_organograma");
              onOpenModal();
            }}
          >
            Quero ter IA na minha empresa!
          </button>
          <span style={{ fontFamily: "Inter, sans-serif", fontSize: 13, color: "#333333" }}>
            Sem compromisso. Com método.
          </span>
        </div>
      </div>
    </section>
  );
}
