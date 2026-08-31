export function HaTransicao() {
  return (
    <section
      id="transicao"
      style={{
        background: "#111111",
        borderTop: "1px solid hsl(0 0% 9%)",
        borderBottom: "1px solid hsl(0 0% 9%)",
        padding: "100px 52px",
      }}
    >
      <div
        className="ha-reveal"
        data-d="0"
        style={{ maxWidth: 760, margin: "0 auto", textAlign: "center" }}
      >
        <div
          className="ha-eyebrow"
          style={{ color: "#3D61FF", opacity: 0.9, marginBottom: 20 }}
        >
          O PROBLEMA REAL
        </div>
        <h2
          className="ha-display"
          style={{
            fontSize: "clamp(36px, 4vw, 60px)",
            lineHeight: 1.0,
            color: "#FAFAFA",
            margin: 0,
          }}
        >
          A maioria das empresas usa IA.
          <br />
          Poucas operam com ela.
          <br />
          <span style={{ color: "#555555" }}>
            Essa diferença custa receita,
            <br />
            tempo e mercado todo mês.
          </span>
        </h2>
      </div>
    </section>
  );
}
