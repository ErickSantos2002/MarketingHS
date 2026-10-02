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

// O mesmo BASE do `Descadastrar.tsx`. Em produção o nginx só repassa /api/,
// /p/ e /landing/ ao backend: um fetch direto em /publico (sem /api) cai no SPA e
// volta 405 — a landing deixava de captar sem erro nenhum no painel (U1,
// raio-x de 02/10). Guardado por `node --test scripts/landing-caminhos.test.mjs`.
const BASE = import.meta.env.VITE_API_URL ?? "/api";

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
  // Sucesso sem redirect_url é o caso mais provável hoje — nenhuma página
  // configurou um ainda. Sem esse estado, o formulário fica preenchido na
  // tela depois de um envio que já funcionou, e quem enviou não sabe se
  // funcionou: reenvia por engano, ou desiste achando que travou.
  const [enviado, setEnviado] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const { email, ...resto } = valores;
      const r = await fetch(`${BASE}/publico/captura`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email, page_slug: slug,
          fields: { ...resto, ...utmDaUrl(), source: slug },
        }),
      });
      if (!r.ok) {
        const corpo = await r.json().catch(() => ({}));
        // Num 422 de validação, o FastAPI devolve `detail` como LISTA DE
        // OBJETOS ({loc, msg, type}), não como string. Renderizar um objeto
        // direto como filho React lança em runtime — e como o bundle da
        // landing não tem ErrorBoundary, a página inteira de captura some,
        // não só a mensagem de erro. Por isso a checagem de tipo abaixo, em
        // vez de confiar que `detail` é sempre texto.
        const detalhe = typeof corpo.detail === "string" ? corpo.detail : null;
        setErro(detalhe || "Não conseguimos registrar agora. Tente de novo.");
        return;
      }
      const corpo = await r.json();
      if (corpo.redirect_url) window.location.assign(corpo.redirect_url);
      else setEnviado(true);
    } catch {
      setErro("Não conseguimos registrar agora. Tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  if (enviado) {
    // O formulário sai da tela de propósito — deixar os campos preenchidos
    // depois de um envio que já funcionou é o que convida a reenviar.
    return (
      <div className="captura-sucesso" role="status">
        <p>
          <strong>Recebemos seus dados.</strong> Em breve alguém da Health
          &amp; Safety entra em contato.
        </p>
      </div>
    );
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
