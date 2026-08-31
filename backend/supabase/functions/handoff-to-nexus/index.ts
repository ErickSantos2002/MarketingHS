import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { identifyCaller, forbidden, PRIVILEGED } from '../_shared/callerAuth.ts';
import { getNexusCredentials } from '../_shared/nexusConfig.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};


function mapRevenue(v?: string | null): string | undefined {
  if (!v) return undefined;
  const s = v.toLowerCase();
  if (s.includes('100 mil') || s.includes('100k') || s.includes('até 100') || s.includes('ate 100')) return 'Ate 100k/mes';
  if ((s.includes('100') && s.includes('500')) || s.includes('100k e 500k')) return 'Entre 100k e 500k/mes';
  if ((s.includes('500') && (s.includes('1 milh') || s.includes('1mm'))) || s.includes('500k e 1mm')) return 'Entre 500k e 1MM/mes';
  if ((s.includes('1 milh') && s.includes('3 milh')) || s.includes('1mm e 3mm')) return 'Entre 1MM e 3MM/mes';
  if ((s.includes('3 milh') && s.includes('5 milh')) || s.includes('3mm e 5mm')) return 'Entre 3MM e 5MM/mes';
  if (s.includes('acima') && (s.includes('5 milh') || s.includes('5mm'))) return 'Acima de 5MM/mes';
  return undefined;
}

function mapEmployeeCount(v?: string | null): string | undefined {
  if (!v) return undefined;
  const s = v.toLowerCase().trim();
  if (s.includes('individual') || s.includes('eu s')) return 'Eu S.A.';
  if (s.includes('1-10') || /^2\s*-\s*10$/.test(s) || s.includes('1 a 10')) return '1-10 funcionarios';
  if (s.includes('11-50') || /11\s*-\s*(25|50)/.test(s) || /26\s*-\s*(49|50)/.test(s)) return '11-50 funcionarios';
  if (s.includes('51-200') || /51\s*-\s*200/.test(s) || s.includes('acima de 50')) return '51-200 funcionarios';
  if (s.includes('+200') || s.includes('acima de 200') || s.includes('mais de 200')) return '+200 funcionarios';
  return undefined;
}

function buildContactPayload(lead: any, source?: string | null) {
  const notes = [
    lead.utm_campaign ? `Campanha: ${lead.utm_campaign}` : null,
    lead.desafios ? `Desafios: ${lead.desafios.slice(0, 500)}` : null,
    lead.indicacao ? `Indicação: ${lead.indicacao}` : null,
  ].filter(Boolean).join('\n');

  // Regra global: Origem no Nexus = "Tráfego pago" se houver qualquer UTM, senão "Orgânico".
  // Valores devem bater exatamente com GET /crm/contact-sources do Nexus (case + acentos).
  // Aplica a todas as landing pages do app. O parâmetro `source` é ignorado de propósito
  // para garantir consistência entre origens.
  const hasUtm = Boolean(
    lead.utm_source || lead.utm_medium || lead.utm_campaign ||
    lead.utm_term || lead.utm_content
  );
  const payload: Record<string, unknown> = {
    name: lead.nome || lead.email || 'Sem nome',
    phone: lead.phone_normalized || lead.whatsapp || null,
    email: lead.email || null,
    source: hasUtm ? 'Tráfego pago' : 'Orgânico',
  };
  if (lead.empresa) payload.company = lead.empresa;
  if (lead.cargo) payload.job_title = lead.cargo;
  const emp = mapEmployeeCount(lead.funcionarios);
  if (emp) payload.employee_count = emp;
  const rev = mapRevenue(lead.faturamento);
  if (rev) payload.revenue = rev;
  if (notes) payload.notes = notes;
  return payload;
}

// Stages que as landing pages publicas podem alvejar (lead qualificado).
const PUBLIC_STAGE_IDS = ['f932c109-846f-48ce-9a1b-787537e89932'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Chamado pelas landing pages (chave publicavel) e pelo painel/integradores.
  const caller = await identifyCaller(req);
  if (caller.kind === 'none') return forbidden(corsHeaders, 401);
  const privileged = PRIVILEGED.includes(caller.kind);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const { apiKey: nexusApiKey, workspaceId: nexusWorkspaceId, baseUrl: NEXUS_BASE } = await getNexusCredentials();

    if (!nexusApiKey || !nexusWorkspaceId) {
      return new Response(
        JSON.stringify({ error: 'Nexus credentials not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }


    const supabase = createClient(supabaseUrl, serviceKey);
    const nexusHeaders = {
      'Content-Type': 'application/json',
      'X-API-Key': nexusApiKey,
      'X-Workspace-Id': nexusWorkspaceId,
    };

    const body = await req.json();
    const { lead_id, rule_id, manual, direct_stage, stage_id, stage_name, source, tags } = body;
    const tagList: string[] = Array.isArray(tags) ? tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim()) : [];

    // Chamadores nao privilegiados (landing pages anonimas) so podem enviar o lead
    // para o stage publico de lead qualificado; stages arbitrarios e o modo `manual`
    // (que roda as regras de automacao) exigem admin ou chamada server-to-server.
    if (!privileged) {
      if (manual || rule_id) return forbidden(corsHeaders, 403);
      if (!direct_stage) return forbidden(corsHeaders, 403);
      if (!PUBLIC_STAGE_IDS.includes(String(stage_id || ''))) return forbidden(corsHeaders, 403);
    }

    // Note: tags are applied directly via the body of POST /crm/leads,
    // PUT /crm/leads/:id and PUT /crm/leads/:id/stage (Nexus auto-creates
    // missing tags and merges with the contact's existing tags).

    // Direct stage mode: send lead to a specific Nexus stage, bypassing automation rules
    if (direct_stage) {
      if (!lead_id || !stage_id) {
        return new Response(
          JSON.stringify({ error: 'lead_id and stage_id are required for direct_stage mode' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: lead } = await supabase.from('leads').select('*').eq('id', lead_id).single();
      if (!lead) {
        return new Response(
          JSON.stringify({ error: 'Lead not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Helper: detect duplicate-contact errors (PT + EN + code based)
      const isDuplicateContactError = (data: any): boolean => {
        const code = data?.error?.code || data?.code || '';
        const msg = (data?.error?.message || data?.message || JSON.stringify(data) || '').toLowerCase();
        if (typeof code === 'string' && code.toUpperCase().includes('DB_ERROR')) {
          if (msg.includes('duplicado') || msg.includes('já existe') || msg.includes('ja existe')) return true;
        }
        return (
          msg.includes('duplicate') ||
          msg.includes('already exists') ||
          msg.includes('unique') ||
          msg.includes('duplicado') ||
          msg.includes('já existe') ||
          msg.includes('ja existe')
        );
      };

      const normalizeComparablePhone = (value: string | null | undefined): string | null => {
        if (!value) return null;
        const digits = String(value).replace(/\D/g, '');
        return digits || null;
      };

      const contactMatchesLead = (contact: any): boolean => {
        const leadEmail = (lead.email || '').trim().toLowerCase();
        const contactEmail = (contact?.email || '').trim().toLowerCase();
        if (leadEmail && contactEmail && leadEmail === contactEmail) return true;

        const leadPhone = normalizeComparablePhone(lead.phone_normalized || lead.whatsapp);
        const contactPhone = normalizeComparablePhone(contact?.phone);
        if (leadPhone && contactPhone && (leadPhone === contactPhone || leadPhone.endsWith(contactPhone) || contactPhone.endsWith(leadPhone))) {
          return true;
        }

        const leadName = (lead.nome || '').trim().toLowerCase();
        const contactName = (contact?.name || '').trim().toLowerCase();
        return Boolean(leadName && contactName && leadName === contactName);
      };

      const lookupNexusContact = async (): Promise<any | null> => {
        const searchTerms = Array.from(new Set([
          lead.email?.trim().toLowerCase(),
          normalizeComparablePhone(lead.phone_normalized || lead.whatsapp),
          lead.nome?.trim(),
        ].filter(Boolean) as string[]));

        for (const term of searchTerms) {
          try {
            const r = await fetch(`${NEXUS_BASE}/crm/contacts?search=${encodeURIComponent(term)}`, { headers: nexusHeaders });
            if (!r.ok) continue;

            const d = await r.json();
            const items = Array.isArray(d?.data) ? d.data : [];
            const exactMatch = items.find((item: any) => contactMatchesLead(item));
            if (exactMatch) return exactMatch;
          } catch (e) {
            console.error('lookupNexusContact error:', e);
          }
        }

        return null;
      };

      const lookupExistingCardForContact = async (contactId: string): Promise<any | null> => {
        const searchTerms = Array.from(new Set([
          lead.nome?.trim(),
          lead.email?.trim().toLowerCase(),
          normalizeComparablePhone(lead.phone_normalized || lead.whatsapp),
        ].filter(Boolean) as string[]));

        for (const term of searchTerms) {
          try {
            const r = await fetch(`${NEXUS_BASE}/crm/leads?search=${encodeURIComponent(term)}`, { headers: nexusHeaders });
            if (!r.ok) continue;

            const d = await r.json();
            const items = Array.isArray(d?.data) ? d.data : [];
            const exactMatch = items.find((item: any) => item?.contact_id === contactId);
            if (exactMatch) return exactMatch;
          } catch (e) {
            console.error('lookupExistingCardForContact error:', e);
          }
        }

        return null;
      };

      // Resolve / create Nexus contact
      let nexusContactId: string | null = null;
      let contactOrigin: 'identity' | 'lookup' | 'created' = 'identity';

      if (lead.dnia_id) {
        const { data: identity } = await supabase
          .from('ecosystem_identities')
          .select('nexus_contact_id')
          .eq('dnia_id', lead.dnia_id)
          .single();
        nexusContactId = identity?.nexus_contact_id || null;

        if (nexusContactId) {
          try {
            const contactByIdRes = await fetch(`${NEXUS_BASE}/crm/contacts/${nexusContactId}`, { headers: nexusHeaders });
            const contactByIdData = await contactByIdRes.json().catch(() => ({}));
            const savedContact = contactByIdData?.data || contactByIdData;

            if (!contactByIdRes.ok || !contactMatchesLead(savedContact)) {
              console.warn('[direct_stage] Stored nexus_contact_id does not match current lead, resolving correct contact', {
                lead_id: lead.id,
                nexus_contact_id: nexusContactId,
              });

              const resolvedContact = await lookupNexusContact();
              nexusContactId = resolvedContact?.id || null;
              if (lead.dnia_id && nexusContactId) {
                await supabase
                  .from('ecosystem_identities')
                  .update({ nexus_contact_id: nexusContactId })
                  .eq('dnia_id', lead.dnia_id);
              }
              contactOrigin = 'lookup';
            }
          } catch (e) {
            console.error('[direct_stage] Failed to validate stored nexus_contact_id:', e);
            const resolvedContact = await lookupNexusContact();
            nexusContactId = resolvedContact?.id || null;
            contactOrigin = nexusContactId ? 'lookup' : 'identity';
          }
        }
      }

      if (!nexusContactId) {
        const contactRes = await fetch(`${NEXUS_BASE}/crm/contacts`, {
          method: 'POST',
          headers: nexusHeaders,
          body: JSON.stringify(buildContactPayload(lead, source)),
        });

        const contactData = await contactRes.json().catch(() => ({}));
        if (!contactRes.ok) {
          if (isDuplicateContactError(contactData)) {
            console.log('[direct_stage] Contact already exists in Nexus, looking up...');
            nexusContactId = (await lookupNexusContact())?.id || null;
            contactOrigin = 'lookup';
            if (!nexusContactId) {
              console.error('[direct_stage] Could not resolve existing Nexus contact:', contactData);
              return new Response(
                JSON.stringify({ error: 'Contact exists but lookup failed', details: contactData }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            }
          } else {
            console.error('[direct_stage] Failed to create Nexus contact:', contactData);
            return new Response(
              JSON.stringify({ error: 'Failed to create contact in Nexus', details: contactData }),
              { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        } else {
          nexusContactId = contactData.data?.id || null;
          contactOrigin = 'created';
        }

        if (lead.dnia_id && nexusContactId) {
          await supabase
            .from('ecosystem_identities')
            .update({ nexus_contact_id: nexusContactId })
            .eq('dnia_id', lead.dnia_id);
        }
      }

      if (!nexusContactId) {
        console.error('[direct_stage] No nexus_contact_id resolved');
        return new Response(
          JSON.stringify({ error: 'Could not resolve Nexus contact' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Tags will be applied via the body of the create/move/update lead call below.

      // Look for an existing card/opportunity for this contact
      let cardAction: 'moved' | 'created' | 'noop' = 'noop';
      let existingCardId: string | null = null;
      let shouldMoveExistingCard = false;

      try {
        const listRes = await fetch(
          `${NEXUS_BASE}/crm/leads?contact_id=${nexusContactId}`,
          { headers: nexusHeaders }
        );
        if (listRes.ok) {
          const listData = await listRes.json();
          const rawItems = Array.isArray(listData?.data) ? listData.data : [];
          const items = rawItems.filter((c: any) => c?.contact_id === nexusContactId);
          const notInStage = items.find((c: any) => c?.stage_id !== stage_id);
          existingCardId = (notInStage?.id || items[0]?.id) || null;
          shouldMoveExistingCard = Boolean(notInStage?.id);

          if (!items.length) {
            const searchedCard = await lookupExistingCardForContact(nexusContactId);
            if (searchedCard) {
              existingCardId = searchedCard.id;
              shouldMoveExistingCard = searchedCard.stage_id !== stage_id;
              if (!shouldMoveExistingCard) {
                cardAction = 'noop';
                console.log('[direct_stage] Card found by search and already at target stage');
              } else {
                console.log(`[direct_stage] Card found by search (${existingCardId}), moving now`);
              }
            } else {
              console.log('[direct_stage] No existing cards found for contact, creating a new one');
            }
          } else if (!shouldMoveExistingCard) {
            console.log('[direct_stage] Card already at target stage, no move needed');
            cardAction = 'noop';
          } else {
            console.log(`[direct_stage] Existing card ${existingCardId} is outside target stage, moving now`);
          }
        } else {
          const errTxt = await listRes.text().catch(() => '');
          console.error('[direct_stage] Could not list contact opportunities:', listRes.status, errTxt);
          return new Response(
            JSON.stringify({ error: 'Failed to list Nexus opportunities', status: listRes.status, details: errTxt }),
            { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      } catch (e) {
        console.error('[direct_stage] List opportunities error:', e);
        return new Response(
          JSON.stringify({ error: 'List opportunities exception', details: String(e) }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Helper: apply tags to a Nexus card via PUT /stage (append/merge).
      // PUT /crm/leads/{id} currently 404s on Nexus, so /stage is the reliable path
      // for tag application. The Nexus /stage endpoint silently ignores `tags` when
      // it's also performing a stage change in the same request, so we always do a
      // dedicated follow-up call to guarantee tags are applied.
      const applyTagsToCard = async (cardId: string, stageId: string, tags: string[]) => {
        if (!tags.length) return;
        try {
          const tagRes = await fetch(`${NEXUS_BASE}/crm/leads/${cardId}/stage`, {
            method: 'PUT',
            headers: nexusHeaders,
            body: JSON.stringify({ stage_id: stageId, tags }),
          });
          if (tagRes.ok) {
            const tagData = await tagRes.json().catch(() => ({}));
            console.log(`[direct_stage] Applied tags ${JSON.stringify(tags)} to card ${cardId} via /stage`, tagData?.meta || '');
          } else {
            const errTxt = await tagRes.text().catch(() => '');
            console.warn('[direct_stage] Failed to apply tags via /stage:', tagRes.status, errTxt);
          }
        } catch (e) {
          console.warn('[direct_stage] applyTagsToCard exception:', e);
        }
      };

      if (existingCardId && shouldMoveExistingCard) {
        // Move existing card to target stage
        const moveRes = await fetch(`${NEXUS_BASE}/crm/leads/${existingCardId}/stage`, {
          method: 'PUT',
          headers: nexusHeaders,
          body: JSON.stringify({
            stage_id,
            ...(tagList.length ? { tags: tagList } : {}),
          }),
        });
        if (moveRes.ok) {
          cardAction = 'moved';
          console.log(`[direct_stage] Moved card ${existingCardId} to stage ${stage_id}${tagList.length ? ` with tags ${JSON.stringify(tagList)}` : ''}`);
          // Follow-up: Nexus drops tags when moving stage in the same call, so reapply.
          await applyTagsToCard(existingCardId, stage_id, tagList);
        } else {
          const errTxt = await moveRes.text().catch(() => '');
          console.error('[direct_stage] Failed to move card stage:', moveRes.status, errTxt);
          return new Response(
            JSON.stringify({
              error: 'Failed to move Nexus card stage',
              status: moveRes.status,
              card_id: existingCardId,
              stage_id,
              details: errTxt,
            }),
            { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      } else if (!existingCardId) {
        // Create a new opportunity at the target stage
        const oppRes = await fetch(`${NEXUS_BASE}/crm/leads`, {
          method: 'POST',
          headers: nexusHeaders,
          body: JSON.stringify({
            contact_id: nexusContactId,
            stage_id,
            title: `${lead.nome || 'Lead'} — ${stage_name || 'Diagnóstico'}`,
            value: 30000,
            ...(tagList.length ? { tags: tagList } : {}),
          }),
        });
        if (oppRes.ok) {
          cardAction = 'created';
          const oppData = await oppRes.json().catch(() => ({} as any));
          const newCardId =
            oppData?.id ||
            oppData?.lead?.id ||
            oppData?.data?.id ||
            oppData?.data?.lead?.id ||
            null;
          console.log(`[direct_stage] Created new card${newCardId ? ` (${newCardId})` : ''} at stage ${stage_id}${tagList.length ? ` with tags ${JSON.stringify(tagList)}` : ''}`);
          // Follow-up for parity with move path; harmless if tags were already applied on create.
          if (newCardId) {
            await applyTagsToCard(newCardId, stage_id, tagList);
          } else if (tagList.length) {
            console.warn('[direct_stage] Created card but could not extract id from response; skipping tag follow-up');
          }
        } else {
          const errData = await oppRes.json().catch(() => ({}));
          console.error('[direct_stage] Failed to create Nexus opportunity:', oppRes.status, errData);
          return new Response(
            JSON.stringify({
              error: 'Failed to create Nexus opportunity',
              status: oppRes.status,
              details: errData,
            }),
            { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      } else if (existingCardId && !shouldMoveExistingCard && tagList.length) {
        // Card already at target stage — apply tags via dedicated follow-up call.
        await applyTagsToCard(existingCardId, stage_id, tagList);
      }

      await supabase.from('contact_events').insert({
        lead_id: lead.id,
        dnia_id: lead.dnia_id,
        source_app: 'dnmarketing',
        event_type: 'direct_nexus_send',
        title: `Enviado para Nexus${stage_name ? ` (${stage_name})` : ''}`,
        description: source ? `Origem: ${source}` : null,
        metadata: {
          nexus_contact_id: nexusContactId,
          stage_id,
          stage_name: stage_name || null,
          source: source || null,
          direct_stage: true,
          contact_origin: contactOrigin,
          card_action: cardAction,
          existing_card_id: existingCardId,
        },
      });

      return new Response(
        JSON.stringify({
          success: true,
          nexus_contact_id: nexusContactId,
          direct_stage: true,
          stage_id,
          contact_origin: contactOrigin,
          card_action: cardAction,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Manual mode: only requires lead_id
    if (manual) {
      if (!lead_id) {
        return new Response(
          JSON.stringify({ error: 'lead_id is required for manual mode' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: lead } = await supabase.from('leads').select('*').eq('id', lead_id).single();
      if (!lead) {
        return new Response(
          JSON.stringify({ error: 'Lead not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check if already in Nexus
      let nexusContactId: string | null = null;
      if (lead.dnia_id) {
        const { data: identity } = await supabase
          .from('ecosystem_identities')
          .select('nexus_contact_id')
          .eq('dnia_id', lead.dnia_id)
          .single();
        nexusContactId = identity?.nexus_contact_id || null;
      }

      // Create contact if not exists
      if (!nexusContactId) {
        const contactRes = await fetch(`${NEXUS_BASE}/crm/contacts`, {
          method: 'POST',
          headers: nexusHeaders,
          body: JSON.stringify(buildContactPayload(lead)),
        });

        const contactData = await contactRes.json();
        if (!contactRes.ok) {
          console.error('Failed to create Nexus contact:', contactData);
          return new Response(
            JSON.stringify({ error: 'Failed to create contact in Nexus', details: contactData }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        nexusContactId = contactData.data?.id;

        if (lead.dnia_id && nexusContactId) {
          await supabase
            .from('ecosystem_identities')
            .update({ nexus_contact_id: nexusContactId })
            .eq('dnia_id', lead.dnia_id);
        }
      }

      // Try to find a create_in_nexus rule with a stage, or fetch first available stage
      let stageId: string | null = null;
      let stageName = '';

      const { data: activeRule } = await supabase
        .from('automation_rules')
        .select('action_value, action_metadata')
        .eq('action_type', 'create_in_nexus')
        .eq('is_active', true)
        .order('priority', { ascending: false })
        .limit(1)
        .single();

      if (activeRule?.action_value) {
        stageId = activeRule.action_value;
        stageName = (activeRule.action_metadata as any)?.stage_name || '';
      } else {
        // Fetch pipeline stages from Nexus and prefer "Lead Qualificado"
        try {
          const stagesRes = await fetch(`${NEXUS_BASE}/crm/pipeline/stages`, { headers: nexusHeaders });
          if (stagesRes.ok) {
            const stagesData = await stagesRes.json();
            const list = Array.isArray(stagesData?.data) ? stagesData.data : [];
            const qualified = list.find((s: any) => (s?.name || '').toLowerCase() === 'lead qualificado');
            const chosen = qualified || list[0];
            if (chosen) {
              stageId = chosen.id;
              stageName = chosen.name || '';
            }
          } else {
            const errTxt = await stagesRes.text().catch(() => '');
            console.error('[manual] Failed to fetch pipeline stages:', stagesRes.status, errTxt);
          }
        } catch (e) {
          console.error('Failed to fetch pipeline stages:', e);
        }
      }

      // Create opportunity if we have a stage
      if (stageId && nexusContactId) {
        const oppRes = await fetch(`${NEXUS_BASE}/crm/leads`, {
          method: 'POST',
          headers: nexusHeaders,
          body: JSON.stringify({
            contact_id: nexusContactId,
            stage_id: stageId,
            title: `${lead.nome || 'Lead'} — Programa de IAficação`,
            value: 30000,
          }),
        });

        if (!oppRes.ok) {
          const errData = await oppRes.json().catch(() => ({}));
          const errMsg = errData?.error?.message || '';
          if (errMsg.includes('duplicate key') || errMsg.includes('unique constraint')) {
            console.log('Nexus opportunity already exists for this contact, skipping creation.');
          } else {
            console.error('Failed to create Nexus opportunity:', errData);
          }
        }
      }

      // Register timeline event
      await supabase.from('contact_events').insert({
        lead_id: lead.id,
        dnia_id: lead.dnia_id,
        source_app: 'dnmarketing',
        event_type: 'manual_nexus_send',
        title: 'Enviado manualmente para o Nexus',
        description: `Contato criado no Nexus${stageName ? ` no estágio "${stageName}"` : ''}`,
        metadata: {
          nexus_contact_id: nexusContactId,
          stage_name: stageName,
          manual: true,
        },
      });

      return new Response(
        JSON.stringify({
          success: true,
          nexus_contact_id: nexusContactId,
          manual: true,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Standard rule-based flow
    if (!lead_id || !rule_id) {
      return new Response(
        JSON.stringify({ error: 'lead_id and rule_id are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch lead and rule in parallel
    const [{ data: lead }, { data: rule }] = await Promise.all([
      supabase.from('leads').select('*').eq('id', lead_id).single(),
      supabase.from('automation_rules').select('*').eq('id', rule_id).single(),
    ]);

    if (!lead || !rule) {
      return new Response(
        JSON.stringify({ error: 'Lead or rule not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Block action
    if (rule.action_type === 'block_nexus') {
      return new Response(
        JSON.stringify({ success: true, blocked: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if contact already exists in Nexus
    let nexusContactId: string | null = null;
    if (lead.dnia_id) {
      const { data: identity } = await supabase
        .from('ecosystem_identities')
        .select('nexus_contact_id')
        .eq('dnia_id', lead.dnia_id)
        .single();
      nexusContactId = identity?.nexus_contact_id || null;
    }

    // Create contact if not exists
    if (!nexusContactId) {
      const contactRes = await fetch(`${NEXUS_BASE}/crm/contacts`, {
        method: 'POST',
        headers: nexusHeaders,
        body: JSON.stringify(buildContactPayload(lead)),
      });

      const contactData = await contactRes.json();

      if (!contactRes.ok) {
        console.error('Failed to create Nexus contact:', contactData);
        return new Response(
          JSON.stringify({ error: 'Failed to create contact in Nexus', details: contactData }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      nexusContactId = contactData.data?.id;

      // Save nexus_contact_id in ecosystem_identities
      if (lead.dnia_id && nexusContactId) {
        await supabase
          .from('ecosystem_identities')
          .update({ nexus_contact_id: nexusContactId })
          .eq('dnia_id', lead.dnia_id);
      }
    }

    // Create opportunity
    if (rule.action_type === 'create_in_nexus' && rule.action_value) {
      const oppRes = await fetch(`${NEXUS_BASE}/crm/leads`, {
        method: 'POST',
        headers: nexusHeaders,
        body: JSON.stringify({
          contact_id: nexusContactId,
          stage_id: rule.action_value,
          title: `${lead.nome || 'Lead'} — Programa de IAficação`,
          value: 30000,
        }),
      });

      if (!oppRes.ok) {
        const errData = await oppRes.json().catch(() => ({}));
        const errMsg = errData?.error?.message || '';
        if (errMsg.includes('duplicate key') || errMsg.includes('unique constraint')) {
          console.log('Nexus opportunity already exists for this contact, skipping creation.');
        } else {
          console.error('Failed to create Nexus opportunity:', errData);
        }
      }
    }

    // Move stage
    if (rule.action_type === 'move_stage_nexus' && rule.action_value && nexusContactId) {
      const leadsRes = await fetch(
        `${NEXUS_BASE}/crm/leads?contact_id=${nexusContactId}`,
        { headers: nexusHeaders }
      );

      if (leadsRes.ok) {
        const leadsData = await leadsRes.json();
        const nexusLead = leadsData.data?.[0];

        if (nexusLead) {
          await fetch(`${NEXUS_BASE}/crm/leads/${nexusLead.id}/stage`, {
            method: 'PUT',
            headers: nexusHeaders,
            body: JSON.stringify({ stage_id: rule.action_value }),
          });
        }
      }
    }

    // Register timeline event
    const actionMeta = rule.action_metadata as Record<string, any> || {};
    await supabase.from('contact_events').insert({
      lead_id: lead.id,
      dnia_id: lead.dnia_id,
      source_app: 'dnmarketing',
      event_type: 'automation_executed',
      title: `Automação executada: ${rule.name}`,
      description: `Ação: ${rule.action_type} → ${actionMeta.stage_name || ''}`,
      metadata: {
        rule_id: rule.id,
        rule_name: rule.name,
        nexus_contact_id: nexusContactId,
        stage_name: actionMeta.stage_name,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        nexus_contact_id: nexusContactId,
        rule_applied: rule.name,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('handoff-to-nexus error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
