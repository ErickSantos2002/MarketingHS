import { useState, useEffect, useCallback } from 'react';
import { lerRedesSociais, gravarRedesSociais } from '@/lib/config';
import {
  DEFAULT_SOCIAL_LINKS,
  parseSocialLinks,
  type SocialLinksConfig,
} from '@/lib/socialLinks';

// Config de redes sociais da marca. Vive em `dashboard_settings`, o KV genérico
// do admin, e é GLOBAL — não há uma por usuário. Não há segredo aqui (links
// públicos), mas a escrita é de admin: é config de marca, não preferência de
// tela.

export function useSocialLinks() {
  const [config, setConfig] = useState<SocialLinksConfig>(DEFAULT_SOCIAL_LINKS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    lerRedesSociais()
      .then((valor) => {
        if (cancelled) return;
        if (valor) setConfig(parseSocialLinks(valor));
      })
      // Sem config gravada, ou API fora do ar: o padrão da marca serve. O
      // rodapé do e-mail não pode ficar sem ícone por causa disso.
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const save = useCallback(async (next: SocialLinksConfig): Promise<boolean> => {
    try {
      await gravarRedesSociais(next);
      setConfig(next);
      return true;
    } catch {
      return false;
    }
  }, []);

  return { config, loading, save };
}
