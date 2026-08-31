import dnosVideo from "@/assets/dnos-demo-v3.mp4.asset.json";

export function DnOSMockup() {
  return (
    <div className="ha-mockup-wrap">
      <div className="ha-mockup-glow" aria-hidden="true" />
      <div className="ha-mockup-float">
        <div className="ha-mockup-bezel">
          <div className="ha-mockup-topbar">
            <div className="ha-mockup-dots">
              <span style={{ background: "#E41A11" }} />
              <span style={{ background: "rgba(0,0,0,0.15)" }} />
              <span style={{ background: "rgba(0,0,0,0.15)" }} />
            </div>
            <div className="ha-mockup-title">dn.os · sistema operacional</div>
            <div className="ha-mockup-live">
              <span className="ha-mockup-live-dot" />
              <span>AO VIVO</span>
            </div>
          </div>
          <div className="ha-mockup-screen">
            <video
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
            >
              <source src={dnosVideo.url} type="video/mp4" />
            </video>
          </div>
          <div className="ha-mockup-badge">
            <div className="ha-mockup-badge-line1">
              <span className="ha-mockup-pulse" />
              Milo está analisando sua campanha
            </div>
            <div className="ha-mockup-badge-line2">agente IA · campanhas e resultados</div>
          </div>
        </div>
        <div className="ha-mockup-neck" />
        <div className="ha-mockup-base" />
      </div>
    </div>
  );
}
