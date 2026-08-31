import { trackCtaClick } from "@/lib/metaTracking";
import { User, Bot } from "lucide-react";

interface Props { onOpenModal: () => void }

const humans = [
  { name: "Rodrigo Nascimento", label: "Humano", pos: { top: "8%", left: "50%" }, posM: { top: "6%", left: "50%" } },
  { name: "Normandia", label: "Humano", pos: { top: "50%", left: "10%" }, posM: { top: "50%", left: "8%" } },
  { name: "Dali", label: "Humana", pos: { top: "50%", left: "90%" }, posM: { top: "50%", left: "92%" } },
  { name: "Alê", label: "Humana", pos: { top: "92%", left: "50%" }, posM: { top: "94%", left: "50%" } },
];

const ais = [
  { pos: { top: "20%", left: "24%" }, posM: { top: "16%", left: "18%" } },
  { pos: { top: "20%", left: "76%" }, posM: { top: "16%", left: "82%" } },
  { pos: { top: "80%", left: "24%" }, posM: { top: "84%", left: "18%" } },
  { pos: { top: "80%", left: "76%" }, posM: { top: "84%", left: "82%" } },
];

const HEX_CLIP = "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)";

function HumanNode({
  name,
  label,
  pos,
  posM,
}: {
  name: string;
  label: string;
  pos: { top: string; left: string };
  posM: { top: string; left: string };
}) {
  return (
    <div
      className="ha-org-node ha-human-node"
      style={
        {
          position: "absolute",
          top: pos.top,
          left: pos.left,
          transform: "translate(-50%, -50%)",
          zIndex: 2,
          ["--top-m" as any]: posM.top,
          ["--left-m" as any]: posM.left,
        } as React.CSSProperties
      }
    >
      <div
        className="ha-human-hex"
        style={{
          clipPath: HEX_CLIP,
          background: "linear-gradient(180deg, rgba(61,97,255,0.25), rgba(61,97,255,0.08))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 2,
            clipPath: HEX_CLIP,
            background: "#0A1438",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <User className="ha-human-icon" color="#8DB4FF" strokeWidth={1.5} />
        </div>
      </div>
      <div className="ha-human-name" style={{ textAlign: "center", marginTop: 8, color: "#FAFAFA", fontWeight: 500, fontFamily: "Inter, sans-serif" }}>
        {name}
      </div>
      <div style={{ textAlign: "center", marginTop: 4 }}>
        <span
          className="ha-human-badge"
          style={{
            display: "inline-block",
            padding: "2px 8px",
            borderRadius: 4,
            background: "rgba(45,212,191,0.15)",
            color: "#5EEAD4",
            letterSpacing: "0.05em",
            fontFamily: "Inter, sans-serif",
          }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

function AiNode({ pos, posM }: { pos: { top: string; left: string }; posM: { top: string; left: string } }) {
  return (
    <div
      className="ha-org-node ha-ai-node"
      style={
        {
          position: "absolute",
          top: pos.top,
          left: pos.left,
          transform: "translate(-50%, -50%)",
          zIndex: 2,
          ["--top-m" as any]: posM.top,
          ["--left-m" as any]: posM.left,
        } as React.CSSProperties
      }
    >
      <div
        className="ha-ai-circle"
        style={{
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(61,97,255,0.35), rgba(61,97,255,0.05))",
          border: "1px solid rgba(141,180,255,0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 0 20px rgba(61,97,255,0.3)",
        }}
      >
        <Bot className="ha-ai-icon" color="#8DB4FF" strokeWidth={1.5} />
      </div>
      <div className="ha-ai-label" style={{ textAlign: "center", marginTop: 6, color: "#8DB4FF", fontFamily: "Inter, sans-serif" }}>
        Agentes de IA
      </div>
    </div>
  );
}

export function HaOrganograma({ onOpenModal }: Props) {
  return (
    <section
      id="organogram"
      className="ha-section my-0 ha-grid-bg py-[48px]"
      style={{
        background:
          "radial-gradient(ellipse 80% 60% at center, rgba(61,97,255,0.04) 0%, transparent 70%), #0A0A0A",
      }}
    >
      <div className="ha-container">
        <div className="ha-reveal text-center" data-d="0" style={{ marginBottom: 32 }}>
          <div className="ha-eyebrow my-[5px] px-[72px] py-0" style={{ opacity: 0.7, marginBottom: 12 }}>
            O ORGANOGRAM.IA EM OPERAÇÃO
          </div>
          <h2
            className="ha-display"
            style={{ fontSize: "clamp(30px, 4vw, 52px)", lineHeight: 1.05, marginBottom: 16, color: "#FAFAFA" }}
          >
            Conheça o time da dn.ia:
            <br />
            Humanos e agentes no mesmo time.
          </h2>
          <p
            style={{
              fontFamily: "Inter, sans-serif",
              fontSize: 15,
              color: "#A0A0A0",
              maxWidth: 560,
              margin: "0 auto 32px",
            }}
          >
            {"\n"}
          </p>
        </div>

        <div className="ha-reveal ha-org-layout" data-d="1">
          <div className="ha-org-panel">
            <div className="ha-org-panel-header">
              <div style={{ fontFamily: "Inter, sans-serif", fontSize: 24, fontWeight: 600, color: "#FAFAFA" }}>
                organogram<span style={{ color: "#8DB4FF" }}>.ia</span>
              </div>
            </div>

            <div className="ha-org-canvas">
              <svg
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                {[...humans, ...ais].map((n, i) => {
                  const top = parseFloat(n.pos.top);
                  const left = parseFloat(n.pos.left);
                  return (
                    <line
                      key={i}
                      x1="50"
                      y1="50"
                      x2={left}
                      y2={top}
                      stroke="rgba(141,180,255,0.4)"
                      strokeWidth="0.2"
                    />
                  );
                })}
              </svg>

              <div
                className="ha-org-hub"
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  borderRadius: "50%",
                  background: "radial-gradient(circle, rgba(61,97,255,0.55), rgba(61,97,255,0.1))",
                  border: "2px solid #3D61FF",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 0 100px rgba(61,97,255,0.6), inset 0 0 30px rgba(141,180,255,0.35)",
                  color: "#FAFAFA",
                  fontFamily: "Inter, sans-serif",
                  fontWeight: 700,
                  textAlign: "center",
                  zIndex: 2,
                }}
              >
                organogram<span style={{ color: "#8DB4FF" }}>.ia</span>
              </div>

              {ais.map((a, i) => <AiNode key={`ai-${i}`} pos={a.pos} posM={a.posM} />)}
              {humans.map((h, i) => <HumanNode key={`h-${i}`} {...h} />)}
            </div>
          </div>
        </div>

        <div className="ha-reveal" data-d="2" style={{ display: "flex", justifyContent: "center", marginTop: 48 }}>
          <button
            className="ha-btn-primary lg"
            onClick={() => {
              trackCtaClick("ha_organograma");
              onOpenModal();
            }}
          >
            Quero saber mais
          </button>
        </div>
      </div>

      <style>{`
        .ha-org-layout {
          display: block;
          max-width: 1200px;
          margin: 0 auto;
        }
        .ha-org-panel {
          background: linear-gradient(180deg, rgba(20,40,100,0.5), rgba(10,20,56,0.6));
          border: 1px solid rgba(141,180,255,0.35);
          border-radius: 24px;
          padding: 40px 56px;
          backdrop-filter: blur(10px);
          box-shadow: 0 20px 60px rgba(0,0,0,0.5), inset 0 0 80px rgba(61,97,255,0.1);
        }
        .ha-org-panel-header {
          display: flex;
          justify-content: flex-start;
          align-items: center;
          margin-bottom: 24px;
        }
        .ha-org-canvas {
          position: relative;
          width: 100%;
          aspect-ratio: 1 / 0.65;
          min-height: 520px;
        }
        .ha-org-hub { width: 200px; height: 200px; font-size: 22px; }
        .ha-human-hex { width: 72px; height: 80px; }
        .ha-human-icon { width: 28px; height: 28px; }
        .ha-human-name { font-size: 13px; }
        .ha-human-badge { font-size: 9px; }
        .ha-ai-circle { width: 64px; height: 64px; }
        .ha-ai-icon { width: 30px; height: 30px; }
        .ha-ai-label { font-size: 11px; }

        @media (max-width: 768px) {
          .ha-org-panel { padding: 28px 12px; }
          .ha-org-canvas { min-height: 520px; aspect-ratio: 1 / 1.15; }
          .ha-org-hub { width: 120px; height: 120px; font-size: 16px; }
          .ha-human-hex { width: 56px; height: 62px; }
          .ha-human-icon { width: 22px; height: 22px; }
          .ha-human-name { font-size: 11px; }
          .ha-human-badge { font-size: 8px; padding: 1px 6px; }
          .ha-ai-circle { width: 48px; height: 48px; }
          .ha-ai-icon { width: 22px; height: 22px; }
          .ha-ai-label { font-size: 10px; }
          .ha-org-node { top: var(--top-m) !important; left: var(--left-m) !important; }
        }
      `}</style>
    </section>
  );
}
