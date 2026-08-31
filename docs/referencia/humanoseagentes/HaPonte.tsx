export function HaPonte() {
  return (
    <section
      id="ponte"
      style={{
        background: "#0A0A0A",
        padding: "64px 52px",
      }}
    >
      <div
        className="ha-reveal"
        data-d="0"
        style={{ textAlign: "center", maxWidth: 880, margin: "0 auto" }}
      >
        <p
          className="ha-display"
          style={{
            fontSize: "clamp(28px, 3vw, 42px)",
            lineHeight: 1.1,
            color: "#FAFAFA",
            margin: 0,
          }}
        >
          A maioria das empresas já usa IA.
        </p>
        <p
          className="ha-display"
          style={{
            fontSize: "clamp(28px, 3vw, 42px)",
            lineHeight: 1.1,
            color: "#555555",
            margin: "8px 0 0",
          }}
        >
          Poucas têm agentes no mesmo time que os humanos.
        </p>
        <div
          aria-hidden="true"
          style={{
            width: 1,
            height: 48,
            background:
              "linear-gradient(to bottom, rgba(61,97,255,0.33), transparent)",
            margin: "40px auto 0",
          }}
        />
      </div>
    </section>
  );
}
