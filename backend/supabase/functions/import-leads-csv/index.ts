import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdmin } from "../_shared/callerAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface LeadData {
  email?: string;
  nome?: string;
  whatsapp?: string;
  fullPhone?: string;
  empresa?: string;
  cargo?: string;
  faturamento?: string;
  funcionarios?: string;
  desafios_ia?: string;
  source?: string;
  status?: string;
}

const VALID_STATUSES = [
  'Lead',
  'Iniciado',
  'Lead Qualificado',
  'MQL - Reunião agendada',
  'SQL - Em negociação',
  'Em contrato',
  'Venda realizada',
];

const normalizeStatus = (raw?: string): string | null => {
  if (!raw) return null;
  const s = raw.trim();
  const match = VALID_STATUSES.find(
    (v) => v.toLowerCase() === s.toLowerCase()
  );
  return match ?? null;
};

interface ImportRequest {
  leads: LeadData[];
  mergeMode?: 'enrich' | 'overwrite'; // enrich = só preenche vazios, overwrite = sobrescreve tudo
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Validate JWT in code
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Importacao em massa: exige admin (JWT com role admin) ou chamada server-to-server.
  const denied = await requireAdmin(req, corsHeaders);
  if (denied) return denied;

  try {
    // Use service role for database operations
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { leads, mergeMode = 'enrich' } = await req.json() as ImportRequest;
    
    console.log(`Recebidos ${leads.length} leads para processar (modo: ${mergeMode})`);
    
    let updated = 0;
    let created = 0;
    let notFound = 0;
    let unchanged = 0;
    let skippedNoEmail = 0;
    let fieldsEnriched = 0;
    let fieldsSkipped = 0;
    const errors: string[] = [];
    const notFoundEmails: string[] = [];
    const processedLeadIds: string[] = [];

    // Bulk SELECT: buscar todos os leads existentes do lote em uma única query
    const batchEmails = Array.from(
      new Set(
        leads
          .map((l) => l.email?.toLowerCase().trim())
          .filter((e): e is string => !!e)
      )
    );

    const existingByEmail = new Map<string, {
      id: string;
      email: string;
      nome: string | null;
      whatsapp: string | null;
      empresa: string | null;
      cargo: string | null;
      faturamento: string | null;
      funcionarios: string | null;
      desafios: string | null;
      source: string | null;
      status: string | null;
    }>();

    if (batchEmails.length > 0) {
      // Chunk .in() para evitar URLs excessivamente longas
      const IN_CHUNK = 500;
      for (let i = 0; i < batchEmails.length; i += IN_CHUNK) {
        const slice = batchEmails.slice(i, i + IN_CHUNK);
        const { data: existingRows, error: bulkSelectError } = await supabaseClient
          .from('leads')
          .select('id, email, nome, whatsapp, empresa, cargo, faturamento, funcionarios, desafios, source, status')
          .in('email', slice);

        if (bulkSelectError) {
          console.error('Erro no bulk select:', bulkSelectError.message);
          errors.push(`bulk_select: ${bulkSelectError.message}`);
          continue;
        }
        for (const row of existingRows ?? []) {
          existingByEmail.set(row.email.toLowerCase(), row);
        }
      }
    }

    for (const lead of leads) {
      const email = lead.email?.toLowerCase().trim();
      if (!email) {
        console.log('Lead sem email, pulando...');
        skippedNoEmail++;
        continue;
      }

      const existingLead = existingByEmail.get(email) ?? null;
      const csvStatus = normalizeStatus(lead.status);

      if (!existingLead) {
        // Criar novo lead com os dados do CSV
        const insertData: Record<string, string | number | null> = {
          email,
          status: csvStatus || 'Lead',
          lead_score: 0,
          tipo: (lead as { tipo?: string }).tipo || 'csv_import',
        };
        if (lead.nome) insertData.nome = lead.nome;
        if (lead.whatsapp || lead.fullPhone) insertData.whatsapp = lead.whatsapp || lead.fullPhone!;
        if (lead.empresa) insertData.empresa = lead.empresa;
        if (lead.cargo) insertData.cargo = lead.cargo;
        if (lead.faturamento) insertData.faturamento = lead.faturamento;
        if (lead.funcionarios) insertData.funcionarios = lead.funcionarios;
        if (lead.desafios_ia) insertData.desafios = lead.desafios_ia;
        insertData.source = lead.source || 'csv_import';

        const { data: newLead, error: insertError } = await supabaseClient
          .from('leads')
          .insert(insertData)
          .select('id')
          .single();

        if (insertError || !newLead) {
          console.error(`Erro ao criar ${email}:`, insertError?.message);
          errors.push(`${email}: ${insertError?.message || 'falha ao criar lead'}`);
          notFound++;
          notFoundEmails.push(email);
          continue;
        }

        console.log(`Lead criado: ${email}`);
        created++;
        processedLeadIds.push(newLead.id);

        // Resolve identity for new lead
        try {
          const { data: identityResult } = await supabaseClient.rpc('resolve_or_create_identity', {
            p_phone: lead.whatsapp || lead.fullPhone || null,
            p_email: email,
            p_nome: lead.nome || null,
            p_source_app: 'dndash',
            p_local_id: newLead.id,
            p_utm_source: lead.source || null,
            p_stage: 'lead',
          });
          if (identityResult?.dnia_id) {
            await supabaseClient
              .from('leads')
              .update({
                dnia_id: identityResult.dnia_id,
                phone_normalized: identityResult.phone_normalized,
              })
              .eq('id', newLead.id);
          }
        } catch (identityErr) {
          console.error(`Identity resolution error for new ${email}:`, identityErr);
        }
        continue;
      }

      // Preparar dados para update conforme o modo
      const updateData: Record<string, string | null> = {};
      
      // Função auxiliar para decidir se atualiza o campo
      const shouldUpdate = (fieldName: string, csvValue: string | null | undefined): boolean => {
        if (!csvValue) return false; // CSV não tem valor, não atualiza
        
        if (mergeMode === 'overwrite') return true; // Modo sobrescrever, sempre atualiza
        
        // Modo enrich: só atualiza se o campo atual estiver vazio
        const currentValue = existingLead[fieldName as keyof typeof existingLead];
        const isEmpty = currentValue === null || currentValue === undefined || currentValue === '';
        
        if (!isEmpty) {
          fieldsSkipped++;
          return false;
        }
        
        fieldsEnriched++;
        return true;
      };

      // Aplicar lógica de merge para cada campo
      if (shouldUpdate('nome', lead.nome)) updateData.nome = lead.nome!;
      if (shouldUpdate('whatsapp', lead.whatsapp || lead.fullPhone)) {
        updateData.whatsapp = lead.whatsapp || lead.fullPhone || null;
      }
      if (shouldUpdate('empresa', lead.empresa)) updateData.empresa = lead.empresa!;
      if (shouldUpdate('cargo', lead.cargo)) updateData.cargo = lead.cargo!;
      if (shouldUpdate('faturamento', lead.faturamento)) updateData.faturamento = lead.faturamento!;
      if (shouldUpdate('funcionarios', lead.funcionarios)) updateData.funcionarios = lead.funcionarios!;
      if (shouldUpdate('desafios', lead.desafios_ia)) updateData.desafios = lead.desafios_ia!;
      if (shouldUpdate('source', lead.source)) updateData.source = lead.source!;
      if (shouldUpdate('status', csvStatus)) updateData.status = csvStatus!;

      // Só faz update se houver campos para atualizar
      if (Object.keys(updateData).length === 0) {
        console.log(`Lead ${email}: nenhum campo para atualizar`);
        unchanged++;
        // Ainda assim, incluímos o lead na lista de processados para que
        // a tag seja aplicada mesmo quando não houve enriquecimento.
        processedLeadIds.push(existingLead.id);
        continue;
      }

      // Fazer update
      const { error: updateError } = await supabaseClient
        .from("leads")
        .update(updateData)
        .eq("email", email);

      if (updateError) {
        console.error(`Erro ao atualizar ${email}:`, updateError.message);
        errors.push(`${email}: ${updateError.message}`);
      } else {
        console.log(`Lead atualizado: ${email} (${Object.keys(updateData).length} campos)`);
        updated++;
        processedLeadIds.push(existingLead.id);

        // Resolve identity for updated lead
        try {
          await supabaseClient.rpc('resolve_or_create_identity', {
            p_phone: lead.whatsapp || lead.fullPhone || null,
            p_email: email,
            p_nome: lead.nome || null,
            p_source_app: 'dndash',
            p_local_id: existingLead.id,
            p_utm_source: lead.source || null,
            p_stage: 'lead',
          }).then(async ({ data: identityResult }) => {
            if (identityResult?.dnia_id) {
              await supabaseClient
                .from('leads')
                .update({
                  dnia_id: identityResult.dnia_id,
                  phone_normalized: identityResult.phone_normalized,
                })
                .eq('id', existingLead.id);
            }
          });
        } catch (identityErr) {
          console.error(`Identity resolution error for ${email}:`, identityErr);
        }
      }
    }

    console.log(`Processamento concluído: ${updated} atualizados, ${created} criados, ${notFound} não criados, ${fieldsEnriched} campos enriquecidos, ${fieldsSkipped} campos ignorados`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        updated,
        created,
        notFound,
        unchanged,
        skippedNoEmail,
        fieldsEnriched,
        fieldsSkipped,
        mergeMode,
        notFoundEmails: notFoundEmails.slice(0, 10),
        processedLeadIds,
        errors 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error('Erro no processamento:', errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
