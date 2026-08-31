import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Injeta dinamicamente o snippet do Microsoft Clarity no <head>
 * conforme a configuração da página em `pages.config.clarity`:
 *
 * {
 *   "clarity": { "enabled": true, "project_id": "wq39c9c11g" }
 * }
 *
 * - Lê via RPC pública `get_page_clarity(slug)` (somente o sub-objeto clarity)
 * - Só ativa se enabled === true e project_id casar /^[a-z0-9]{6,20}$/i
 * - Não roda em modo ?preview=true (para não poluir o admin)
 * - Cleanup remove o script ao desmontar
 */
export function useClarity(slug: string) {
  useEffect(() => {
    if (!slug) return;

    // Não injetar no preview do admin
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('preview') === 'true') return;
    }

    const attr = `data-clarity-slug`;
    let active = true;

    (async () => {
      try {
        const { data, error } = await supabase.rpc('get_page_clarity' as any, {
          _slug: slug,
        });
        if (!active || error || !data) return;

        const cfg = data as { enabled?: boolean; project_id?: string };
        const enabled = !!cfg.enabled;
        const id = (cfg.project_id || '').trim();
        if (!enabled || !/^[a-z0-9]{6,20}$/i.test(id)) return;

        // Evitar duplicação
        const existing = document.querySelector(
          `script[${attr}="${slug}"]`,
        ) as HTMLScriptElement | null;
        if (existing) {
          if (existing.dataset.clarityId === id) return;
          existing.remove();
          // Remove o script externo carregado pelo loader, se houver
          const loaded = document.querySelector(
            `script[src="https://www.clarity.ms/tag/${existing.dataset.clarityId}"]`,
          );
          if (loaded) loaded.remove();
        }

        const script = document.createElement('script');
        script.type = 'text/javascript';
        script.setAttribute(attr, slug);
        script.dataset.clarityId = id;
        script.text = `(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window, document, "clarity", "script", "${id}");`;
        document.head.appendChild(script);
      } catch {
        /* silencioso */
      }
    })();

    return () => {
      active = false;
      const el = document.querySelector(`script[${attr}="${slug}"]`) as HTMLScriptElement | null;
      if (el) {
        const id = el.dataset.clarityId;
        el.remove();
        if (id) {
          const loaded = document.querySelector(`script[src="https://www.clarity.ms/tag/${id}"]`);
          if (loaded) loaded.remove();
        }
      }
    };
  }, [slug]);
}
