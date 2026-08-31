import { trackCtaClick } from "@/lib/metaTracking";
import dniaBg from "@/assets/dnia-bg.png.asset.json";
import { DnOSMockup } from "./DnOSMockup";

interface HaHeroProps {
  onOpenModal: () => void;
}

export function HaHero({ onOpenModal }: HaHeroProps) {
  return (
    <section
      id="inicio"
      style={{
        backgroundImage: `linear-gradient(rgba(10,10,10,0.65), rgba(10,10,10,0.65)), url(${dniaBg.url})`,
        backgroundSize: "cover, cover",
        backgroundPosition: "center, center",
        backgroundRepeat: "no-repeat",
        backgroundColor: "#0A0A0A",
        minHeight: "70vh",
        display: "flex",
        alignItems: "center",
      }}
    >
      <div className="ha-container" style={{ width: "100%", paddingTop: 64, paddingBottom: 64 }}>
        <div className="ha-hero-split">
          <div className="ha-hero-copy ha-reveal" data-d="0">
            <h1
              className="ha-display"
              style={{
                fontSize: "clamp(36px, 5vw, 64px)",
                lineHeight: 0.95,
                letterSpacing: "-0.03em",
                color: "#FAFAFA",
              }}
            >
              Sua empresa usa <span style={{ color: "#8DA2FF" }}>IA</span>. Mas IA ainda não trabalha na sua empresa.
            </h1>

            <p
              style={{
                fontFamily: "Inter, sans-serif",
                fontSize: 18,
                color: "#A0A0A0",
                marginTop: 20,
                lineHeight: 1.7,
              }}
            >
              Existe uma diferença entre usar ChatGPT todo dia e ter agentes de IA integrados à sua operação, enquanto você foca no que só você pode decidir.
            </p>

            <div className="ha-hero-cta">
              <button
                className="ha-btn-primary"
                onClick={() => {
                  trackCtaClick("ha_hero_primary");
                  onOpenModal();
                }}
              >
                Quero ter IA na minha empresa!
              </button>
            </div>
          </div>

          <div className="ha-hero-mockup ha-reveal" data-d="1">
            <DnOSMockup />
          </div>
        </div>
      </div>
    </section>
  );
}
