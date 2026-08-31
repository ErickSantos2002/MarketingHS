import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AB_PROD_DOMAIN_DEFAULT, normalizeProductionDomain } from "@/lib/abConfig";

// `ab_config` (como as demais tabelas ab_*) não está no types.ts auto-gerado —
// acesso via cliente destipado, mesma convenção de useAbTests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// Configuração compartilhada do módulo A/B (single-row). Hoje guarda apenas o
// "domínio de produção" usado para validar as URLs de variante no cadastro.
export function useAbConfig() {
  const [id, setId] = useState<string | null>(null);
  const [productionDomain, setProductionDomain] = useState<string>(AB_PROD_DOMAIN_DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await db.from("ab_config").select("*").limit(1).single();
    if (!error && data) {
      setId(data.id);
      setProductionDomain(data.production_domain || AB_PROD_DOMAIN_DEFAULT);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (domain: string) => {
    const clean = normalizeProductionDomain(domain);
    if (!clean) {
      toast.error("Informe um domínio válido (ex.: dnia.ai).");
      return;
    }
    setSaving(true);
    let error: unknown = null;
    if (id) {
      ({ error } = await db
        .from("ab_config")
        .update({ production_domain: clean, updated_at: new Date().toISOString() })
        .eq("id", id));
    } else {
      // Sem linha ainda (seed ausente) — cria a linha única.
      const res = await db.from("ab_config").insert({ production_domain: clean }).select().single();
      error = res.error;
      if (!error && res.data) setId(res.data.id);
    }
    if (error) {
      toast.error("Erro ao salvar o domínio de produção.");
    } else {
      toast.success("Domínio de produção salvo.");
      setProductionDomain(clean);
    }
    setSaving(false);
  };

  return { productionDomain, loading, saving, save, refetch: load };
}
