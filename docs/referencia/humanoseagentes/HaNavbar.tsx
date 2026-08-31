import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import logo from "@/assets/dnia-logo-branco.png";
import { trackCtaClick } from "@/lib/metaTracking";

interface HaNavbarProps {
  onOpenModal: () => void;
}

const links = [
  { label: "Entregáveis", href: "#pilares" },
  { label: "Ecossistema", href: "#organogram" },
  { label: "Cases", href: "#cases" },
  { label: "Fundadores", href: "#fundadores" },
];

export function HaNavbar({ onOpenModal }: HaNavbarProps) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`ha-nav ${scrolled ? "scrolled" : ""}`}>
      <div className="ha-container">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 72 }}>
          <a href="#inicio" style={{ display: "flex", alignItems: "center" }}>
            <img src={logo} alt="dn.ia" style={{ height: 24, width: "auto" }} />
          </a>

          <nav className="hidden lg:flex" style={{ alignItems: "center", gap: 32 }}>
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="ha-mono"
                style={{
                  fontSize: 10,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "#888",
                  textDecoration: "none",
                  transition: "color 0.2s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#FAFAFA")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "#888")}
              >
                {l.label}
              </a>
            ))}
          </nav>

          <div className="hidden lg:block">
            <button
              className="ha-btn-primary"
              onClick={() => {
                trackCtaClick("ha_header_desktop");
                onOpenModal();
              }}
            >
              Falar com especialista
            </button>
          </div>

          <button
            className="lg:hidden"
            onClick={() => setOpen(!open)}
            aria-label="Menu"
            style={{ background: "transparent", border: "none", color: "#FAFAFA", padding: 8 }}
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>

        {open && (
          <nav
            className="lg:hidden"
            style={{
              padding: "16px 0 24px",
              borderTop: "1px solid hsl(0 0% 9%)",
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="ha-mono"
                style={{
                  fontSize: 11,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "#A0A0A0",
                  textDecoration: "none",
                  padding: "8px 0",
                }}
              >
                {l.label}
              </a>
            ))}
            <button
              className="ha-btn-primary"
              style={{ width: "100%" }}
              onClick={() => {
                trackCtaClick("ha_header_mobile");
                setOpen(false);
                onOpenModal();
              }}
            >
              Falar com especialista
            </button>
          </nav>
        )}
      </div>
    </header>
  );
}
