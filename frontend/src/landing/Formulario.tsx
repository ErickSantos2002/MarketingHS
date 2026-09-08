import { useState } from "react";
import type { ConfigDaPagina } from "./Landing";

// Os cinco campos que o gatilho `trg_score_lead_on_change` observa são o que
// qualifica um lead neste sistema: cargo, faturamento, funcionarios, desafios e
// whatsapp. Um formulário que não colete nenhum deles gera lead com score zero.
const ROTULOS: Record<string, string> = {
  nome: "Nome",
  email: "E-mail corporativo",
  whatsapp: "WhatsApp",
  cargo: "Cargo",
  empresa: "Empresa",
  funcionarios: "Número de colaboradores",
  faturamento: "Faturamento anual",
  desafios: "Qual o seu desafio hoje?",
};

const PADRAO = ["nome", "email", "whatsapp", "cargo", "empresa"];

function utmDaUrl(): Record<string, string> {
  const p = new URLSearchParams(window.location.search);
  const saida: Record<string, string> = {};
  for (const chave of ["utm_source", "utm_medium", "utm_campaign", "utm_term",
                       "utm_content", "ab_test", "ab_var", "ab_vid"]) {
    const v = p.get(chave);
    if (v) saida[chave] = v;
  }
  return saida;
}

export function Formulario({ slug, config }: { slug: string; config: ConfigDaPagina }) {
  const campos = config.visible_fields?.length ? config.visible_fields : PADRAO;
  const [valores, setValores] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const { email, ...resto } = valores;
      const r = await fetch("/publico/captura", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email, page_slug: slug,
          fields: { ...resto, ...utmDaUrl(), source: slug },
        }),
      });
      if (!r.ok) {
        const corpo = await r.json().catch(() => ({}));
        setErro(corpo.detail || "Não conseguimos registrar agora. Tente de novo.");
        return;
      }
      const corpo = await r.json();
      if (corpo.redirect_url) window.location.assign(corpo.redirect_url);
      else setErro(null);
    } catch {
      setErro("Não conseguimos registrar agora. Tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="captura">
      {campos.map((campo) => (
        <label key={campo}>
          <span>{ROTULOS[campo] ?? campo}</span>
          <input
            name={campo}
            type={campo === "email" ? "email" : "text"}
            required={campo === "email"}
            value={valores[campo] ?? ""}
            onChange={(e) => setValores({ ...valores, [campo]: e.target.value })}
          />
        </label>
      ))}
      {erro && <p className="erro" role="alert">{erro}</p>}
      <button type="submit" disabled={enviando}
              style={config.cta_color ? { background: config.cta_color } : undefined}>
        {enviando ? "Enviando..." : (config.cta_text || "Quero falar com um especialista")}
      </button>
    </form>
  );
}
