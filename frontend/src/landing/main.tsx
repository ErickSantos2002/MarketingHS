import { createRoot } from "react-dom/client";
import { Landing, type ConfigDaPagina } from "./Landing";
import "./landing.css";

// A config vem embutida na casca servida pelo FastAPI — sem segunda ida ao
// servidor, e sem precisar de chave de API para ler a própria página.
function lerConfig(): ConfigDaPagina {
  const bloco = document.getElementById("config-da-pagina");
  if (!bloco?.textContent) return {};
  try {
    return JSON.parse(bloco.textContent) as ConfigDaPagina;
  } catch {
    // Não derrubar a página por config quebrada: o formulário ainda funciona
    // com os campos padrão, e um lead vale mais que uma headline.
    console.error("[landing] config ilegível");
    return {};
  }
}

const alvo = document.getElementById("landing");
if (alvo) {
  const slug = alvo.dataset.slug ?? "";
  createRoot(alvo).render(<Landing slug={slug} config={lerConfig()} />);
}
