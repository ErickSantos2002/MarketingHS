// Agendamento de reunião pela landing (frente agendamento, 28/10/2026): as
// regras puras do modal e as chamadas às rotas públicas
// (`backend/app/routers/agendamento.py`).
//
//   node --test scripts/landing-agendamento.test.mjs
//
// Só sintaxe apagável e nenhum import de `@/`: o Node tira os tipos e roda o
// arquivo direto. A regra do corte (`podeAgendar`) é cortesia — quem decide é
// o servidor (`app/agendamento/config.py::pode_agendar`).
import { camposDaConfig, type CampoDaPagina, type ConfigDaPagina } from "./campos.ts";

// O mesmo BASE do `Formulario.tsx`: em produção o nginx só repassa /api/.
// `?.` porque no `node --test` não há `import.meta.env`.
const BASE: string = (import.meta as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL ?? "/api";
const ROTA = `${BASE}/publico/agendamento`;

export const FUSO = "America/Sao_Paulo";
export const CHAVES_DA_ETAPA_1 = ["email", "nome", "whatsapp"];
export const MENSAGEM_JA_TEM =
  "Você já tem uma reunião marcada — o convite com dia, hora e link está no seu e-mail.";
export const MENSAGEM_OCUPADO = "Esse horário acabou de ser ocupado. Escolha outro.";
export const MENSAGEM_CONTATO = "Recebemos seus dados. Nossa equipe vai entrar em contato.";
export const MENSAGEM_SEM_HORARIO =
  "Não há horário livre nos próximos dias. Deixe que a gente liga: nossa equipe vai entrar em contato.";

function faixas(config: ConfigDaPagina): string[] {
  const lista = config?.agendamento?.faixas_que_agendam;
  return Array.isArray(lista) ? lista.filter((f): f is string => typeof f === "string" && !!f.trim()) : [];
}

/** O botão aparece: agendamento ligado e com ao menos uma faixa. */
export function agendamentoAtivo(config: ConfigDaPagina): boolean {
  return config?.agendamento?.ativo === true && faixas(config).length > 0;
}

export function campoDoPorte(config: ConfigDaPagina): string {
  const c = config?.agendamento?.campo_porte;
  return typeof c === "string" && /^[a-z][a-z0-9_]{0,39}$/.test(c) ? c : "funcionarios";
}

/** Espelho de `pode_agendar`: o porte informado está numa das faixas. */
export function podeAgendar(config: ConfigDaPagina, valores: Record<string, string>): boolean {
  if (!agendamentoAtivo(config)) return false;
  const valor = (valores?.[campoDoPorte(config)] ?? "").trim();
  return !!valor && faixas(config).includes(valor);
}

export function duracaoDaReuniao(config: ConfigDaPagina): number {
  const d = config?.agendamento?.duracao_min;
  return typeof d === "number" && d >= 15 && d <= 240 ? Math.round(d) : 60;
}

/** Etapa 1: e-mail, nome e WhatsApp — os da página, ou os padrão. */
export function camposDaEtapa1(config: ConfigDaPagina): CampoDaPagina[] {
  const daPagina = camposDaConfig(config);
  const padrao: Record<string, CampoDaPagina> = {
    nome: { chave: "nome", rotulo: "Nome", tipo: "texto", obrigatorio: true },
    email: { chave: "email", rotulo: "E-mail corporativo", tipo: "email", obrigatorio: true },
    whatsapp: { chave: "whatsapp", rotulo: "WhatsApp", tipo: "telefone", obrigatorio: true },
  };
  return ["nome", "email", "whatsapp"].map((chave) => {
    const achado = daPagina.find((c) => c.chave === chave);
    // Para agendar, os três são obrigatórios (o vendedor liga se precisar).
    return achado ? { ...achado, obrigatorio: true } : padrao[chave];
  });
}

/** Etapa 2: todos os campos da página menos nome, e-mail e WhatsApp. */
export function camposDaEtapa2(config: ConfigDaPagina): CampoDaPagina[] {
  return camposDaConfig(config).filter((c) => !CHAVES_DA_ETAPA_1.includes(c.chave));
}

/** `"2026-10-29T15:00:00Z"` → `"12:00"` (Brasília). */
export function rotuloDoHorario(isoUtc: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(isoUtc));
}

/** `"2026-10-29"` → `"quinta-feira, 29 de outubro"`. */
export function rotuloDoDia(data: string): string {
  // Meio-dia UTC: o mesmo dia em Brasília, sem risco de virar a data.
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO, weekday: "long", day: "numeric", month: "long",
  }).format(new Date(`${data}T12:00:00Z`));
}

/** O dia de Brasília de um horário UTC, `"2026-10-29"`. */
export function diaDeBrasilia(isoUtc: string): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(isoUtc));
  return partes;
}

export const NOMES_DOS_MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto",
  "setembro", "outubro", "novembro", "dezembro",
];

/** As semanas do mês (domingo primeiro), com `"aaaa-mm-dd"` ou `null`. */
export function semanasDoMes(ano: number, mes: number): (string | null)[][] {
  const primeiro = new Date(Date.UTC(ano, mes - 1, 1)).getUTCDay();
  const dias = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const celulas: (string | null)[] = Array(primeiro).fill(null);
  for (let d = 1; d <= dias; d++) {
    celulas.push(`${ano}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  while (celulas.length % 7) celulas.push(null);
  const semanas: (string | null)[][] = [];
  for (let i = 0; i < celulas.length; i += 7) semanas.push(celulas.slice(i, i + 7));
  return semanas;
}

// ── Chamadas ────────────────────────────────────────────────────────────────

export type DiaComVaga = { data: string; horarios: string[] };
export type Horarios = { dias: DiaComVaga[]; duracao_min: number } | { indisponivel: true };
export type Confirmacao =
  | { status: "reservada"; inicio: string; fim: string }
  | { status: "ja_tem" }
  | { status: "ocupado" }
  | { status: "indisponivel" };

export class ErroDoAgendamento extends Error {
  campos: Record<string, string>;
  status: number;
  constructor(mensagem: string, status: number, campos: Record<string, string> = {}) {
    super(mensagem);
    this.status = status;
    this.campos = campos;
  }
}

const ERRO_GERAL = "Não conseguimos agendar agora. Tente de novo.";

async function pedir<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${ROTA}${caminho}`, {
      method: metodo,
      headers: corpo === undefined ? undefined : { "Content-Type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  } catch {
    throw new ErroDoAgendamento(ERRO_GERAL, 0);
  }
  const json = await r.json().catch(() => null);
  if (r.status === 409) return { status: "ocupado" } as T;
  if (!r.ok) {
    const detalhe = (json as { detail?: unknown } | null)?.detail;
    if (typeof detalhe === "string" && detalhe) throw new ErroDoAgendamento(detalhe, r.status);
    if (detalhe && typeof detalhe === "object" && !Array.isArray(detalhe)) {
      const { mensagem, campos } = detalhe as { mensagem?: unknown; campos?: unknown };
      const porCampo: Record<string, string> = {};
      if (campos && typeof campos === "object") {
        for (const [k, v] of Object.entries(campos as Record<string, unknown>)) {
          if (typeof v === "string") porCampo[k] = v;
        }
      }
      throw new ErroDoAgendamento(typeof mensagem === "string" && mensagem ? mensagem : ERRO_GERAL,
                                  r.status, porCampo);
    }
    throw new ErroDoAgendamento(ERRO_GERAL, r.status);
  }
  return json as T;
}

export function enviarDados(corpo: Record<string, unknown>): Promise<{ token: string }> {
  return pedir("POST", "/dados", corpo);
}

export function enviarEmpresa(token: string, fields: Record<string, string>):
    Promise<{ pode_agendar: boolean }> {
  return pedir("POST", `/${encodeURIComponent(token)}/empresa`, { fields });
}

export function buscarHorarios(token: string): Promise<Horarios> {
  return pedir("GET", `/horarios/${encodeURIComponent(token)}`);
}

export function confirmarHorario(token: string, inicio: string): Promise<Confirmacao> {
  return pedir("POST", `/${encodeURIComponent(token)}/confirmar`, { inicio });
}

export function pedirLigacao(token: string): Promise<{ ok: boolean }> {
  return pedir("POST", `/${encodeURIComponent(token)}/ligar`);
}
