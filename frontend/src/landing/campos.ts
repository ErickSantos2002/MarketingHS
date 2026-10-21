// A config da página e a lógica pura do formulário da landing pública.
//
// ⚠️ Só sintaxe apagável e nenhum import: `node --test
// scripts/landing-campos.test.mjs` roda este arquivo direto no Node 24, que
// tira os tipos sem bundler. Nada de `enum`, `namespace`, parâmetro com
// modificador nem import de `@/`.
//
// O contrato da config é o do plano da prova
// (`docs/superpowers/plans/2026-10-21-prova-substituir-rd.md`, "O contrato da
// config da página"). O servidor lê a mesma config em
// `app/captura/campos.py::ler_definicoes` e valida de novo — o que se faz aqui
// é cortesia para quem preenche, nunca a defesa.

export type TipoDeCampo = "texto" | "email" | "telefone" | "lista" | "sim_nao" | "texto_longo";

export type CampoDaPagina = {
  chave: string;
  rotulo: string;
  tipo: TipoDeCampo;
  obrigatorio: boolean;
  opcoes?: string[];
};

export type ConsentimentoDaPagina = {
  texto: string;
  link: string;
  versao: string;
  provisoria: boolean;
  obrigatorio: boolean;
};

export type ConfigDaPagina = {
  nome_da_pagina?: string;
  headline?: string;
  subheadline?: string;
  cta_text?: string;
  cta_color?: string;
  visible_fields?: string[];
  redirect_url?: string;
  meta_title?: string;
  meta_description?: string;
  // Chaves da prova de substituição do RD (21/10).
  campos?: CampoDaPagina[];
  corpo?: string;
  imagem_url?: string;
  mensagem_obrigado?: string;
  consentimento?: ConsentimentoDaPagina;
  whatsapp?: { numero: string; mensagem: string };
  noindex?: boolean;
  tags?: string[];
};

export const TIPOS_DE_CAMPO: readonly TipoDeCampo[] = [
  "texto", "email", "telefone", "lista", "sim_nao", "texto_longo",
];

// A mesma regra de `CHAVE_EXTRA` do servidor. As colunas da lista branca
// (`CAMPOS_PERMITIDOS`) também casam com ela.
export const CHAVE_DE_CAMPO = /^[a-z][a-z0-9_]{0,39}$/;

// `website` é o campo-isca: um campo de verdade com essa chave seria apagado
// pela isca (ou, pior, faria o servidor descartar o lead como robô).
const CHAVES_RESERVADAS = new Set(["website"]);

export const ROTULOS_PADRAO: Record<string, string> = {
  nome: "Nome",
  email: "E-mail corporativo",
  whatsapp: "WhatsApp",
  cargo: "Cargo",
  empresa: "Empresa",
  funcionarios: "Número de colaboradores",
  faturamento: "Faturamento anual",
  desafios: "Qual o seu desafio hoje?",
};

// Os campos de quando a página não diz nada — os mesmos de antes da prova.
export const CAMPOS_PADRAO = ["nome", "email", "whatsapp", "cargo", "empresa"];

export const LIMITE_TEXTO = 200;
export const LIMITE_TEXTO_LONGO = 2000;

function campoDoEmail(rotulo?: string): CampoDaPagina {
  return { chave: "email", rotulo: rotulo || ROTULOS_PADRAO.email, tipo: "email", obrigatorio: true };
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

/**
 * Os campos que o formulário mostra. Com `config.campos`, os de lá (entrada
 * inválida descartada, chave repetida só a primeira); sem eles, `visible_fields`
 * como era antes: tudo texto, só o e-mail obrigatório. O e-mail está sempre
 * presente, é sempre do tipo e-mail e sempre obrigatório — sem ele não há lead.
 */
export function camposDaConfig(config: ConfigDaPagina): CampoDaPagina[] {
  const lista = Array.isArray(config?.campos) ? config.campos : null;
  if (lista && lista.length) {
    const vistos = new Set<string>();
    const saida: CampoDaPagina[] = [];
    for (const bruto of lista) {
      if (!bruto || typeof bruto !== "object") continue;
      const chave = texto(bruto.chave);
      if (!CHAVE_DE_CAMPO.test(chave) || CHAVES_RESERVADAS.has(chave) || vistos.has(chave)) continue;
      if (chave === "email") {
        vistos.add(chave);
        saida.push(campoDoEmail(texto(bruto.rotulo)));
        continue;
      }
      if (!TIPOS_DE_CAMPO.includes(bruto.tipo)) continue;
      const campo: CampoDaPagina = {
        chave,
        rotulo: texto(bruto.rotulo) || ROTULOS_PADRAO[chave] || chave,
        tipo: bruto.tipo,
        obrigatorio: bruto.obrigatorio === true,
      };
      if (bruto.tipo === "lista") {
        const opcoes = (Array.isArray(bruto.opcoes) ? bruto.opcoes : []).map(texto).filter(Boolean);
        // Lista sem opção não tem como ser respondida: não entra.
        if (!opcoes.length) continue;
        campo.opcoes = opcoes;
      }
      vistos.add(chave);
      saida.push(campo);
    }
    if (saida.length) {
      if (!vistos.has("email")) saida.unshift(campoDoEmail());
      return saida;
    }
  }

  const visiveis = Array.isArray(config?.visible_fields) && config.visible_fields.length
    ? config.visible_fields
    : CAMPOS_PADRAO;
  const saida: CampoDaPagina[] = [];
  const vistos = new Set<string>();
  for (const bruto of visiveis) {
    const chave = texto(bruto);
    if (!chave || vistos.has(chave) || CHAVES_RESERVADAS.has(chave)) continue;
    vistos.add(chave);
    saida.push(chave === "email"
      ? campoDoEmail()
      : { chave, rotulo: ROTULOS_PADRAO[chave] ?? chave, tipo: "texto", obrigatorio: false });
  }
  if (!vistos.has("email")) saida.unshift(campoDoEmail());
  return saida;
}

const FORMATO_DE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Celular do Brasil em E.164 (`+55` + DDD + 8 ou 9 dígitos), ou `null`.
 * A mesma regra de `normalizar_celular_br` no servidor: tira tudo que não é
 * dígito, o `55` da frente quando sobram 12–13 dígitos e o `0` da frente do
 * DDD; aceita 10 ou 11 dígitos com DDD de 11 a 99.
 */
export function normalizarCelular(valor: string): string | null {
  let d = String(valor ?? "").replace(/\D/g, "");
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);
  if (d.length !== 10 && d.length !== 11) return null;
  if (Number(d.slice(0, 2)) < 11) return null;
  return "+55" + d;
}

/** Erro por chave de campo; objeto vazio quando está tudo certo. */
export function validarNoCliente(
  campos: CampoDaPagina[],
  valores: Record<string, string>,
): Record<string, string> {
  const erros: Record<string, string> = {};
  for (const campo of campos) {
    const valor = texto(valores?.[campo.chave]);
    if (!valor) {
      if (campo.obrigatorio) {
        erros[campo.chave] = campo.tipo === "lista" || campo.tipo === "sim_nao"
          ? "Escolha uma opção."
          : "Preencha este campo.";
      }
      continue;
    }
    switch (campo.tipo) {
      case "email":
        if (valor.length > 320 || !FORMATO_DE_EMAIL.test(valor)) erros[campo.chave] = "Informe um e-mail válido.";
        break;
      case "telefone":
        if (!normalizarCelular(valor)) erros[campo.chave] = "Informe o celular com DDD.";
        break;
      case "lista":
        if (!(campo.opcoes ?? []).includes(valor)) erros[campo.chave] = "Escolha uma das opções.";
        break;
      case "sim_nao":
        if (valor !== "sim" && valor !== "nao") erros[campo.chave] = "Escolha sim ou não.";
        break;
      case "texto_longo":
        if (valor.length > LIMITE_TEXTO_LONGO) erros[campo.chave] = `Use até ${LIMITE_TEXTO_LONGO} caracteres.`;
        break;
      default:
        if (valor.length > LIMITE_TEXTO) erros[campo.chave] = `Use até ${LIMITE_TEXTO} caracteres.`;
    }
  }
  return erros;
}

export type BlocoDoCorpo = { tipo: "p"; texto: string } | { tipo: "lista"; itens: string[] };

/**
 * O corpo da landing em blocos de texto puro: parágrafos separados por linha
 * em branco; linha que começa com "- " vira item de lista. Nenhum HTML é
 * interpretado — quem desenha é o React, com texto, nunca `innerHTML`.
 */
export function paragrafosDoCorpo(corpo: string): BlocoDoCorpo[] {
  const saida: BlocoDoCorpo[] = [];
  const blocos = String(corpo ?? "").replace(/\r\n?/g, "\n").split(/\n\s*\n/);
  for (const bloco of blocos) {
    let paragrafo: string[] = [];
    let itens: string[] = [];
    const fecharParagrafo = () => {
      if (paragrafo.length) saida.push({ tipo: "p", texto: paragrafo.join(" ") });
      paragrafo = [];
    };
    const fecharLista = () => {
      if (itens.length) saida.push({ tipo: "lista", itens });
      itens = [];
    };
    for (const linhaBruta of bloco.split("\n")) {
      const linha = linhaBruta.trim();
      if (!linha) continue;
      const item = /^-\s+(.*)$/.exec(linha);
      if (item) {
        fecharParagrafo();
        if (item[1].trim()) itens.push(item[1].trim());
      } else {
        fecharLista();
        paragrafo.push(linha);
      }
    }
    fecharParagrafo();
    fecharLista();
  }
  return saida;
}

/** `https://wa.me/<só dígitos>?text=<mensagem codificada>`. */
export function linkDoWhatsapp(numero: string, mensagem: string): string {
  const digitos = String(numero ?? "").replace(/\D/g, "");
  const base = `https://wa.me/${digitos}`;
  return mensagem ? `${base}?text=${encodeURIComponent(mensagem)}` : base;
}

/** O id de visitante que o `rastreio.js` grava no cookie `mhs_vid`. */
export function lerVisitante(cookie: string): string | null {
  for (const pedaco of String(cookie ?? "").split(";")) {
    const i = pedaco.indexOf("=");
    if (i < 0 || pedaco.slice(0, i).trim() !== "mhs_vid") continue;
    let valor = pedaco.slice(i + 1).trim();
    try { valor = decodeURIComponent(valor); } catch { /* fica cru */ }
    return valor && valor.length <= 64 ? valor : null;
  }
  return null;
}
