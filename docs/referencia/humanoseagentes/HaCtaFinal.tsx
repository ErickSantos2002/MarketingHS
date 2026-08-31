import { trackCtaClick } from "@/lib/metaTracking";

interface Props {
  onOpenModal: () => void;
}

export function HaCtaFinal({ onOpenModal }: Props) {
  return (
    <section style={{ background: "#0A0A0A", padding: "96px 0" }}>
      <div className="ha-container" style={{ textAlign: "center" }}>
        <h2
          className="ha-display ha-reveal"
          data-d="0"
          style={{
            fontSize: "clamp(28px, 4vw, 48px)",
            lineHeight: 1.1,
            color: "#FAFAFA",
            maxWidth: 880,
            margin: "0 auto",
          }}
        >
          O risco não é tentar. É continuar operando sem IA enquanto o mercado avança.
        </h2>

        <p
          className="ha-reveal"
          data-d="1"
          style={{
            fontFamily: "Inter, sans-serif",
            fontSize: 15,
            color: "#A0A0A0",
            marginTop: 20,
          }}
        >
          Diagnóstico gratuito. Sem compromisso. Com método.
        </p>

        <div className="ha-reveal" data-d="2" style={{ display: "flex", justifyContent: "center", marginTop: 32 }}>
          <button
            className="ha-btn-primary lg"
            onClick={() => {
              trackCtaClick("ha_final");
              onOpenModal();
            }}
          >
            Quero falar com especialista
          </button>
        </div>
      </div>
    </section>
  );
}
