import logo from "@/assets/dnia-logo-branco.png";

export function HaFooter() {
  return (
    <footer
      style={{
        background: "#0A0A0A",
        borderTop: "1px solid hsl(0 0% 9%)",
        padding: "40px 0",
      }}
    >
      <div className="ha-container">
        <div className="text-center">
          <img src={logo} alt="dn.ia" style={{ height: 32, margin: "0 auto 16px", opacity: 0.6 }} />
          <p
            style={{
              fontFamily: "Inter, sans-serif",
              fontSize: 14,
              color: "#A0A0A0",
              marginBottom: 8,
            }}
          >
            O Ecossistema das empresas que escalam com Humanos e IAs no mesmo time
          </p>
          <p
            style={{
              fontFamily: "Inter, sans-serif",
              fontSize: 12,
              color: "#555555",
              marginBottom: 12,
            }}
          >
            © 2026 dn.ia — Todos os direitos reservados
          </p>
          <p
            style={{
              fontFamily: "Inter, sans-serif",
              fontSize: 10,
              color: "rgba(160,160,160,0.6)",
              maxWidth: 480,
              margin: "0 auto",
            }}
          >
            Este site não faz parte do Facebook ou Facebook Inc. Da mesma forma, não é endossado pelo Facebook de nenhuma maneira.
          </p>
        </div>
      </div>
    </footer>
  );
}
