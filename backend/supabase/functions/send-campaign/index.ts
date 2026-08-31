import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";
import { validateAuth } from "../_shared/auth.ts";

// ENFILEIRADOR (Fase 3). Canal email: resolve a audiencia, cria campaign_sends
// 'pending' em lote, publica na fila pgmq email_send_queue e retorna imediatamente.
// O envio de fato acontece no worker process-email-queue (drenado por pg_cron).
// Canal whatsapp: continua sincrono via Z-API, exatamente como antes.
//
// TODA a logica por-destinatario de email (supressao, merge tags, unsubscribe URL,
// rodape, headers RFC 8058, tags de correlacao, captura do resend_email_id) vive
// agora em supabase/functions/process-email-queue/index.ts -- NAO reintroduzir aqui.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Status a partir dos quais uma campanha pode ser (re)enfileirada.
// 'sending' e 'sent' ficam de fora: e o que impede enfileiramento duplo.
const STARTABLE = new Set(["draft", "scheduled", "failed", "paused"]);

// AUTENTICACAO (correcao I6, achado do review final): este endpoint estava com
// verify_jwt=false no config.toml (necessario -- e chamado por cron/server-to-server
// sem JWT de usuario) e NENHUMA checagem de autorizacao no corpo da funcao. Qualquer
// pessoa que descobrisse o UUID de uma campanha conseguia forcar o envio imediato
// (ate 5000 leads) via um simples POST anonimo. Dois caminhos legitimos, ambos
// preservados:
//   1. server-to-server: cron (promote_scheduled_campaigns -> invoke_edge_function,
//      migration 20260713220000, ja manda `Authorization: Bearer <webhook_secret do
//      Vault>`) e campaigns-api (agora ajustado para mandar o mesmo WEBHOOK_SECRET em
//      vez da service role key -- ver campaigns-api/index.ts). validateAuth cobre
//      WEBHOOK_SECRET e chaves da tabela api_keys.
//   2. navegador: CampaignWizard chama supabase.functions.invoke('send-campaign', ...)
//      autenticado com o JWT da sessao do admin logado (supabase-js anexa
//      automaticamente). Nao existia nenhum outro caminho autenticado pronto para o
//      wizard usar sem reescrever seu fluxo de "Enviar agora" -- por isso a escolha foi
//      aceitar esse JWT aqui, com checagem de role admin, no MESMO padrao ja usado por
//      delete-contact/index.ts (auth.getUser() + user_roles). Menor superficie nova
//      possivel: nenhuma mudanca no CampaignWizard foi necessaria.
async function isAuthorized(req: Request, sb: any): Promise<boolean> {
  // 1. Server-to-server: WEBHOOK_SECRET (cron, campaigns-api) ou API key (api_keys).
  if (await validateAuth(req, sb, "write")) return true;

  // 2. Navegador: JWT do usuario logado, com role admin (mesmo padrao de delete-contact).
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return false;

  try {
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return false;

    const { data: roleData } = await sb
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    return !!roleData;
  } catch (err) {
    console.error("send-campaign isAuthorized (user JWT path) error:", err);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Desfaz o claim (sending -> status observado antes do CAS), devolvendo a campanha
  // ao estado reenfileiravel. Definido fora do try porque o catch externo nao enxerga
  // as consts declaradas dentro dele. So e populado DEPOIS de um CAS bem-sucedido.
  // Nunca lanca: uma falha no rollback nao pode mascarar o erro original.
  let releaseClaim: (() => Promise<void>) | null = null;

  // Correcao I2 (achado do review final): so podemos reverter o claim (voltar a
  // campanha para draft/scheduled/etc.) se NENHUMA mensagem chegou a ser publicada
  // na fila. Se um throw acontece DEPOIS da passada 2 (publicacao), reverter faria:
  //   (a) o worker ver campaign.status != 'sending' no proximo tick e falhar
  //       TERMINALMENTE cada send ja publicado ("campanha nao esta em envio");
  //   (b) um re-run posterior do send-campaign excluir esses mesmos leads da
  //       audiencia (classificados como "ja processados" -- status 'failed' nao e
  //       'pending') -- os leads nunca mais recebem o email, em silencio.
  // Preferimos deixar a campanha travada em 'sending': o worker drena o que foi
  // publicado, e os sweepers (reset_stuck_campaigns / recover_lost_sends, migration
  // 20260713220000) cobrem a recuperacao do restante. Setado true assim que a
  // PRIMEIRA chamada a email_queue_send_batch tiver sucesso.
  let publishedAny = false;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // I6: autenticacao obrigatoria -- ver isAuthorized() acima para os dois caminhos
    // aceitos (server-to-server via WEBHOOK_SECRET/API key, ou JWT de admin do wizard).
    if (!(await isAuthorized(req, supabase))) {
      return json({ error: "Unauthorized" }, 401);
    }

    const { campaign_id } = await req.json();
    if (!campaign_id) return json({ error: "campaign_id is required" }, 400);

    const { data: campaign, error: campError } = await supabase
      .from("campaigns")
      .select("*")
      .eq("id", campaign_id)
      .single();

    if (campError || !campaign) return json({ error: "Campaign not found" }, 404);

    if (!STARTABLE.has(String(campaign.status))) {
      return json({ error: "campanha já está em envio ou enviada", status: campaign.status }, 409);
    }

    // Status observado ANTES do CAS: e para ele que o rollback devolve a campanha.
    const observedStatus = String(campaign.status);

    // CLAIM ATOMICO: CAS do status observado -> 'sending', ANTES de qualquer
    // trabalho pesado. Duas invocacoes concorrentes (ex.: dois ticks do cron de
    // agendamento) disputam este UPDATE; a perdedora recebe 0 linhas e aborta.
    // E isto que garante que uma campanha nunca e enfileirada duas vezes.
    const { data: claimed, error: claimErr } = await supabase
      .from("campaigns")
      .update({ status: "sending" })
      .eq("id", campaign_id)
      .eq("status", observedStatus)
      .select("id");

    if (claimErr) return json({ error: `claim failed: ${claimErr.message}` }, 500);
    if (!claimed || claimed.length === 0) {
      return json({ error: "campanha já está em envio (claim perdido)" }, 409);
    }

    // A partir daqui a campanha esta em 'sending'. Se abortarmos sem desfazer o claim,
    // ela fica presa: 'sending' nao esta em STARTABLE e a UI nao tem reset. O
    // .eq('status','sending') evita pisar num status que o worker ja tenha avancado.
    releaseClaim = async () => {
      try {
        await supabase
          .from("campaigns")
          .update({ status: observedStatus })
          .eq("id", campaign_id)
          .eq("status", "sending");
      } catch (rbErr) {
        console.error("send-campaign rollback do claim falhou:", rbErr);
      }
    };

    // ---- Resolucao de audiencia (multi-segmento) ----------------------------
    // Toda a logica de uniao/exclusao/deduplicacao vive na RPC
    // resolve_segment_audience -- a MESMA que o wizard usa para exibir a contagem.
    // Duas implementacoes separadas divergiriam, e a divergencia apareceria como
    // "o card dizia 500 e sairam 480".
    //
    // Retrocompatibilidade: campanhas criadas antes da migration so tem
    // `segment_id`. Arrays vazios + segment_id nulo = todos os contatos.
    const includeIds: string[] = Array.isArray(campaign.segment_ids) && campaign.segment_ids.length > 0
      ? campaign.segment_ids.map(String)
      : (campaign.segment_id ? [String(campaign.segment_id)] : []);
    const excludeIds: string[] = Array.isArray(campaign.excluded_segment_ids)
      ? campaign.excluded_segment_ids.map(String)
      : [];

    // Teto de 5000 SOMENTE no caminho "todos os contatos" -- e exatamente o
    // `.limit(5000)` que existia antes. Com segmentos de inclusao nao ha teto,
    // que tambem e o comportamento anterior.
    const { data: audience, error: audErr } = await supabase.rpc("resolve_segment_audience", {
      p_include: includeIds,
      p_exclude: excludeIds,
      p_limit: includeIds.length === 0 ? 5000 : null,
    });

    if (audErr) {
      // Nada foi publicado na fila ainda, entao desfazer o claim e seguro e e o
      // que mantem a campanha reenfileiravel. Um segmento apagado cai aqui (a RPC
      // levanta excecao de proposito) -- falha visivel em vez de enviar para a
      // audiencia errada.
      console.error("send-campaign resolve_segment_audience error:", audErr);
      await releaseClaim();
      return json({ error: `falha ao resolver a audiência: ${audErr.message}` }, 500);
    }

    const audienceIds = ((audience as Array<{ lead_id: string }> | null) || []).map((r) => r.lead_id);

    const leads: any[] = [];
    for (let i = 0; i < audienceIds.length; i += 200) {
      const batch = audienceIds.slice(i, i + 200);
      const { data, error: lErr } = await supabase.from("leads").select("*").in("id", batch);
      if (lErr) {
        console.error("send-campaign fetch leads error:", lErr);
        await releaseClaim();
        return json({ error: `falha ao carregar os contatos da audiência: ${lErr.message}` }, 500);
      }
      if (data) leads.push(...data);
    }

    // ================= CANAL WHATSAPP: sincrono, como antes ==================
    if (campaign.channel !== "email") {
      const zapiUrl = Deno.env.get("ZAPI_INSTANCE_URL");
      const zapiToken = Deno.env.get("ZAPI_TOKEN");

      const replaceVars = (text: string, lead: any) =>
        text
          .replace(/\{\{nome\}\}/g, lead.nome || "")
          .replace(/\{\{email\}\}/g, lead.email || "")
          .replace(/\{\{empresa\}\}/g, lead.empresa || lead.cargo || "");

      let sentCount = 0;
      let failedCount = 0;

      for (const lead of leads) {
        let status = "sent";
        let error: string | null = null;
        try {
          if (!zapiUrl || !zapiToken) {
            status = "failed";
            error = "ZAPI credentials not configured";
          } else {
            const phone = lead.phone_normalized || lead.whatsapp;
            if (!phone) {
              status = "failed";
              error = "Lead has no phone number";
            } else {
              const res = await fetch(`${zapiUrl}/send-text`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: zapiToken },
                body: JSON.stringify({
                  phone: String(phone).replace(/\D/g, ""),
                  message: replaceVars(campaign.body || "", lead),
                }),
              });
              if (!res.ok) {
                const errBody = await res.text();
                status = "failed";
                error = `Z-API error: ${res.status} - ${errBody}`;
              }
            }
          }
        } catch (err) {
          status = "failed";
          error = String(err);
        }

        if (status === "sent") sentCount++;
        else failedCount++;

        await supabase.from("campaign_sends").insert({
          campaign_id: campaign.id,
          lead_id: lead.id,
          dnia_id: lead.dnia_id || null,
          channel: campaign.channel,
          status,
          sent_at: new Date().toISOString(),
          error,
        });
      }

      await supabase.rpc("finalize_campaign_if_drained", { p_campaign_id: campaign.id });
      return json({ sent: sentCount, failed: failedCount });
    }

    // ===================== CANAL EMAIL: enfileira ============================
    // Reenfileiramento (STARTABLE inclui 'failed' e 'paused'): a audiencia e
    // re-resolvida por inteiro, mas o indice unico parcial
    // uniq_campaign_sends_email_campaign_lead (campaign_id, lead_id) WHERE channel='email'
    // NAO e escopado por status. Sem tratar quem ja tem linha, um unico lead
    // conflitante derrubaria o INSERT do chunk inteiro (500 linhas, incluindo leads
    // novos).
    //
    // Mas as linhas existentes se dividem em DOIS casos, e trata-los igual quebra
    // a recuperacao: uma linha 'pending' orfa (criada na passada 1 de uma execucao
    // que morreu ANTES de publicar na fila, na passada 2) nunca foi enviada. Se a
    // excluissemos como "ja processada", ela ficaria encalhada para sempre: nao pode
    // ser re-inserida (indice unico) nem seria republicada, e a campanha ficaria
    // presa em 'sending' (fora de STARTABLE) com pending > 0 impedindo o finalize.
    //   - linha NAO-pending  -> lead realmente processado: exclui da audiencia.
    //   - linha 'pending'    -> orfa (ou ainda na fila): NAO re-inserir, mas RE-PUBLICAR
    //                           o send_id existente na passada 2. Republicar e seguro:
    //                           se a mensagem antiga ainda estiver na fila, o worker
    //                           processa a primeira e a segunda encontra a linha ja
    //                           nao-'pending' -> pula e deleta (o claim do worker e o
    //                           que garante o envio unico).
    // E isto que torna um re-run do send-campaign um caminho de recuperacao real.
    const processedLeadIds = new Set<string>();
    const orphanPending: { id: string; lead_id: string }[] = [];
    for (let from = 0; from < 20000; from += 1000) {
      const { data: existing, error: exErr } = await supabase
        .from("campaign_sends")
        .select("id, lead_id, status")
        .eq("campaign_id", campaign.id)
        .eq("channel", "email")
        .not("lead_id", "is", null)
        .order("lead_id") // sem ORDER BY, .range() nao garante paginacao estavel
        .range(from, from + 999);

      // Um conjunto de exclusao INCOMPLETO e pior do que nenhum: reintroduz
      // exatamente o conflito de indice unico que a exclusao existe para evitar
      // (um lead conflitante derruba o INSERT do chunk de 500 inteiro). Abortamos
      // e desfazemos o claim, deixando a campanha reenfileiravel.
      if (exErr) {
        console.error("send-campaign fetch existing campaign_sends error:", exErr);
        await releaseClaim();
        return json(
          { error: `falha ao carregar envios existentes da campanha: ${exErr.message}` },
          500,
        );
      }
      for (const r of existing ?? []) {
        if (String(r.status) === "pending") {
          orphanPending.push({ id: String(r.id), lead_id: String(r.lead_id) });
        } else {
          processedLeadIds.add(String(r.lead_id));
        }
      }
      if (existing.length < 1000) break;
    }

    // Leads com linha 'pending' preexistente tambem nao podem ser re-inseridos
    // (indice unico) -- eles entram na passada 2 pelo orphanPending.
    const pendingLeadIds = new Set<string>(orphanPending.map((r) => r.lead_id));
    const fresh = leads.filter(
      (l) => !processedLeadIds.has(String(l.id)) && !pendingLeadIds.has(String(l.id)),
    );
    const alreadySent = leads.filter((l) => processedLeadIds.has(String(l.id))).length;

    const withEmail = fresh.filter((l: any) => l.email && String(l.email).trim().length > 0);
    const withoutEmail = fresh.filter((l: any) => !l.email || String(l.email).trim().length === 0);

    // Leads sem email nunca entram na fila: viram 'failed' aqui mesmo.
    // (A supressao NAO e checada aqui de proposito -- ela e checada no worker,
    //  o mais proximo possivel do envio, para nao usar uma lista defasada.)
    if (withoutEmail.length > 0) {
      const rows = withoutEmail.map((l: any) => ({
        campaign_id: campaign.id,
        lead_id: l.id,
        dnia_id: l.dnia_id || null,
        channel: "email",
        status: "failed",
        sent_at: new Date().toISOString(),
        error: "Lead has no email",
      }));
      for (let i = 0; i < rows.length; i += 500) {
        await supabase.from("campaign_sends").insert(rows.slice(i, i + 500));
      }
    }

    // So podemos sair cedo se nao ha NEM leads novos NEM linhas 'pending' orfas para
    // republicar -- senao as orfas ficariam encalhadas e a campanha nunca fecharia.
    if (withEmail.length === 0 && orphanPending.length === 0) {
      await supabase.rpc("finalize_campaign_if_drained", { p_campaign_id: campaign.id });
      return json({
        queued: 0,
        skipped: withoutEmail.length + alreadySent,
        campaign_id: campaign.id,
      });
    }

    // Enfileiramento em DUAS PASSADAS ESTRITAMENTE ORDENADAS. Isto NAO e um detalhe
    // de estilo: e o que elimina, por construcao, a corrida do finalize.
    //
    // O worker (process-email-queue) fecha a campanha via finalize_campaign_if_drained,
    // que so olha `count(*) FILTER (WHERE status='pending')` em campaign_sends. Se
    // intercalassemos insert e enqueue chunk a chunk (como antes), existiria uma janela
    // real: o worker drena as mensagens do chunk 1 enquanto o enfileirador ainda nem
    // inseriu as linhas do chunk 2 -> pending chega a 0 -> a campanha e fechada como
    // 'sent' cedo demais. E como o UPDATE do finalize e guardado por `status='sending'`,
    // todo recompute posterior de stats vira no-op e os chunks seguintes sao rejeitados
    // pelo proprio worker ("campanha nao esta em envio") -- subcontagem permanente e
    // silenciosa.
    //
    // Passada 1: insere TODAS as linhas 'pending' da audiencia inteira.
    // Passada 2: so entao publica as mensagens na fila.
    // Assim, no instante em que a PRIMEIRA mensagem fica visivel para o worker,
    // campaign_sends ja contem uma linha 'pending' para CADA destinatario -- pending
    // nunca pode passar por zero enquanto ainda ha trabalho por vir. Sem timing, sem sleep.
    const CHUNK = 500;

    // ---- PASSADA 1: todas as linhas 'pending' primeiro -----------------------
    // A linha campaign_sends precisa existir antes da mensagem de qualquer forma
    // (o worker resolve a mensagem pelo send_id; mensagem orfa seria descartada).
    const insertedSends: { id: string; lead_id: string }[] = [];
    for (let i = 0; i < withEmail.length; i += CHUNK) {
      const chunk = withEmail.slice(i, i + CHUNK);

      const { data: inserted, error: insErr } = await supabase
        .from("campaign_sends")
        .insert(
          chunk.map((l: any) => ({
            campaign_id: campaign.id,
            lead_id: l.id,
            dnia_id: l.dnia_id || null,
            channel: "email",
            status: "pending",
            sent_at: null,
          })),
        )
        .select("id, lead_id");

      if (insErr || !inserted) {
        // O insert do chunk falhou por inteiro: nenhuma linha foi criada, entao nao
        // ha nada para marcar como failed -- apenas nao ha o que enfileirar para estes
        // leads (mesmo comportamento de antes). Os demais chunks seguem normalmente.
        console.error("send-campaign insert campaign_sends error:", insErr);
        continue;
      }

      for (const s of inserted as any[]) {
        insertedSends.push({ id: String(s.id), lead_id: String(s.lead_id) });
      }
    }

    // ---- PASSADA 2: publica na fila, so depois da passada 1 completa ---------
    // Publica as linhas recem-inseridas E as 'pending' orfas de uma execucao anterior
    // que morreu antes de chegar aqui. E isto que faz de um re-run do send-campaign um
    // caminho de recuperacao de verdade, em vez de deixar as orfas encalhadas.
    const toPublish = [...insertedSends, ...orphanPending];
    let queued = 0;
    for (let i = 0; i < toPublish.length; i += CHUNK) {
      const chunk = toPublish.slice(i, i + CHUNK);

      const messages = chunk.map((s) => ({
        send_id: s.id,
        campaign_id: campaign.id,
        lead_id: s.lead_id,
      }));

      const { data: n, error: qErr } = await supabase.rpc("email_queue_send_batch", {
        p_messages: messages,
      });

      if (qErr) {
        // As linhas ficaram 'pending' sem mensagem na fila. Marcamos como failed
        // para nao travar o fechamento da campanha (finalize exige pending == 0).
        console.error("send-campaign email_queue_send_batch error:", qErr);
        await supabase
          .from("campaign_sends")
          .update({ status: "failed", error: `enqueue failed: ${qErr.message}`, sent_at: new Date().toISOString() })
          .in("id", chunk.map((s) => s.id))
          .eq("status", "pending");
        continue;
      }

      // A partir daqui ha mensagens de verdade na fila para esta campanha -- reverter
      // o claim deixaria de ser seguro (ver comentario de publishedAny, acima).
      publishedAny = true;
      queued += typeof n === "number" ? n : messages.length;
    }

    // Fechamento defensivo: se NENHUM chunk chegou na fila (todos os enqueues
    // falharam), as linhas viraram 'failed' e nenhum worker jamais vai rodar para
    // esta campanha -- ela ficaria presa em 'sending' para sempre e, como 'sending'
    // nao esta em STARTABLE, nem poderia ser reenviada. finalize_campaign_if_drained
    // e idempotente (checa pending == 0 internamente): se algo foi enfileirado,
    // ainda ha 'pending' e esta chamada e um no-op; o worker fecha a campanha depois.
    await supabase.rpc("finalize_campaign_if_drained", { p_campaign_id: campaign.id });

    return json({
      queued,
      skipped: withoutEmail.length + alreadySent,
      campaign_id: campaign.id,
    });
  } catch (err) {
    // Qualquer throw depois do CAS (ex.: limite de wall-clock/memoria da Edge Function
    // no meio do loop de chunks, numa audiencia grande) deixaria a campanha presa em
    // 'sending' -- estado do qual ela NAO pode ser reenviada ('sending' fora de STARTABLE)
    // e que a UI nao sabe resetar. Desfazemos o claim antes de propagar o erro.
    // releaseClaim() ja engole suas proprias falhas: um rollback quebrado nunca pode
    // mascarar o erro original.
    //
    // EXCECAO (I2): se ja publicamos alguma mensagem na fila, NAO revertemos -- ver o
    // comentario de publishedAny. Reverter depois de publicar troca "campanha presa em
    // sending" (recuperavel pelos sweepers) por "leads publicados nunca recebem o email,
    // em silencio" (nao recuperavel). Deixamos a campanha 'sending' de proposito.
    if (releaseClaim && !publishedAny) {
      await releaseClaim();
    } else if (publishedAny) {
      console.error(
        "send-campaign: erro apos publicar mensagens na fila -- claim NAO revertido " +
        "(campanha permanece 'sending' para nao perder em silencio o que ja foi publicado; " +
        "sweepers reset_stuck_campaigns/recover_lost_sends cobrem a recuperacao):",
        err,
      );
    }
    return json({ error: String(err) }, 500);
  }
});
