import localizaLogo from "@/assets/clients/localiza.png";
import hotmartLogo from "@/assets/clients/hotmart.png";
import solidesLogo from "@/assets/clients/solides.webp";
import symplaLogo from "@/assets/clients/sympla.png";
import ifoodLogo from "@/assets/clients/ifood.png";
import santanderLogo from "@/assets/clients/santander.png";
import cdlJovemLogo from "@/assets/clients/cdl-jovem.png";
import araujoLogo from "@/assets/clients/drogaria-araujo.png";

// Sem 'Grupo Multi' (restrição de marca)
const logos = [
  { src: araujoLogo, alt: "Drogaria Araújo" },
  { src: solidesLogo, alt: "Sólides" },
  { src: localizaLogo, alt: "Localiza" },
  { src: hotmartLogo, alt: "Hotmart" },
  { src: symplaLogo, alt: "Sympla" },
  { src: ifoodLogo, alt: "iFood" },
  { src: santanderLogo, alt: "Santander" },
  { src: cdlJovemLogo, alt: "CDL Jovem" },
];

export function HaLogos() {
  const doubled = [...logos, ...logos];
  return (
    <section
      style={{
        background: "#111111",
        padding: "32px 0",
        borderTop: "1px solid hsl(0 0% 9%)",
        borderBottom: "1px solid hsl(0 0% 9%)",
      }}
    >
      <div
        className="ha-mono"
        style={{
          fontSize: 10,
          color: "#555555",
          textTransform: "uppercase",
          letterSpacing: "0.2em",
          textAlign: "center",
          marginBottom: 24,
        }}
      >
        EMPRESAS QUE JÁ ESCALAM SEUS RESULTADOS COM A DN.IA
      </div>

      <div className="ha-marquee-mask">
        <div className="ha-marquee-track">
          {doubled.map((l, i) => (
            <img
              key={`${l.alt}-${i}`}
              src={l.src}
              alt={l.alt}
              className="ha-logo-img"
              loading="lazy"
              decoding="async"
            />
          ))}
        </div>
      </div>
    </section>
  );
}
