import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  DEFAULT_SOCIAL_LINKS,
  SOCIAL_SETTING_KEY,
  parseSocialLinks,
  type SocialLinksConfig,
} from '@/lib/socialLinks';

// Config de redes sociais da marca, guardada em `dashboard_settings` -- o KV
// generico do admin (RLS: has_role(auth.uid(), 'admin')), a mesma tabela usada
// pelas metas do dashboard e pelas colunas de contatos. Nao ha segredo aqui
// (links publicos), entao nao precisa de Edge Function: o client escreve
// direto, como os outros consumidores dessa tabela ja fazem.

export function useSocialLinks() {
  const [config, setConfig] = useState<SocialLinksConfig>(DEFAULT_SOCIAL_LINKS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('dashboard_settings')
        .select('setting_value')
        .eq('setting_key', SOCIAL_SETTING_KEY)
        .maybeSingle();

      if (cancelled) return;
      if (data?.setting_value) setConfig(parseSocialLinks(data.setting_value));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const save = useCallback(async (next: SocialLinksConfig): Promise<boolean> => {
    const { error } = await supabase
      .from('dashboard_settings')
      .upsert(
        {
          setting_key: SOCIAL_SETTING_KEY,
          setting_value: next as any,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'setting_key' },
      );

    if (error) return false;
    setConfig(next);
    return true;
  }, []);

  return { config, loading, save };
}
