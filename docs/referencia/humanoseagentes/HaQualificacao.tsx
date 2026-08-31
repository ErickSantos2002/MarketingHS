const negativos = [
  'Você quer uma agência para "fazer tudo" enquanto você não participa',
  "Você busca ferramentas prontas para usar sozinho",
  "Você não tem disponibilidade para se dedicar semanalmente",
  "Seu faturamento mensal está abaixo de R$ 100 mil",
];

const positivos = [
  "Sua empresa fatura acima de R$ 100 mil por mês",
  "Você já tentou IA e ficou frustrado com o resultado",
  "Seu time ainda depende de você para decisões que deveriam ser automáticas",
  "Você quer ter IA rodando sua operação em 90 dias — não teoria",
  "Você está disposto a trabalhar junto, não só delegar",
];

export function HaQualificacao() {
  return (
    <section
      id="qualificacao"
      style={{ background: "#0F0F0F", padding: "96px 0" }}
    >
      <div className="ha-container" style={{ maxWidth: 1120 }}>
        <div
          className="ha-reveal"
          data-d="0"
          style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 32 }}
        >
          <span style={{ width: 24, height: 1, background: "#3D61FF", display: "inline-block" }} />
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: "#3D61FF",
            }}
          >
            Para quem é a dn.ia
          </span>
        </div>

        <div
          className="ha-qual-grid ha-reveal"
          data-d="1"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            borderRadius: 12,
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.07)",
          }}
        >
          {/* Esquerda - negativo */}
          <div
            style={{
              background: "rgba(255,255,255,0.025)",
              padding: 32,
              borderRight: "1px solid rgba(255,255,255,0.07)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                paddingBottom: 16,
                marginBottom: 20,
                borderBottom: "1px solid rgba(255,255,255,0.07)",
              }}
            >
              <span
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  background: "rgba(255,255,255,0.06)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "rgba(255,255,255,0.30)",
                  fontSize: 12,
                }}
              >
                ✕
              </span>
              <span
                style={{
                  fontFamily: "Inter, sans-serif",
                  fontWeight: 500,
                  fontSize: 13,
                  color: "rgba(255,255,255,0.90)",
                }}
              >
                Não é para você se…
              </span>
            </div>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 14 }}>
              {negativos.map((t) => (
                <li key={t} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <span
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      background: "rgba(255,255,255,0.05)",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "rgba(255,255,255,0.25)",
                      fontSize: 9,
                      flexShrink: 0,
                      marginTop: 3,
                    }}
                  >
                    ✕
                  </span>
                  <span
                    style={{
                      fontFamily: "Inter, sans-serif",
                      fontSize: 13,
                      color: "rgba(255,255,255,0.35)",
                      lineHeight: 1.6,
                    }}
                  >
                    {t}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Direita - positivo */}
          <div style={{ background: "#0A0A0A", padding: 32 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                paddingBottom: 16,
                marginBottom: 20,
                borderBottom: "1px solid rgba(255,255,255,0.07)",
              }}
            >
              <span
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  background: "rgba(61,97,255,0.15)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#3D61FF",
                  fontSize: 12,
                }}
              >
                ✓
              </span>
              <span
                style={{
                  fontFamily: "Inter, sans-serif",
                  fontWeight: 500,
                  fontSize: 13,
                  color: "rgba(255,255,255,0.90)",
                }}
              >
                A dn.ia é <span style={{ color: "#3D61FF" }}>para você</span> se…
              </span>
            </div>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 14 }}>
              {positivos.map((t) => (
                <li key={t} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <span
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      background: "rgba(61,97,255,0.18)",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#3D61FF",
                      fontSize: 9,
                      flexShrink: 0,
                      marginTop: 3,
                    }}
                  >
                    ✓
                  </span>
                  <span
                    style={{
                      fontFamily: "Inter, sans-serif",
                      fontSize: 13,
                      color: "rgba(255,255,255,0.75)",
                      lineHeight: 1.6,
                    }}
                  >
                    {t}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Closing line */}
        <div
          className="ha-reveal"
          data-d="2"
          style={{
            marginTop: 12,
            background: "rgba(228,26,17,0.04)",
            border: "1px solid rgba(228,26,17,0.25)",
            borderRadius: 12,
            padding: "20px 24px",
            display: "flex",
            alignItems: "flex-start",
            gap: 14,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#E41A11",
              flexShrink: 0,
              marginTop: 9,
            }}
          />
          <p
            style={{
              fontFamily: "Inter, sans-serif",
              fontSize: 14,
              color: "rgba(255,255,255,0.70)",
              lineHeight: 1.7,
              margin: 0,
            }}
          >
            Se você está no primeiro grupo,{" "}
            <span style={{ fontWeight: 500, color: "#FFFFFF" }}>
              cada semana sem estrutura tem um custo
            </span>
            . O mercado não espera o momento certo.
          </p>
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .ha-qual-grid { grid-template-columns: 1fr !important; }
          .ha-qual-grid > div:first-child { border-right: none !important; border-bottom: 1px solid rgba(255,255,255,0.07); padding: 24px !important; }
          .ha-qual-grid > div:last-child { padding: 24px !important; }
        }
      `}</style>
    </section>
  );
}
