import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowRight, Loader2, CalendarCheck, Heart, Sparkles, CheckCircle2, AlertCircle } from "lucide-react";
import { getUtmParams } from "@/lib/utm";
import { registerConversion } from "@/lib/leadConversion";
import { captureLead } from "@/lib/leadCapture";
import { getAbParams, recordAbConversion } from "@/lib/ab";
import { isICPRevenue, isDecisionMaker } from "@/hooks/useLeadQualification";
import { sendMetaConversion } from "@/lib/metaCapi";
import { trackLeadDedup, trackCompleteRegistration } from "@/lib/metaTracking";
import { validateEmailFormat, checkEmailDomainMX } from "@/lib/emailValidation";
import { validateFullName } from "@/lib/nameValidation";

const SCHEDULE_URL = "https://nexus.dnia.ai/schedule/9cdd014b-a8ab-46ab-bbfb-0fb1e154e540";
const NEXUS_STAGE_LEAD_QUALIFICADO = "f932c109-846f-48ce-9a1b-787537e89932";

function NexusScheduleEmbed({ nome, email, whatsapp }: { nome: string; email: string; whatsapp: string }) {
  const bookedRef = useRef(false);
  const bookingEventIdRef = useRef(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

  useEffect(() => {
    const fireBookingEvent = () => {
      if (bookedRef.current) return;

      bookedRef.current = true;
      const eventId = bookingEventIdRef.current;
      const firstName = nome.split(" ")[0];
      const ab = getAbParams();

      console.log("[CalComEmbed] Booking detected! Firing Agendamento event with event_id:", eventId);

      // Fire Meta CAPI (server-side)
      sendMetaConversion({
        event_name: "Agendamento",
        event_id: eventId,
        email,
        phone: whatsapp,
        first_name: firstName,
        custom_data: {
          lead_type: "humanos_e_agentes",
          source: "diagnostico_modal",
          event_type: "agendamento",
          ab_test: ab.ab_test,
          ab_var: ab.ab_var,
        },
      });

      // Fire Meta Pixel (client-side) for deduplication
      if (typeof window !== "undefined" && (window as any).fbq) {
        (window as any).fbq(
          "trackCustom",
          "Agendamento",
          {
            lead_type: "humanos_e_agentes",
            email,
            phone: whatsapp,
            first_name: firstName,
          },
          { eventID: eventId }
        );
        console.log("[Meta Pixel] Agendamento client-side event fired with eventID:", eventId);
      }

      // Conversão A/B `agendamento` no coletor (redundância ao caminho server-side
      // via Nexus; idempotente por dedupe_key).
      recordAbConversion("agendamento", { lead_type: "humanos_e_agentes" });
    };

    function handleMessage(event: MessageEvent) {
      // Log all messages for debugging
      console.log("[CalComEmbed] postMessage received:", event.origin, event.data);
      
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        
        // Cal.com sends various event formats - check all known patterns
        const isBookingSuccess = 
          data?.action === "bookingSuccessfulV2" ||
          data?.action === "bookingSuccessful" ||
          data?.event === "booking_successful" ||
          data?.type === "booking_successful" ||
          data?.event === "bookingSuccessful" ||
          data?.event === "bookingSuccessfulV2" ||
          // Cal.com internal format
          (data?.type === "CAL:bookingSuccessfulV2") ||
          (data?.type === "CAL:bookingSuccessful") ||
          // Check for route change to success page
          (typeof data === "object" && JSON.stringify(data).includes("bookingSuccessful"));
        
        if (isBookingSuccess) {
          fireBookingEvent();
        }
      } catch {
        // Not a JSON message - check for string patterns
        if (typeof event.data === "string" && 
            (event.data.includes("bookingSuccessful") || event.data.includes("booking_successful"))) {
          fireBookingEvent();
        }
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [nome, email, whatsapp]);

  const iframeSrc = (() => {
    const url = new URL(SCHEDULE_URL);
    if (nome) url.searchParams.set("name", nome);
    if (email) url.searchParams.set("email", email);
    if (whatsapp) url.searchParams.set("whatsapp", whatsapp);
    url.searchParams.set("tag", "humanoseagentes");
    url.searchParams.set("source", "humanoseagentes");
    const utms = getUtmParams();
    if (utms.utm_source) url.searchParams.set("utm_source", utms.utm_source);
    if (utms.utm_medium) url.searchParams.set("utm_medium", utms.utm_medium);
    if (utms.utm_campaign) url.searchParams.set("utm_campaign", utms.utm_campaign);
    if (utms.utm_term) url.searchParams.set("utm_term", utms.utm_term);
    if (utms.utm_content) url.searchParams.set("utm_content", utms.utm_content);
    // Leva a atribuição A/B para dentro do agendamento (o Nexus lê da URL).
    const ab = getAbParams();
    if (ab.ab_vid) url.searchParams.set("ab_vid", ab.ab_vid);
    if (ab.ab_test) url.searchParams.set("ab_test", ab.ab_test);
    if (ab.ab_var) url.searchParams.set("ab_var", ab.ab_var);
    return url.toString();
  })();

  return (
    <div className="m-0 p-0 border-0 overflow-hidden">
      <iframe
        src={iframeSrc}
        className="w-full h-[700px] border-0"
        loading="eager"
        title="Agendar diagnóstico"
      />
    </div>
  );
}

const FATURAMENTO_OPTIONS = [
  "Até R$ 100 mil por mês",
  "Entre R$ 100 mil e R$ 500 mil por mês",
  "Entre R$ 500 mil e R$ 1 milhão por mês",
  "Entre R$ 1 milhão e R$ 3 milhões por mês",
  "Entre R$ 3 milhões e R$ 5 milhões por mês",
  "Acima de R$ 5 milhões por mês",
];

const CARGO_OPTIONS = [
  "CEO / Fundador",
  "Diretor(a)",
  "Gerente / Coordenador(a)",
  "Analista / Especialista",
  "Consultor(a)",
  "Outro",
];

const FUNCIONARIOS_OPTIONS = [
  "Individual",
  "2 - 10",
  "11 - 25",
  "26 - 49",
  "Acima de 50",
];

interface DiagnosticoModalHumanosProps {
  isOpen: boolean;
  onClose: () => void;
}

type ModalStep = "step1" | "step2" | "qualified" | "not-qualified";

export function DiagnosticoModalHumanos({ isOpen, onClose }: DiagnosticoModalHumanosProps) {
  const [step, setStep] = useState<ModalStep>("qualified");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [cargo, setCargo] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [faturamento, setFaturamento] = useState("");
  const [funcionarios, setFuncionarios] = useState("");
  const [loading, setLoading] = useState(false);
  const [emailStatus, setEmailStatus] = useState<"idle" | "checking" | "valid" | "invalid">("idle");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [nomeError, setNomeError] = useState<string | null>(null);
  const [savingStep1, setSavingStep1] = useState(false);
  const partialLeadIdRef = useRef<string | null>(null);

  // Validação de email com debounce: formato + descartáveis (sync) + MX (async)
  useEffect(() => {
    if (!email) {
      setEmailStatus("idle");
      setEmailError(null);
      return;
    }

    const fmt = validateEmailFormat(email);
    if (!fmt.valid) {
      setEmailStatus("invalid");
      setEmailError(fmt.reason ?? "Email inválido.");
      return;
    }

    setEmailStatus("checking");
    setEmailError(null);

    const handle = setTimeout(async () => {
      const result = await checkEmailDomainMX(email);
      // Só aplica se o email não mudou enquanto checava
      setEmail((current) => {
        if (current.toLowerCase().trim() !== email.toLowerCase().trim()) return current;
        if (result.valid) {
          setEmailStatus("valid");
          setEmailError(null);
        } else {
          setEmailStatus("invalid");
          setEmailError(result.reason ?? "Email inválido.");
        }
        return current;
      });
    }, 600);

    return () => clearTimeout(handle);
  }, [email]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome || !email || !whatsapp || !cargo || !empresa || !faturamento || !funcionarios) return;

    setLoading(true);
    try {
      const utms = getUtmParams();
      const sessionId = sessionStorage.getItem("session_id") || crypto.randomUUID();
      sessionStorage.setItem("session_id", sessionId);
      const normalizedEmail = email.toLowerCase().trim();

      const { lead, error } = await captureLead({
        email: normalizedEmail,
        sessionId,
        fields: {
          nome,
          whatsapp,
          cargo,
          empresa,
          faturamento,
          funcionarios: funcionarios || undefined,
          tipo: "Humanos e Agentes",
          source: "/humanoseagentes",
          status: "Lead",
          utm_source: utms.utm_source,
          utm_medium: utms.utm_medium,
          utm_campaign: utms.utm_campaign,
          utm_term: utms.utm_term,
          utm_content: utms.utm_content,
        },
      });

      if (error || !lead) throw new Error(error || "capture_failed");
      console.log("[DiagnosticoModalHumanos] step2 lead saved:", lead.id, "partial was:", partialLeadIdRef.current);

      // The DB trigger `trg_score_lead_on_change` already calculates etiqueta server-side
      // when the lead is inserted/updated via the lead-capture edge function (service role).
      const etiqueta: string | null = lead.etiqueta ?? null;

      await registerConversion({
        leadId: lead.id,
        tipo: "Humanos e Agentes",
        pageSlug: "/humanoseagentes",
        sessionId,
      });

      // Resolve identity (fire-and-forget)
      import('@/lib/resolveIdentity').then(({ resolveIdentityForLead }) => {
        resolveIdentityForLead({
          leadId: lead.id,
          whatsapp,
          email: normalizedEmail,
          nome,
          utm_source: utms.utm_source,
        });
      });

      // Fire Meta CompleteRegistration (Pixel + CAPI deduplicado)
      trackCompleteRegistration({
        email: normalizedEmail,
        phone: whatsapp,
        first_name: nome.split(" ")[0],
        custom_data: {
          lead_type: "humanos_e_agentes",
          source: "diagnostico_modal",
          cargo,
          empresa,
          faturamento,
          funcionarios,
        },
      });

      const qualified = etiqueta
        ? etiqueta === 'hotlead'
        : (isICPRevenue(faturamento) && isDecisionMaker(cargo));

      if (qualified) {
        // Step 3 qualified: promote lead to "Lead Qualificado" and handoff to Nexus (fire-and-forget)
        (async () => {
          // Status e identidade (dnia_id) são gravados no servidor pela Edge
          // Function `lead-capture` — o navegador não escreve direto em `leads`
          // nem chama a RPC de identidade com a chave publicável.
          try {
            await captureLead({
              email: normalizedEmail,
              mode: 'update_only',
              fields: { status: 'Lead Qualificado' },
            });
          } catch (e) {
            console.error('[DiagnosticoModalHumanos] update status Lead Qualificado failed:', e);
          }

          try {
            await supabase.from('contact_events').insert({
              lead_id: lead.id,
              dnia_id: (lead as any).dnia_id ?? null,
              source_app: 'dnmarketing',
              event_type: 'lead_qualified',
              title: 'Lead qualificado via diagnóstico',
              description: 'Lead avançou para etapa 3 do diagnóstico como qualificado',
              metadata: {
                status_anterior: 'Lead',
                status_atual: 'Lead Qualificado',
                source: 'diagnostico_modal',
              },
            });
          } catch (e) {
            console.error('[DiagnosticoModalHumanos] contact_events insert failed:', e);
          }

          try {
            const { evaluateAndExecute } = await import('@/lib/automationEngine');
            await evaluateAndExecute({
              id: lead.id,
              status: 'Lead Qualificado',
              etiqueta: (lead as any).etiqueta ?? null,
              lead_score: (lead as any).lead_score ?? null,
              dnia_id: (lead as any).dnia_id ?? null,
            });
          } catch (e) {
            console.error('[DiagnosticoModalHumanos] evaluateAndExecute failed:', e);
          }

          console.log('[DiagnosticoModalHumanos] Invoking handoff-to-nexus (direct_stage) for lead', lead.id);
          supabase.functions
            .invoke('handoff-to-nexus', {
              body: {
                lead_id: lead.id,
                stage_id: NEXUS_STAGE_LEAD_QUALIFICADO,
                stage_name: 'Lead Qualificado',
                source: 'diagnostico_modal',
                direct_stage: true,
                tags: ['humanoseagentes'],
              },
            })
            .then((res) => console.log('[DiagnosticoModalHumanos] handoff-to-nexus response:', res))
            .catch((err) => console.error('[DiagnosticoModalHumanos] handoff-to-nexus error:', err));
        })();
      }

      setStep(qualified ? "qualified" : "not-qualified");
    } catch (err) {
      console.error(err);
      toast.error("Erro ao enviar. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setStep("qualified");
    setNome("");
    setEmail("");
    setWhatsapp("");
    setCargo("");
    setEmpresa("");
    setFaturamento("");
    setFuncionarios("");
    partialLeadIdRef.current = null;
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-3xl bg-card border-border max-h-[90vh] overflow-y-auto">
        {step === "step1" && (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl font-bold">Falar com especialista</DialogTitle>
              <DialogDescription>
                Preencha seus dados para descobrir como a IA pode transformar seu negócio.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 pt-2">
              <div>
                <Label htmlFor="diag-nome">Nome completo *</Label>
                <Input
                  id="diag-nome"
                  value={nome}
                  onChange={(e) => {
                    setNome(e.target.value);
                    if (nomeError) setNomeError(null);
                  }}
                  onBlur={() => {
                    if (!nome) return;
                    const r = validateFullName(nome);
                    setNomeError(r.valid ? null : r.reason ?? "Nome inválido");
                  }}
                  placeholder="Seu nome e sobrenome"
                  aria-invalid={!!nomeError}
                  className={nomeError ? "border-destructive focus-visible:ring-destructive" : ""}
                />
                {nomeError && (
                  <p className="mt-1 text-xs text-destructive flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    {nomeError}
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="diag-email" className="flex items-center gap-2">
                  E-mail corporativo *
                  {emailStatus === "checking" && (
                    <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                  )}
                  {emailStatus === "valid" && (
                    <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                  )}
                </Label>
                <Input
                  id="diag-email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    const v = e.target.value;
                    setEmail(v);
                    // Validação síncrona imediata de formato
                    if (!v) {
                      setEmailStatus("idle");
                      setEmailError(null);
                      return;
                    }
                    const fmt = validateEmailFormat(v);
                    if (!fmt.valid) {
                      setEmailStatus("invalid");
                      setEmailError(fmt.reason ?? "Email inválido.");
                    }
                  }}
                  onBlur={async () => {
                    if (!email) return;
                    const fmt = validateEmailFormat(email);
                    if (!fmt.valid) {
                      setEmailStatus("invalid");
                      setEmailError(fmt.reason ?? "Email inválido.");
                      return;
                    }
                    if (emailStatus === "valid") return;
                    setEmailStatus("checking");
                    setEmailError(null);
                    const result = await checkEmailDomainMX(email);
                    if (result.valid) {
                      setEmailStatus("valid");
                      setEmailError(null);
                    } else {
                      setEmailStatus("invalid");
                      setEmailError(result.reason ?? "Email inválido.");
                    }
                  }}
                  placeholder="email@empresa.com"
                  aria-invalid={!!emailError}
                  className={emailError ? "border-destructive focus-visible:ring-destructive" : ""}
                />
                {emailError && (
                  <p className="mt-1 text-xs text-destructive flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    {emailError}
                  </p>
                )}
              </div>
              <div>
              <Label htmlFor="diag-whatsapp">WhatsApp *</Label>
                <Input id="diag-whatsapp" value={whatsapp} onChange={(e) => {
                  const raw = e.target.value.replace(/\D/g, "").slice(0, 11);
                  let formatted = raw;
                  if (raw.length > 2) formatted = `(${raw.slice(0, 2)}) ${raw.slice(2)}`;
                  if (raw.length > 7) formatted = `(${raw.slice(0, 2)}) ${raw.slice(2, 7)}-${raw.slice(7)}`;
                  setWhatsapp(formatted);
                }} placeholder="(31) 99999-9999" inputMode="tel" />
              </div>
              <Button
                className="w-full bg-primary hover:bg-primary/90 font-semibold py-5"
                disabled={!nome || !email || !whatsapp || !!nomeError || emailStatus === "checking" || emailStatus === "invalid" || savingStep1}
                onClick={async () => {
                  // Valida nome completo
                  const nameCheck = validateFullName(nome);
                  if (!nameCheck.valid) {
                    setNomeError(nameCheck.reason ?? "Nome inválido");
                    return;
                  }
                  // Defesa em profundidade: revalida sincronamente antes de avançar
                  const fmt = validateEmailFormat(email);
                  if (!fmt.valid) {
                    setEmailStatus("invalid");
                    setEmailError(fmt.reason ?? "Email inválido.");
                    return;
                  }
                  if (emailStatus !== "valid") {
                    setEmailStatus("checking");
                    const result = await checkEmailDomainMX(email);
                    if (!result.valid) {
                      setEmailStatus("invalid");
                      setEmailError(result.reason ?? "Email inválido.");
                      return;
                    }
                    setEmailStatus("valid");
                  }

                  // Salva o lead parcial em /contacts ANTES de avançar para o step 2.
                  // Se a captura falhar, mantém o usuário no step 1 e mostra um erro.
                  setSavingStep1(true);
                  try {
                    const utms = getUtmParams();
                    const sessionId = sessionStorage.getItem("session_id") || crypto.randomUUID();
                    sessionStorage.setItem("session_id", sessionId);
                    const normalizedEmail = email.toLowerCase().trim();

                    const { lead, error } = await captureLead({
                      email: normalizedEmail,
                      sessionId,
                      fields: {
                        nome,
                        whatsapp,
                        tipo: "Humanos e Agentes",
                        source: "/humanoseagentes",
                        status: "Lead",
                        utm_source: utms.utm_source,
                        utm_medium: utms.utm_medium,
                        utm_campaign: utms.utm_campaign,
                        utm_term: utms.utm_term,
                        utm_content: utms.utm_content,
                      },
                    });

                    if (error || !lead?.id) {
                      console.error("[DiagnosticoModalHumanos] step1 captureLead failed:", { error, lead });
                      toast.error("Não conseguimos salvar seus dados. Tente novamente.");
                      setSavingStep1(false);
                      return;
                    }

                    partialLeadIdRef.current = lead.id;
                    console.log("[DiagnosticoModalHumanos] step1 lead saved:", lead.id);

                    await registerConversion({
                      leadId: lead.id,
                      tipo: "Humanos e Agentes - Step 1",
                      pageSlug: "/humanoseagentes",
                      sessionId,
                    });

                    // Dispara Meta Lead apenas depois do salvamento bem-sucedido
                    trackLeadDedup({
                      email: normalizedEmail,
                      phone: whatsapp,
                      first_name: nome.split(" ")[0],
                      custom_data: {
                        lead_type: "humanos_e_agentes",
                        source: "diagnostico_modal",
                        step: "step1_continuar",
                      },
                    });
                  } catch (err) {
                    console.error("[DiagnosticoModalHumanos] step1 partial save failed:", err);
                    toast.error("Não conseguimos salvar seus dados. Tente novamente.");
                    setSavingStep1(false);
                    return;
                  } finally {
                    setSavingStep1(false);
                  }

                  setStep("step2");
                }}
              >
                {emailStatus === "checking" || savingStep1 ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    Continuar
                    <ArrowRight className="w-4 h-4 ml-1" />
                  </>
                )}
              </Button>
              <div className="flex justify-center gap-2 pt-1">
                <span className="w-2 h-2 rounded-full bg-primary" />
                <span className="w-2 h-2 rounded-full bg-muted" />
              </div>
            </div>
          </>
        )}

        {step === "step2" && (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl font-bold">Quase lá! 🚀</DialogTitle>
              <DialogDescription>
                Agora conte um pouco sobre sua empresa para entendermos se o diagnóstico faz sentido para você agora.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-3 pt-2">
              <div>
                <Label>Cargo *</Label>
                <Select value={cargo} onValueChange={setCargo} required>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione seu cargo" />
                  </SelectTrigger>
                  <SelectContent>
                    {CARGO_OPTIONS.map((opt) => (
                      <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="diag-empresa">Empresa *</Label>
                <Input id="diag-empresa" value={empresa} onChange={(e) => setEmpresa(e.target.value)} placeholder="Nome da empresa" required />
              </div>
              <div>
                <Label>Faturamento mensal *</Label>
                <Select value={faturamento} onValueChange={setFaturamento} required>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a faixa" />
                  </SelectTrigger>
                  <SelectContent>
                    {FATURAMENTO_OPTIONS.map((opt) => (
                      <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Número de funcionários *</Label>
                <Select value={funcionarios} onValueChange={setFuncionarios} required>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a faixa" />
                  </SelectTrigger>
                  <SelectContent>
                    {FUNCIONARIOS_OPTIONS.map((opt) => (
                      <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" className="w-full bg-primary hover:bg-primary/90 font-semibold py-5" disabled={loading}>
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    Continuar
                    <ArrowRight className="w-4 h-4 ml-1" />
                  </>
                )}
              </Button>
              <button type="button" onClick={() => setStep("step1")} className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors">
                ← Voltar
              </button>
              <div className="flex justify-center gap-2">
                <span className="w-2 h-2 rounded-full bg-muted" />
                <span className="w-2 h-2 rounded-full bg-primary" />
              </div>
              <p className="text-[10px] text-center text-muted-foreground">
                100% gratuito. Sem compromisso. Focado no seu negócio.
              </p>
            </form>
          </>
        )}

        {step === "qualified" && (
          <div className="pt-2" />
        )}

        {(step === "step2" || step === "qualified") && (
          <div
            className={
              step === "qualified"
                ? ""
                : "absolute opacity-0 pointer-events-none -z-10 h-0 w-0 overflow-hidden"
            }
            aria-hidden={step !== "qualified"}
          >
            <NexusScheduleEmbed nome={nome} email={email} whatsapp={whatsapp} />
          </div>
        )}

        {step === "qualified" && (
          <p className="text-xs text-center text-muted-foreground mt-2">
            Escolha o melhor horário para uma conversa individual sobre IA no seu negócio.
          </p>
        )}

        {step === "not-qualified" && (
          <div className="flex flex-col items-center text-center py-4 gap-5">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Heart className="w-8 h-8 text-primary" />
            </div>
            <div className="space-y-3">
              <h3 className="text-xl font-bold">
                Obrigado pelo seu interesse, {nome.split(" ")[0]}! 💛
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto">
                Analisamos seu perfil e, neste momento, o Programa de IAficação foi desenhado 
                para empresas com um faturamento um pouco maior e um time mais estruturado — 
                e queremos ser honestos com você sobre isso.
              </p>
              <div className="bg-muted/40 rounded-lg p-4 border border-border">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Sparkles className="w-4 h-4 text-primary" />
                  <span className="text-sm font-semibold">Mas você não fica de fora!</span>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Vamos te enviar por <strong className="text-foreground">email</strong> conteúdos exclusivos sobre IA 
                  que vão te ajudar a chegar lá mais rápido. Quando for a hora certa, a gente se encontra. 🚀
                </p>
              </div>
            </div>
            <Button onClick={handleClose} className="bg-primary hover:bg-primary/90 font-semibold px-8 py-5">
              Combinado!
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
