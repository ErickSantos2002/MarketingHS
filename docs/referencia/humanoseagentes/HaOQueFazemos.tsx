const itens = [
  {
    n: "01",
    eyebrow: "IAFICAÇÃO DA EMPRESA",
    title: "Mapeamos sua operação inteira: processos, gargalos e oportunidades.",
    detalhe: "Você sai com um diagnóstico real e um plano de ação para ter IA operando no seu negócio.",
  },
  {
    n: "02",
    eyebrow: "TECNOLOGIA",
    title: "Suite de 11 plataformas cobrindo marketing, vendas, gestão e operação.",
    detalhe: "Não é uma lista de ferramentas, é o sistema que conecta a IA à sua operação.",
  },
  {
    n: "03",
    eyebrow: "COMUNIDADE EXECUTIVA",
    title: "Conectamos você com empresários que já resolveram o que você está enfrentando agora.",
    detalhe: "Benchmark real, número na mesa e rede que gera negócio.",
  },
  {
    n: "04",
    eyebrow: "IAFICAÇÃO DO TIME",
    title: "Seu time aprende a operar com IA na função que já executa.",
    detalhe: "Vendedor com IA de vendas. Financeiro com IA de financeiro.",
  },
];

export function HaOQueFazemos() {
  return (
    <section id="o-que-fazemos" className="ha-section" style={{ background: "linear-gradient(rgba(10,10,10,0.65), rgba(10,10,10,0.65)), url('/__l5e/assets-v1/6a28de02-6002-4cb8-a8c9-ea90198a67fb/dnia-bg.png') center center / cover no-repeat, #0A0A0A" }}>
      <div className="ha-container">
        <div className="ha-reveal" data-d="0" style={{ marginBottom: 56, textAlign: "center" }}>
          <div className="ha-eyebrow" style={{ marginBottom: 12 }}>MÉTODO dn.ia</div>
          <h2
            className="ha-display"
            style={{
              fontSize: "clamp(32px, 3.6vw, 48px)",
              lineHeight: 1.1,
              color: "#FAFAFA",
              marginBottom: 8,
              maxWidth: 880,
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            A dn.ia não te ensina a usar IA, te ajuda a colocar humanos e agentes operando como um time.
          </h2>
        </div>

        <div className="ha-oqf-grid">
          {itens.map((it, i) => (
            <article
              key={it.n}
              className="ha-card ha-oqf-card ha-reveal ha-card-highlight"
              data-d={i % 4}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
                <span style={{ color: "#3D61FF", fontSize: 12, lineHeight: 1 }}>▲</span>
                <div
                  className="ha-mono"
                  style={{
                    fontSize: 28,
                    color: "#3D61FF",
                    lineHeight: 1,
                    fontWeight: 500,
                  }}
                >
                  {it.n}
                </div>
              </div>
              <div
                className="ha-mono"
                style={{
                  fontSize: 10,
                  color: "#8DA2FF",
                  textTransform: "uppercase",
                  letterSpacing: "0.18em",
                  marginBottom: 14,
                }}
              >
                {it.eyebrow}
              </div>
              <h3
                style={{
                  fontFamily: "Inter, sans-serif",
                  fontWeight: 600,
                  fontSize: 18,
                  color: "#FAFAFA",
                  lineHeight: 1.4,
                  margin: 0,
                  marginBottom: 12,
                }}
              >
                {it.title}
              </h3>
              <p
                style={{
                  fontFamily: "Inter, sans-serif",
                  fontSize: 14,
                  color: "#A0A0A0",
                  lineHeight: 1.6,
                  margin: 0,
                }}
              >
                {it.detalhe}
              </p>
            </article>
          ))}
        </div>

        <div
          className="ha-reveal"
          data-d="2"
          style={{
            marginTop: 64,
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 20,
          }}
        >
          <p
            className="ha-display"
            style={{
              fontSize: "clamp(22px, 2.4vw, 32px)",
              lineHeight: 1.2,
              color: "#FAFAFA",
              margin: 0,
            }}
          >
            É assim que a sua empresa vai operar:
          </p>
          <a
            href="#organogram"
            aria-label="Ir para a próxima seção"
            className="ha-oqf-arrow"
            onClick={(e) => {
              e.preventDefault();
              document.getElementById("organogram")?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#3D61FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </a>
        </div>
      </div>

      <style>{`
        .ha-oqf-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 20px;
        }
        .ha-oqf-card {
          padding: 32px;
          transition: transform 0.25s ease, border-color 0.25s ease;
        }
        .ha-oqf-card:hover {
          transform: translateY(-2px);
          border-color: rgba(61, 97, 255, 0.5);
        }

        .ha-oqf-arrow {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 56px;
          height: 56px;
          border-radius: 50%;
          border: 1px solid rgba(61, 97, 255, 0.4);
          background: rgba(61, 97, 255, 0.06);
          animation: ha-oqf-bounce 1.8s ease-in-out infinite;
          transition: background 0.2s ease, border-color 0.2s ease;
        }
        .ha-oqf-arrow:hover {
          background: rgba(61, 97, 255, 0.14);
          border-color: rgba(61, 97, 255, 0.7);
        }
        @keyframes ha-oqf-bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(8px); }
        }

        @media (max-width: 1024px) {
          .ha-oqf-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 768px) {
          .ha-oqf-grid { grid-template-columns: 1fr; gap: 16px; }
          .ha-oqf-card { padding: 24px; }
          .ha-oqf-card h3 { font-size: 16px !important; }
        }
      `}</style>
    </section>
  );
}

