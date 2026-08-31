import { useState } from "react";
import { Play } from "lucide-react";
import { VideoModal } from "./VideoModal";
import { trackCtaClick } from "@/lib/metaTracking";

const videos = [
  { id: "qUYYBmtnuXA", name: "Nicholson Pimentel" },
  { id: "1CVz5XAD1FM", name: "Elisa Fávero" },
  { id: "xOgq2ug64x0", name: "Flávia Ferraz" },
  { id: "3QbKTXq31Ws", name: "Victor Barreto" },
];

interface Props {
  onOpenModal: () => void;
}

export function HaCases({ onOpenModal }: Props) {
  const [videoId, setVideoId] = useState<string | null>(null);

  return (
    <section id="cases" style={{ background: "#0A0A0A", padding: "60px 0" }}>
      <div className="ha-container">
        <div className="ha-reveal text-center" data-d="0" style={{ marginBottom: 32 }}>
          <div className="ha-eyebrow py-0 my-[18px]" style={{ opacity: 0.7, marginBottom: 12 }}>
            NEGÓCIOS REAIS · RESULTADOS COMPROVADOS
          </div>
          <h2
            className="ha-display"
            style={{ fontSize: "clamp(30px, 4vw, 52px)", lineHeight: 1.05, marginBottom: 16, color: "#FAFAFA" }}
          >
            Negócios reais de quem já opera com IA.
          </h2>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {videos.map((v, i) => (
            <div
              key={v.id}
              className="ha-video-thumb ha-reveal"
              data-d={i % 4}
              onClick={() => setVideoId(v.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setVideoId(v.id)}
            >
              <img src={`https://img.youtube.com/vi/${v.id}/mqdefault.jpg`} alt={v.name} loading="lazy" className="border-0 object-fill" />
              <div className="ha-overlay">
                <div className="ha-play">
                  <Play size={18} fill="currentColor" />
                </div>
              </div>
              <div className="ha-vname">{v.name}</div>
            </div>
          ))}
        </div>

        <div className="ha-reveal" data-d="1" style={{ display: "flex", justifyContent: "center", marginTop: 40 }}>
          <button
            className="ha-btn-primary"
            onClick={() => {
              trackCtaClick("ha_cases");
              onOpenModal();
            }}
          >
            Saiba mais
          </button>
        </div>
      </div>

      <VideoModal videoId={videoId} onClose={() => setVideoId(null)} />
    </section>
  );
}
