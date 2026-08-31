-- Defeito introduzido no lote 1A, encontrado no 1D.
--
-- `resolve_or_create_identity` preenche `dndash_lead_id` apenas quando
-- `p_source_app = 'dndash'` — o nome do painel da dn.ia. A importação do lote
-- 1A passou 'marketinghs', então a identidade era criada mas NUNCA apontava de
-- volta para o contato.
--
-- Nada quebrou visivelmente: o caminho contato -> identidade funciona (leads
-- tem dnia_id), e é ele que a tela de Contatos usa. O que estava quebrado é o
-- inverso, identidade -> contato, que é justamente o que a API pública
-- percorre. A visão 360° externa sairia vazia.
--
-- A lição: renomear sem conferir quem consome o nome. 'marketinghs' era certo
-- como identificador do sistema; errado como valor que uma função herdada
-- compara com igualdade.
--
-- ⚠️ O corpo abaixo foi extraído do banco com pg_get_functiondef e alterado por
-- SUBSTITUIÇÃO MECÂNICA de `p_source_app = 'dndash'` por
-- `p_source_app IN ('dndash','marketinghs')`. Nada mais foi tocado. Reescrever
-- de memória uma função de 5.400 caracteres é como se perde dado — quase
-- aconteceu com fn_lead_insert_event na migration 005.

CREATE OR REPLACE FUNCTION public.resolve_or_create_identity(p_phone text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_nome text DEFAULT NULL::text, p_source_app text DEFAULT NULL::text, p_local_id uuid DEFAULT NULL::uuid, p_utm_source text DEFAULT NULL::text, p_stage text DEFAULT 'lead'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_phone_norm TEXT;
  v_identity RECORD;
  v_cross_identity RECORD;
  v_is_new BOOLEAN := FALSE;
  v_id UUID;
  v_stage_order TEXT[] := ARRAY['lead','prospect','opportunity','client','active','churned'];
  v_current_idx INT;
  v_new_idx INT;
  v_final_stage TEXT;
  v_matched_by TEXT := NULL;
  v_merged BOOLEAN := FALSE;
  v_merged_from UUID := NULL;
  v_keep_id UUID;
  v_discard_id UUID;
  v_merge_result JSONB;
BEGIN
  v_phone_norm := normalize_phone_br(p_phone);

  -- Step 1: Match by phone
  IF v_phone_norm IS NOT NULL AND v_phone_norm <> '' THEN
    SELECT * INTO v_identity FROM ecosystem_identities WHERE phone = v_phone_norm LIMIT 1;
    IF v_identity IS NOT NULL THEN
      v_matched_by := 'phone';
    END IF;
  END IF;

  -- Step 2: Match by email if no phone match
  IF v_identity IS NULL AND p_email IS NOT NULL AND TRIM(p_email) <> '' THEN
    SELECT * INTO v_identity FROM ecosystem_identities WHERE LOWER(TRIM(email)) = LOWER(TRIM(p_email)) LIMIT 1;
    IF v_identity IS NOT NULL THEN
      v_matched_by := 'email';
    END IF;
  END IF;

  -- Step 3: Cross-check for conflicts (potential duplicate)
  IF v_identity IS NOT NULL THEN
    IF v_matched_by = 'phone' AND p_email IS NOT NULL AND TRIM(p_email) <> '' THEN
      -- Matched by phone, check if email belongs to a DIFFERENT identity
      SELECT * INTO v_cross_identity FROM ecosystem_identities
        WHERE LOWER(TRIM(email)) = LOWER(TRIM(p_email))
        AND dnia_id <> v_identity.dnia_id
        LIMIT 1;
    ELSIF v_matched_by = 'email' AND v_phone_norm IS NOT NULL AND v_phone_norm <> '' THEN
      -- Matched by email, check if phone belongs to a DIFFERENT identity
      SELECT * INTO v_cross_identity FROM ecosystem_identities
        WHERE phone = v_phone_norm
        AND dnia_id <> v_identity.dnia_id
        LIMIT 1;
    END IF;

    -- If cross-match found, merge keeping the older record
    IF v_cross_identity IS NOT NULL THEN
      IF v_identity.created_at <= v_cross_identity.created_at THEN
        v_keep_id := v_identity.dnia_id;
        v_discard_id := v_cross_identity.dnia_id;
      ELSE
        v_keep_id := v_cross_identity.dnia_id;
        v_discard_id := v_identity.dnia_id;
      END IF;

      v_merge_result := merge_identities(v_keep_id, v_discard_id);
      v_merged := TRUE;
      v_merged_from := v_discard_id;

      -- Re-fetch the kept identity
      SELECT * INTO v_identity FROM ecosystem_identities WHERE dnia_id = v_keep_id;
    END IF;
  END IF;

  -- Step 4: Create new if no match
  IF v_identity IS NULL THEN
    v_is_new := TRUE;
    v_id := gen_random_uuid();
    v_final_stage := COALESCE(p_stage, 'lead');

    INSERT INTO ecosystem_identities (dnia_id, phone, email, nome, stage, first_touch_source, first_touch_app, last_seen_at,
      dndash_lead_id, nexus_contact_id, mentoria_client_id)
    VALUES (
      v_id, v_phone_norm, LOWER(TRIM(p_email)), p_nome, v_final_stage, p_utm_source, p_source_app, NOW(),
      CASE WHEN p_source_app IN ('dndash','marketinghs') THEN p_local_id ELSE NULL END,
      CASE WHEN p_source_app = 'nexus' THEN p_local_id ELSE NULL END,
      CASE WHEN p_source_app = 'mentoria' THEN p_local_id ELSE NULL END
    );

    RETURN jsonb_build_object(
      'dnia_id', v_id,
      'is_new', TRUE,
      'merged', FALSE,
      'merged_from', NULL,
      'stage', v_final_stage,
      'phone_normalized', v_phone_norm,
      'dndash_lead_id', CASE WHEN p_source_app IN ('dndash','marketinghs') THEN p_local_id ELSE NULL END,
      'nexus_contact_id', CASE WHEN p_source_app = 'nexus' THEN p_local_id ELSE NULL END,
      'mentoria_client_id', CASE WHEN p_source_app = 'mentoria' THEN p_local_id ELSE NULL END,
      'first_touch_app', p_source_app
    );
  END IF;

  -- Step 5: Update existing identity
  v_id := v_identity.dnia_id;

  v_current_idx := array_position(v_stage_order, v_identity.stage);
  v_new_idx := array_position(v_stage_order, COALESCE(p_stage, 'lead'));
  IF v_current_idx IS NULL THEN v_current_idx := 1; END IF;
  IF v_new_idx IS NULL THEN v_new_idx := 1; END IF;
  IF v_new_idx > v_current_idx THEN
    v_final_stage := p_stage;
  ELSE
    v_final_stage := v_identity.stage;
  END IF;

  UPDATE ecosystem_identities SET
    phone = COALESCE(v_phone_norm, phone),
    email = COALESCE(LOWER(TRIM(p_email)), email),
    nome = COALESCE(p_nome, nome),
    stage = v_final_stage,
    first_touch_source = COALESCE(first_touch_source, p_utm_source),
    first_touch_app = COALESCE(first_touch_app, p_source_app),
    last_seen_at = NOW(),
    dndash_lead_id = CASE WHEN p_source_app IN ('dndash','marketinghs') THEN COALESCE(p_local_id, dndash_lead_id) ELSE dndash_lead_id END,
    nexus_contact_id = CASE WHEN p_source_app = 'nexus' THEN COALESCE(p_local_id, nexus_contact_id) ELSE nexus_contact_id END,
    mentoria_client_id = CASE WHEN p_source_app = 'mentoria' THEN COALESCE(p_local_id, mentoria_client_id) ELSE mentoria_client_id END
  WHERE dnia_id = v_id;

  SELECT * INTO v_identity FROM ecosystem_identities WHERE dnia_id = v_id;

  RETURN jsonb_build_object(
    'dnia_id', v_id,
    'is_new', FALSE,
    'merged', v_merged,
    'merged_from', v_merged_from,
    'stage', v_identity.stage,
    'phone_normalized', v_identity.phone,
    'dndash_lead_id', v_identity.dndash_lead_id,
    'nexus_contact_id', v_identity.nexus_contact_id,
    'mentoria_client_id', v_identity.mentoria_client_id,
    'first_touch_app', v_identity.first_touch_app
  );
END;
$function$;

-- Preenche o vínculo das identidades que a importação do lote 1A criou sem ele.
UPDATE public.ecosystem_identities ei
   SET dndash_lead_id = l.id
  FROM public.leads l
 WHERE l.dnia_id = ei.dnia_id
   AND ei.dndash_lead_id IS NULL;
