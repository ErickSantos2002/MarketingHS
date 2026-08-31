// ============================================================================
// Helpers do módulo A/B compartilhados pelas Edge Functions que recebem sinais
// do Nexus (identity-upsert, receive-contact-event). Convergem a atribuição
// server-side no módulo A/B — é isto que garante a evolução para o v2.
//
//  - extractAbParams: lê ab_vid/ab_test/ab_var do body ou de metadata.
//  - attachVisitorToContact: costura ab_vid <-> contato em ab_identities
//    (histórico completo, never overwrite). Fallback por email/whatsapp quando
//    a chamada chega SEM ab_vid.
//  - recordConversion: registra conversão nomeada em ab_events (idempotente por
//    dedupe_key). Não-bloqueante: erros são logados, nunca propagados.
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface AbParams {
  ab_vid: string | null;
  ab_test: string | null;
  ab_var: string | null;
}

export function extractAbParams(body: any): AbParams {
  const md = body?.metadata && typeof body.metadata === 'object' ? body.metadata : {};
  const pick = (k: string) => {
    const v = body?.[k] ?? md?.[k];
    return v != null && String(v).trim() !== '' ? String(v).trim() : null;
  };
  return { ab_vid: pick('ab_vid'), ab_test: pick('ab_test'), ab_var: pick('ab_var') };
}

export async function attachVisitorToContact(
  sb: any,
  opts: {
    ab: AbParams;
    email?: string | null;
    phone?: string | null;
    phone_normalized?: string | null;
    lead_id?: string | null;
    dnia_id?: string | null;
    source_app: string;
    metadata?: Record<string, unknown> | null;
  },
): Promise<AbParams> {
  let { ab_vid, ab_test, ab_var } = opts.ab;
  const email = opts.email ? String(opts.email).trim().toLowerCase() : null;
  const phone = opts.phone_normalized || opts.phone || null;

  try {
    // Fallback: sem ab_vid, procura uma costura anterior por email/telefone.
    if (!ab_vid && (email || phone)) {
      if (email) {
        const { data } = await sb
          .from('ab_identities')
          .select('ab_vid')
          .ilike('email', email)
          .order('linked_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (data?.ab_vid) ab_vid = data.ab_vid;
      }
      if (!ab_vid && phone) {
        const { data } = await sb
          .from('ab_identities')
          .select('ab_vid')
          .eq('phone_normalized', phone)
          .order('linked_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (data?.ab_vid) ab_vid = data.ab_vid;
      }
    }

    if (!ab_vid) return { ab_vid: null, ab_test, ab_var };

    // Descobre test/var pelo último assignment desse ab_vid, se faltarem.
    if (!ab_test || !ab_var) {
      const { data: asg } = await sb
        .from('ab_assignments')
        .select('ab_test, ab_var')
        .eq('ab_vid', ab_vid)
        .order('assigned_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (asg) {
        ab_test = ab_test || asg.ab_test;
        ab_var = ab_var || asg.ab_var;
      }
    }

    // Costura só se ainda não existe uma linha equivalente (evita bloat por
    // reenvios), preservando o histórico entre ab_vids diferentes.
    let exists = null;
    if (opts.lead_id) {
      const { data } = await sb
        .from('ab_identities')
        .select('id')
        .eq('ab_vid', ab_vid)
        .eq('lead_id', opts.lead_id)
        .limit(1)
        .maybeSingle();
      exists = data;
    } else if (email) {
      const { data } = await sb
        .from('ab_identities')
        .select('id')
        .eq('ab_vid', ab_vid)
        .ilike('email', email)
        .limit(1)
        .maybeSingle();
      exists = data;
    }

    if (!exists) {
      await sb.from('ab_identities').insert({
        ab_vid,
        email: email,
        phone: opts.phone || null,
        phone_normalized: opts.phone_normalized || null,
        lead_id: opts.lead_id || null,
        dnia_id: opts.dnia_id || null,
        source_app: opts.source_app,
        metadata: opts.metadata || null,
      });
    }
  } catch (err) {
    console.error('[ab attachVisitorToContact] non-blocking:', (err as Error).message);
  }

  return { ab_vid, ab_test, ab_var };
}

export async function recordConversion(
  sb: any,
  opts: {
    ab: AbParams;
    name: string;
    lead_id?: string | null;
    dnia_id?: string | null;
    page_slug?: string | null;
    metadata?: Record<string, unknown> | null;
  },
): Promise<void> {
  const { ab_vid, ab_test, ab_var } = opts.ab;
  if (!ab_vid || !ab_test) return;
  try {
    const { error } = await sb.from('ab_events').insert({
      ab_test,
      ab_var,
      ab_vid,
      event_type: 'conversion',
      event_name: opts.name,
      lead_id: opts.lead_id || null,
      dnia_id: opts.dnia_id || null,
      page_slug: opts.page_slug || null,
      metadata: opts.metadata || null,
      dedupe_key: `${ab_vid}:${ab_test}:conversion:${opts.name}`,
    });
    if (error && error.code !== '23505') {
      console.error('[ab recordConversion]', error.message);
    }
  } catch (err) {
    console.error('[ab recordConversion] non-blocking:', (err as Error).message);
  }
}
