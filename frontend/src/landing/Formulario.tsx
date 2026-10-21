import { useRef, useState } from "react";
import {
  camposDaConfig, lerVisitante, validarNoCliente,
  type CampoDaPagina, type ConfigDaPagina,
} from "./campos";

// Os cinco campos que o gatilho `trg_score_lead_on_change` observa são o que
// qualifica um lead neste sistema: cargo, faturamento, funcionarios, desafios e
// whatsapp. Um formulário que não colete nenhum deles gera lead com score zero.
// Os rótulos e os campos padrão moram em `campos.ts` (ROTULOS_PADRAO,
// CAMPOS_PADRAO), junto da regra que decide o que a página mostra.

// O mesmo BASE do `Descadastrar.tsx`. Em produção o nginx só repassa /api/,
// /p/ e /landing/ ao backend: um fetch direto em /publico (sem /api) cai no SPA e
// volta 405 — a landing deixava de captar sem erro nenhum no painel (U1,
// raio-x de 02/10). Guardado por `node --test scripts/landing-caminhos.test.mjs`.
const BASE = import.meta.env.VITE_API_URL ?? "/api";

const ERRO_GERAL = "Não conseguimos registrar agora. Tente de novo.";
const OBRIGADO_PADRAO =
  "Recebemos seus dados. Em breve alguém da Health & Safety entra em contato.";

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

// O erro do servidor chega em dois formatos (Tarefa 3 do plano da prova):
// `detail` string, o de sempre, ou `detail = {mensagem, campos}` na
// validação por campo. Num 422 o FastAPI ainda manda `detail` como LISTA de
// objetos ({loc, msg, type}). Renderizar objeto direto como filho React lança
// em runtime — e o bundle da landing não tem ErrorBoundary, a página inteira
// de captura some. Por isso nada aqui confia no tipo de `detail`.
function lerErroDoServidor(corpo: unknown): { mensagem: string; campos: Record<string, string> } {
  const detalhe = (corpo as { detail?: unknown } | null)?.detail;
  if (typeof detalhe === "string" && detalhe) return { mensagem: detalhe, campos: {} };
  if (detalhe && typeof detalhe === "object" && !Array.isArray(detalhe)) {
    const { mensagem, campos } = detalhe as { mensagem?: unknown; campos?: unknown };
    const porCampo: Record<string, string> = {};
    if (campos && typeof campos === "object") {
      for (const [chave, valor] of Object.entries(campos as Record<string, unknown>)) {
        if (typeof valor === "string") porCampo[chave] = valor;
      }
    }
    return { mensagem: typeof mensagem === "string" && mensagem ? mensagem : ERRO_GERAL, campos: porCampo };
  }
  return { mensagem: ERRO_GERAL, campos: {} };
}

function Controle({ campo, valor, erro, aoMudar }: {
  campo: CampoDaPagina; valor: string; erro?: string; aoMudar: (v: string) => void;
}) {
  const id = `campo-${campo.chave}`;
  const idErro = `${id}-erro`;
  const comuns = {
    id,
    name: campo.chave,
    "aria-invalid": erro ? true : undefined,
    "aria-describedby": erro ? idErro : undefined,
    "aria-required": campo.obrigatorio || undefined,
  } as const;
  const rotulo = (
    <span className="captura-rotulo">
      {campo.rotulo}
      {campo.obrigatorio && <span className="captura-obrigatorio" aria-hidden="true"> *</span>}
    </span>
  );
  const mensagem = erro ? <span id={idErro} className="captura-erro-campo">{erro}</span> : null;

  if (campo.tipo === "sim_nao") {
    return (
      <fieldset className="captura-grupo" aria-describedby={comuns["aria-describedby"]}
                aria-invalid={comuns["aria-invalid"]}>
        <legend>{rotulo}</legend>
        <div className="captura-opcoes">
          {[["sim", "Sim"], ["nao", "Não"]].map(([v, texto]) => (
            <label key={v} className="captura-radio">
              <input type="radio" name={campo.chave} value={v} checked={valor === v}
                     onChange={() => aoMudar(v)} />
              <span>{texto}</span>
            </label>
          ))}
        </div>
        {mensagem}
      </fieldset>
    );
  }

  let entrada;
  if (campo.tipo === "lista") {
    entrada = (
      <select {...comuns} value={valor} onChange={(e) => aoMudar(e.target.value)}>
        <option value="">Selecione</option>
        {(campo.opcoes ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  } else if (campo.tipo === "texto_longo") {
    entrada = (
      <textarea {...comuns} rows={4} maxLength={2000} value={valor}
                onChange={(e) => aoMudar(e.target.value)} />
    );
  } else {
    const tipo = campo.tipo === "email" ? "email" : campo.tipo === "telefone" ? "tel" : "text";
    entrada = (
      <input {...comuns} type={tipo}
             inputMode={campo.tipo === "telefone" ? "tel" : campo.tipo === "email" ? "email" : undefined}
             autoComplete={campo.tipo === "email" ? "email" : campo.tipo === "telefone" ? "tel"
               : campo.chave === "nome" ? "name" : campo.chave === "empresa" ? "organization" : undefined}
             maxLength={campo.tipo === "texto" ? 200 : undefined}
             value={valor} onChange={(e) => aoMudar(e.target.value)} />
    );
  }
  return (
    <div className="captura-campo">
      <label htmlFor={id}>{rotulo}</label>
      {entrada}
      {mensagem}
    </div>
  );
}

export function Formulario({ slug, config }: { slug: string; config: ConfigDaPagina }) {
  const campos = camposDaConfig(config);
  const consentimento = config.consentimento?.texto ? config.consentimento : null;
  // `obrigatorio` ausente vale `true` — a mesma regra do servidor.
  const consentimentoObrigatorio = !!consentimento && consentimento.obrigatorio !== false;

  const [valores, setValores] = useState<Record<string, string>>({});
  const [aceitou, setAceitou] = useState(false);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  // Sucesso sem redirect_url é o caso mais provável — a rota /obrigado não
  // existe. Sem esse estado, o formulário fica preenchido na tela depois de um
  // envio que já funcionou, e quem enviou não sabe se funcionou: reenvia por
  // engano, ou desiste achando que travou.
  const [enviado, setEnviado] = useState(false);
  // Campo-isca (pergunta 50). Gente não vê nem alcança pelo Tab; robô de
  // formulário preenche. O servidor (`_caiu_no_honeypot`, R1) responde
  // sucesso sem gravar quando `fields.website` vem preenchido.
  const [isca, setIsca] = useState("");

  function focarPrimeiroErro(chaves: string[]) {
    const primeira = campos.find((c) => chaves.includes(c.chave))?.chave
      ?? (chaves.includes("consentimento") ? "consentimento" : null);
    if (!primeira) return;
    const alvo = formRef.current?.querySelector<HTMLElement>(
      primeira === "consentimento" ? "#captura-consentimento" : `[name="${primeira}"]`);
    alvo?.focus();
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const novos = validarNoCliente(campos, valores);
    if (consentimentoObrigatorio && !aceitou) {
      novos.consentimento = "Para enviar, aceite a política de privacidade.";
    }
    setErros(novos);
    if (Object.keys(novos).length) {
      focarPrimeiroErro(Object.keys(novos));
      return;
    }
    setEnviando(true);
    try {
      const chaves = new Set(campos.map((c) => c.chave));
      const resto: Record<string, string> = {};
      for (const [chave, valor] of Object.entries(valores)) {
        if (chave !== "email" && chaves.has(chave) && valor.trim()) resto[chave] = valor.trim();
      }
      const r = await fetch(`${BASE}/publico/captura`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: (valores.email ?? "").trim(),
          page_slug: slug,
          // O navegador só diz "aceitou": o texto e a versão saem da config
          // da página, no servidor (decisão 5 do plano da prova).
          ...(consentimento ? { consentimento: aceitou } : {}),
          visitor_id: lerVisitante(document.cookie),
          // `website` por último: nenhum campo visível nem UTM pode apagar a isca.
          fields: { ...resto, ...utmDaUrl(), source: slug, website: isca },
        }),
      });
      if (!r.ok) {
        const lido = lerErroDoServidor(await r.json().catch(() => null));
        setErros(lido.campos);
        setErro(lido.mensagem);
        focarPrimeiroErro(Object.keys(lido.campos));
        return;
      }
      const corpo = await r.json().catch(() => ({}));
      if (corpo?.redirect_url) window.location.assign(corpo.redirect_url);
      else setEnviado(true);
    } catch {
      setErro(ERRO_GERAL);
    } finally {
      setEnviando(false);
    }
  }

  if (enviado) {
    // O formulário sai da tela de propósito — deixar os campos preenchidos
    // depois de um envio que já funcionou é o que convida a reenviar.
    // Texto puro: `mensagem_obrigado` nunca vira HTML.
    return (
      <div className="captura-sucesso" role="status">
        {(config.mensagem_obrigado?.trim() || OBRIGADO_PADRAO).split(/\n\s*\n/).map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={enviar} className="captura" noValidate>
      {campos.map((campo) => (
        <Controle key={campo.chave} campo={campo} valor={valores[campo.chave] ?? ""}
                  erro={erros[campo.chave]}
                  aoMudar={(v) => {
                    setValores((antes) => ({ ...antes, [campo.chave]: v }));
                    if (erros[campo.chave]) setErros(({ [campo.chave]: _, ...resto }) => resto);
                  }} />
      ))}
      {consentimento && (
        <div className="captura-consentimento">
          <label htmlFor="captura-consentimento">
            {/* Desmarcado por padrão: consentimento pré-marcado não é consentimento. */}
            <input id="captura-consentimento" type="checkbox" checked={aceitou}
                   aria-invalid={erros.consentimento ? true : undefined}
                   aria-describedby={erros.consentimento ? "captura-consentimento-erro" : undefined}
                   onChange={(e) => {
                     setAceitou(e.target.checked);
                     if (erros.consentimento) setErros(({ consentimento: _, ...resto }) => resto);
                   }} />
            <span>
              {consentimento.texto}
              {consentimento.link && (
                <>
                  {" "}
                  <a href={consentimento.link} target="_blank" rel="noopener noreferrer">
                    Política de privacidade
                  </a>
                </>
              )}
            </span>
          </label>
          {erros.consentimento && (
            <span id="captura-consentimento-erro" className="captura-erro-campo">{erros.consentimento}</span>
          )}
        </div>
      )}
      {/* Escondido por CSS, não `type="hidden"`: robô ignora hidden, mas
          preenche input de texto. Fora da tela, fora do Tab, fora do leitor de
          tela e do preenchimento automático do navegador. */}
      <div className="captura-isca" aria-hidden="true">
        <label htmlFor="captura-website">Site</label>
        <input
          id="captura-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={isca}
          onChange={(e) => setIsca(e.target.value)}
        />
      </div>
      {erro && <p className="erro" role="alert">{erro}</p>}
      <button type="submit" disabled={enviando}
              style={config.cta_color ? { background: config.cta_color } : undefined}>
        {enviando ? "Enviando..." : (config.cta_text || "Quero falar com um especialista")}
      </button>
    </form>
  );
}
