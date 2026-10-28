import { useEffect, useMemo, useRef, useState } from "react";
import {
  consentimentoDaConfig, lerVisitante, toqueDaCaptura, urlSegura, validarNoCliente,
  type ConfigDaPagina,
} from "./campos";
import {
  MENSAGEM_CONTATO, MENSAGEM_CONVITE, MENSAGEM_JA_TEM, MENSAGEM_OCUPADO, MENSAGEM_SEM_HORARIO,
  NOMES_DOS_MESES, PREFIXO_DO_ID_NO_MODAL,
  ErroDoAgendamento, agendamentoAtivo, buscarHorarios, camposDaEtapa1, camposDaEtapa2,
  confirmarHorario, diaDeBrasilia, duracaoDaReuniao, enviarDados, enviarEmpresa, mensagemDoErroAoConfirmar, pedirLigacao,
  rotuloDoDia, rotuloDoHorario, semanasDoMes, type DiaComVaga,
} from "./agendamento";
import { Controle, utmDaUrl } from "./Formulario";

// O modal "Agende sua reunião" (frente agendamento, 28/10/2026), em etapas:
// 1 seus dados → 2 sua empresa → 3 horário → 4 confirmado. Quem não passa do
// corte de porte (ou não acha horário) termina em "nossa equipe vai entrar em
// contato" — e vira lead comum no servidor. Texto puro sempre: nada da config
// nem do servidor vira HTML.

type Etapa = 1 | 2 | 3 | 4 | "fim";
const ROTULOS_DAS_ETAPAS = ["Seus dados", "Sua empresa", "Horário", "Confirmado"];
const DIAS_DA_SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];

type Inicial = { valores: Record<string, string>; aceitou: boolean };

function mesDe(data: string): [number, number] {
  const [a, m] = data.split("-").map(Number);
  return [a, m];
}

export function Agendamento({ slug, config, onFechar, inicial }: {
  slug: string; config: ConfigDaPagina; onFechar: () => void; inicial?: Inicial;
}) {
  const etapa1 = camposDaEtapa1(config);
  const etapa2 = camposDaEtapa2(config);
  const consentimento = consentimentoDaConfig(config);
  const linkDaPolitica = consentimento ? urlSegura(consentimento.link, window.location.origin) : null;
  const duracao = duracaoDaReuniao(config);

  const [etapa, setEtapa] = useState<Etapa>(inicial ? 3 : 1);
  const [valores, setValores] = useState<Record<string, string>>(inicial?.valores ?? {});
  const [aceitou, setAceitou] = useState(inicial?.aceitou ?? false);
  const [isca, setIsca] = useState("");
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [dias, setDias] = useState<DiaComVaga[] | null>(null);
  const [mes, setMes] = useState<[number, number] | null>(null);
  const [diaEscolhido, setDiaEscolhido] = useState<string | null>(null);
  const [horario, setHorario] = useState<string | null>(null);
  const [confirmado, setConfirmado] = useState<string | null>(null);
  const [mensagemFinal, setMensagemFinal] = useState(MENSAGEM_CONTATO);
  const caixa = useRef<HTMLDivElement>(null);
  const comecou = useRef(false);

  // Esc fecha; Tab fica preso no modal; o foco entra no modal ao abrir e
  // volta para quem o abriu ao fechar.
  useEffect(() => {
    const antes = document.activeElement as HTMLElement | null;
    const focaveis = () => Array.from(caixa.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? [])
      .filter((el) => !el.hasAttribute("disabled") && el.tabIndex !== -1);
    focaveis()[0]?.focus();
    function tecla(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); onFechar(); return; }
      if (e.key !== "Tab") return;
      const lista = focaveis();
      if (!lista.length) return;
      const primeiro = lista[0];
      const ultimo = lista[lista.length - 1];
      if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
    }
    document.addEventListener("keydown", tecla);
    const rolagem = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", tecla);
      document.body.style.overflow = rolagem;
      antes?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function terminar(mensagem: string) {
    setMensagemFinal(mensagem);
    setEtapa("fim");
  }

  function corpoDosDados(v: Record<string, string>, aceite: boolean, website: string) {
    return {
      page_slug: slug,
      email: (v.email ?? "").trim(),
      nome: (v.nome ?? "").trim(),
      whatsapp: (v.whatsapp ?? "").trim(),
      ...(consentimento ? { consentimento: aceite } : {}),
      visitor_id: lerVisitante(document.cookie),
      page_url: window.location.href.slice(0, 2000),
      ...toqueDaCaptura(window.location.search, document.referrer),
      fields: { ...utmDaUrl(), source: slug },
      website,
    };
  }

  function soDaEtapa2(v: Record<string, string>) {
    const saida: Record<string, string> = {};
    for (const c of etapa2) {
      const valor = (v[c.chave] ?? "").trim();
      if (valor) saida[c.chave] = valor;
    }
    return saida;
  }

  async function carregarHorarios(t: string) {
    setDias(null);
    setDiaEscolhido(null);
    setHorario(null);
    try {
      const r = await buscarHorarios(t);
      if ("indisponivel" in r) {
        await pedirLigacao(t).catch(() => undefined);
        terminar(MENSAGEM_SEM_HORARIO);
        return;
      }
      setDias(r.dias);
      setMes(mesDe(r.dias[0].data));
    } catch (e) {
      setErro(e instanceof ErroDoAgendamento ? e.message : "Não conseguimos carregar os horários.");
      setDias([]);
    }
  }

  async function depoisDaEmpresa(t: string, pode: boolean) {
    if (!pode) { terminar(MENSAGEM_CONTATO); return; }
    setEtapa(3);
    await carregarHorarios(t);
  }

  // Vindo do formulário normal ("Quer adiantar?"): etapas 1 e 2 já
  // preenchidas — manda as duas e vai direto aos horários.
  useEffect(() => {
    if (!inicial || comecou.current) return;
    comecou.current = true;
    (async () => {
      try {
        const { token: t } = await enviarDados(corpoDosDados(inicial.valores, inicial.aceitou, ""));
        setToken(t);
        const { pode_agendar } = await enviarEmpresa(t, soDaEtapa2(inicial.valores));
        await depoisDaEmpresa(t, pode_agendar);
      } catch (e) {
        setErro(e instanceof ErroDoAgendamento ? e.message : "Não conseguimos agendar agora.");
        setEtapa(1);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enviarEtapa1(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const novos = validarNoCliente(etapa1, valores);
    if (consentimento?.obrigatorio && !aceitou) {
      novos.consentimento = "Para continuar, aceite a política de privacidade.";
    }
    setErros(novos);
    if (Object.keys(novos).length) return;
    setOcupado(true);
    try {
      const { token: t } = await enviarDados(corpoDosDados(valores, aceitou, isca));
      setToken(t);
      setEtapa(2);
    } catch (err) {
      if (err instanceof ErroDoAgendamento) { setErros(err.campos); setErro(err.message); }
    } finally {
      setOcupado(false);
    }
  }

  async function enviarEtapa2(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setErro(null);
    const novos = validarNoCliente(etapa2, valores);
    setErros(novos);
    if (Object.keys(novos).length) return;
    setOcupado(true);
    try {
      const { pode_agendar } = await enviarEmpresa(token, soDaEtapa2(valores));
      await depoisDaEmpresa(token, pode_agendar);
    } catch (err) {
      if (err instanceof ErroDoAgendamento) {
        if (err.status === 404) { setEtapa(1); setToken(null); }
        setErros(err.campos);
        setErro(err.message);
      }
    } finally {
      setOcupado(false);
    }
  }

  async function confirmar() {
    if (!token || !horario) return;
    setErro(null);
    setOcupado(true);
    try {
      const r = await confirmarHorario(token, horario);
      if (r.status === "reservada") { setConfirmado(r.inicio); setEtapa(4); }
      else if (r.status === "ja_tem") terminar(MENSAGEM_JA_TEM);
      else if (r.status === "ocupado") { await carregarHorarios(token); setErro(MENSAGEM_OCUPADO); }
      else { await pedirLigacao(token).catch(() => undefined); terminar(MENSAGEM_SEM_HORARIO); }
    } catch (err) {
      if (err instanceof ErroDoAgendamento && err.status === 404) {
        terminar(MENSAGEM_CONTATO);
      } else {
        setErro((err instanceof ErroDoAgendamento
          ? mensagemDoErroAoConfirmar(err.status, err.message) : null)
          ?? "Não conseguimos agendar agora.");
      }
    } finally {
      setOcupado(false);
    }
  }

  const porDia = useMemo(() => new Map((dias ?? []).map((d) => [d.data, d.horarios])), [dias]);
  const meses = useMemo(() => Array.from(new Set((dias ?? []).map((d) => d.data.slice(0, 7)))), [dias]);
  const chaveDoMes = mes ? `${mes[0]}-${String(mes[1]).padStart(2, "0")}` : "";
  const indiceDoMes = meses.indexOf(chaveDoMes);

  function mudar(chave: string, v: string) {
    setValores((antes) => ({ ...antes, [chave]: v }));
    if (erros[chave]) setErros(({ [chave]: _, ...resto }) => resto);
  }

  const passo = etapa === "fim" ? null : etapa;

  return (
    <div className="agenda-fundo" onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div ref={caixa} className="agenda-modal" role="dialog" aria-modal="true"
           aria-labelledby="agenda-titulo">
        <div className="agenda-cabeca">
          <div>
            <h2 id="agenda-titulo">Agende sua reunião</h2>
            <p className="agenda-meta">{duracao} min · Sala de vídeo</p>
          </div>
          <button type="button" className="agenda-fechar" aria-label="Fechar" onClick={onFechar}>×</button>
        </div>

        {passo && (
          <ol className="agenda-passos" aria-label="Etapas">
            {ROTULOS_DAS_ETAPAS.map((r, i) => (
              <li key={r} className={i + 1 === passo ? "atual" : i + 1 < passo ? "feito" : undefined}
                  aria-current={i + 1 === passo ? "step" : undefined}>
                <span className="agenda-numero">{i + 1}</span>
                <span className="agenda-rotulo-passo">{r}</span>
              </li>
            ))}
          </ol>
        )}

        {etapa === 1 && (
          <form className="captura" onSubmit={enviarEtapa1} noValidate>
            {etapa1.map((c) => (
              <Controle key={c.chave} campo={c} valor={valores[c.chave] ?? ""} erro={erros[c.chave]}
                        prefixoDoId={PREFIXO_DO_ID_NO_MODAL}
                        aoMudar={(v) => mudar(c.chave, v)} />
            ))}
            {consentimento && (
              <div className="captura-consentimento">
                <label htmlFor="agenda-consentimento">
                  <input id="agenda-consentimento" type="checkbox" checked={aceitou}
                         onChange={(e) => setAceitou(e.target.checked)} />
                  <span>
                    {consentimento.texto}
                    {linkDaPolitica && (
                      <>{" "}<a href={linkDaPolitica} target="_blank" rel="noopener noreferrer">
                        Política de privacidade</a></>
                    )}
                  </span>
                </label>
                {erros.consentimento && <span className="captura-erro-campo">{erros.consentimento}</span>}
              </div>
            )}
            <div className="captura-isca" aria-hidden="true">
              <label htmlFor="agenda-website">Site</label>
              <input id="agenda-website" name="website" type="text" tabIndex={-1} autoComplete="off"
                     value={isca} onChange={(e) => setIsca(e.target.value)} />
            </div>
            {erro && <p className="erro" role="alert">{erro}</p>}
            <button type="submit" disabled={ocupado}>{ocupado ? "Enviando..." : "Continuar"}</button>
          </form>
        )}

        {etapa === 2 && (
          <form className="captura" onSubmit={enviarEtapa2} noValidate>
            {etapa2.map((c) => (
              <Controle key={c.chave} campo={c} valor={valores[c.chave] ?? ""} erro={erros[c.chave]}
                        prefixoDoId={PREFIXO_DO_ID_NO_MODAL}
                        aoMudar={(v) => mudar(c.chave, v)} />
            ))}
            {erro && <p className="erro" role="alert">{erro}</p>}
            <button type="submit" disabled={ocupado}>{ocupado ? "Enviando..." : "Continuar"}</button>
          </form>
        )}

        {etapa === 3 && (
          <div className="agenda-horarios">
            {dias === null ? (
              <p className="agenda-carregando" role="status">Buscando horários livres…</p>
            ) : dias.length === 0 ? (
              <>
                {erro && <p className="erro" role="alert">{erro}</p>}
                <button type="button" className="agenda-botao"
                        onClick={() => token && carregarHorarios(token)}>Tentar de novo</button>
              </>
            ) : (
              <>
                <div className="agenda-calendario">
                  <div className="agenda-mes">
                    <button type="button" aria-label="Mês anterior" disabled={indiceDoMes <= 0}
                            onClick={() => setMes(mesDe(`${meses[indiceDoMes - 1]}-01`))}>‹</button>
                    <span>{mes ? `${NOMES_DOS_MESES[mes[1] - 1]} de ${mes[0]}` : ""}</span>
                    <button type="button" aria-label="Próximo mês"
                            disabled={indiceDoMes < 0 || indiceDoMes >= meses.length - 1}
                            onClick={() => setMes(mesDe(`${meses[indiceDoMes + 1]}-01`))}>›</button>
                  </div>
                  <table>
                    <thead>
                      <tr>{DIAS_DA_SEMANA.map((d, i) => <th key={i} scope="col">{d}</th>)}</tr>
                    </thead>
                    <tbody>
                      {mes && semanasDoMes(mes[0], mes[1]).map((semana, i) => (
                        <tr key={i}>
                          {semana.map((data, j) => (
                            <td key={j}>
                              {data && (porDia.has(data) ? (
                                <button type="button"
                                        className={data === diaEscolhido ? "agenda-dia escolhido" : "agenda-dia"}
                                        aria-pressed={data === diaEscolhido}
                                        aria-label={rotuloDoDia(data)}
                                        onClick={() => { setDiaEscolhido(data); setHorario(null); }}>
                                  {Number(data.slice(8))}
                                </button>
                              ) : (
                                <span className="agenda-dia sem-vaga">{Number(data.slice(8))}</span>
                              ))}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="agenda-lista">
                  <p className="agenda-fuso">Horário de Brasília</p>
                  {diaEscolhido ? (
                    <>
                      <p className="agenda-dia-escolhido">{rotuloDoDia(diaEscolhido)}</p>
                      <div className="agenda-botoes-horario">
                        {(porDia.get(diaEscolhido) ?? []).map((h) => (
                          <button key={h} type="button" aria-pressed={h === horario}
                                  className={h === horario ? "agenda-horario escolhido" : "agenda-horario"}
                                  onClick={() => setHorario(h)}>
                            {rotuloDoHorario(h)}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="agenda-dica">Escolha um dia destacado no calendário.</p>
                  )}
                  {erro && <p className="erro" role="alert">{erro}</p>}
                  <button type="button" className="agenda-botao" disabled={!horario || ocupado}
                          onClick={confirmar}>
                    {ocupado ? "Confirmando..." : horario
                      ? `Confirmar ${rotuloDoHorario(horario)}` : "Confirmar horário"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {etapa === 4 && confirmado && (
          <div className="agenda-final" role="status">
            <p className="agenda-final-titulo">Reunião confirmada</p>
            <p>
              {rotuloDoDia(diaDeBrasilia(confirmado))}, às {rotuloDoHorario(confirmado)} (horário de Brasília).
            </p>
            <p>{MENSAGEM_CONVITE}</p>
            <button type="button" className="agenda-botao" onClick={onFechar}>Fechar</button>
          </div>
        )}

        {etapa === "fim" && (
          <div className="agenda-final" role="status">
            <p>{mensagemFinal}</p>
            <button type="button" className="agenda-botao" onClick={onFechar}>Fechar</button>
          </div>
        )}
      </div>
    </div>
  );
}

/** O botão "Agendar reunião" ao lado do formulário. */
export function BotaoAgendar({ slug, config }: { slug: string; config: ConfigDaPagina }) {
  const [aberto, setAberto] = useState(false);
  if (!agendamentoAtivo(config)) return null;
  return (
    <>
      <button type="button" className="agenda-abrir" onClick={() => setAberto(true)}>
        Agendar reunião
      </button>
      {aberto && <Agendamento slug={slug} config={config} onFechar={() => setAberto(false)} />}
    </>
  );
}
