import rodrigoImg from "@/assets/881fe3f1-6bcf-4335-8e52-f6853d4ef0aa.jpg";
import carlosImg from "@/assets/83dd8e17-6ac9-42d3-b7e9-96bec2a121f2.jpg";

const founders = [
  {
    img: rodrigoImg,
    name: "Rodrigo Nascimento",
    role: "Co-Fundador <dn.ia>",
    objectPosition: "center top",
    scale: 1.25,
    credentials: [
      "Ex-CMO · Sólides",
      "Ex-Head de Marketing North America · Rock Content",
      "Prof. Cultura Digital e AI · Academia Santander",
      "15+ anos em marketing, dados e tecnologia",
    ],
  },
  {
    img: carlosImg,
    name: "Carlos Soares",
    role: "Co-Fundador <dn.ia>",
    objectPosition: "30% top",
    scale: 1,
    credentials: [
      "Co-fundador da Obabox (2004) · adquirida pelo Grupo Multilaser",
      "Ex-VP de Marketing e Vendas · Multilaser",
      "27+ anos em e-commerce, varejo e desenvolvimento de produtos",
    ],
  },
];

export function HaFundadores() {
  return (
    <section
      id="fundadores"
      style={{
        background:
          "linear-gradient(rgba(10,10,10,0.65), rgba(10,10,10,0.65)), url('/__l5e/assets-v1/6a28de02-6002-4cb8-a8c9-ea90198a67fb/dnia-bg.png') center center / cover no-repeat, #0A0A0A",
        padding: "60px 0",
      }}
    >
      <div className="ha-container">
        <div className="ha-reveal" data-d="0" style={{ textAlign: "center", marginBottom: 32 }}>
          <div className="ha-eyebrow" style={{ opacity: 0.7, marginBottom: 8 }}>
            POR QUE CONFIAR NO MÉTODO
          </div>
          <h2
            className="ha-display"
            style={{ fontSize: "clamp(28px, 3.5vw, 48px)", lineHeight: 1.05, color: "#FAFAFA" }}
          >
            Construíram o organogram.ia
            <br />
            antes de oferecer ao mercado.
          </h2>
          <p
            style={{
              fontFamily: "Inter, sans-serif",
              fontSize: 15,
              color: "#555555",
              maxWidth: 520,
              margin: "16px auto 0",
              lineHeight: 1.6,
            }}
          >
            Não é teoria. É operação com experiência e resultados.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {founders.map((f, i) => (
            <div
              key={f.name}
              className="ha-card ha-reveal"
              data-d={i}
              style={{ border: "1px solid rgba(61,97,255,0.2)" }}
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
                  width: "100%",
                  maxWidth: 320,
                  height: 220,
                  overflow: "hidden",
                  borderRadius: 12,
                  margin: "0 auto",
                }}
              >
                <img
                  src={f.img}
                  alt={f.name}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    objectPosition: f.objectPosition,
                    transform: `scale(${f.scale})`,
                    transformOrigin: "center top",
                    display: "block",
                  }}
                />
              </div>
              <h3 className="ha-display" style={{ fontSize: 32, color: "#FAFAFA", marginTop: 20 }}>
                {f.name}
              </h3>
              <p style={{ fontFamily: "Inter, sans-serif", fontSize: 14, color: "#3D61FF", marginTop: 4 }}>
                {f.role}
              </p>

              <ul className="ha-bullets-arrow" style={{ marginTop: 16 }}>
                {f.credentials.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
