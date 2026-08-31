import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdmin } from "../_shared/callerAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CriteriaConfig {
  cargo_decisor: { enabled: boolean; points: number; cargos?: string[] };
  faturamento: { enabled: boolean; points: number; min_value?: number };
  funcionarios: { enabled: boolean; points: number; min_value?: number };
  tem_desafios: { enabled: boolean; points: number };
  origem: { enabled: boolean; points: number; sources?: string[] };
  reconversao: { enabled: boolean; points: number };
  tem_whatsapp: { enabled: boolean; points: number };
}

interface Thresholds {
  hotlead: number;
  warm: number;
}

const FAT_MAP: Record<string, number> = {
  'até 10k': 10000, '10k-50k': 10000, '50k-100k': 50000,
  '100k-500k': 100000, '500k-1m': 500000, 'acima de 1m': 1000000,
  'entre 100k e 500k': 100000, 'entre 500k e 1mm': 500000,
  'entre 1mm e 3mm': 1000000, 'entre 3mm e 5mm': 3000000,
  'acima de 5mm': 5000000, 'acima de 1mm': 1000000,
  'acima de 3mm': 3000000,
  'de r$ 1 milhão a r$ 5 milhões': 1000000,
  'de r$ 5 milhões a r$ 10 milhões': 5000000,
  'acima de r$ 10 milhões': 10000000,
  'acima de r$ 50 milhões': 50000000,
  'mais de 1 milhão': 1000000,
  'mais de 5 milhões': 5000000,
};

function parseFat(fat: string | null): number {
  if (!fat) return 0;
  const lower = fat.toLowerCase().trim();
  if (FAT_MAP[lower] !== undefined) return FAT_MAP[lower];
  for (const [key, val] of Object.entries(FAT_MAP)) {
    if (lower.includes(key)) return val;
  }
  return 0;
}

const FUNC_MAP: Record<string, number> = {
  'individual': 1, '2 - 10': 2, '11 - 25': 11, '26 - 49': 26, 'acima de 50': 50,
};

function parseFunc(func: string | null): number {
  if (!func) return 0;
  const lower = func.toLowerCase().trim();
  if (FUNC_MAP[lower] !== undefined) return FUNC_MAP[lower];
  for (const [key, val] of Object.entries(FUNC_MAP)) {
    if (lower.includes(key)) return val;
  }
  const num = parseInt(func, 10);
  return isNaN(num) ? 0 : num;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Operacao em massa sobre toda a base: apenas admin ou chamada server-to-server.
    const denied = await requireAdmin(req, corsHeaders, supabase);
    if (denied) return denied;

    // Fetch scoring config
    const { data: configData, error: configError } = await supabase
      .from("scoring_config")
      .select("*")
      .limit(1)
      .single();

    if (configError || !configData) {
      return new Response(JSON.stringify({ error: "No scoring config found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const criteria = configData.criteria as CriteriaConfig;
    const thresholds = configData.thresholds as Thresholds;

    // Process in batches
    const BATCH = 50;
    let offset = 0;
    let updated = 0;
    let total = 0;

    while (true) {
      const { data: leads, error: leadsErr } = await supabase
        .from("leads")
        .select("id, cargo, faturamento, funcionarios, desafios, utm_source, source, whatsapp")
        .range(offset, offset + BATCH - 1)
        .order("created_at", { ascending: false });

      if (leadsErr || !leads || leads.length === 0) break;
      total += leads.length;

      // Get reconversion counts for this batch
      const leadIds = leads.map(l => l.id);
      const { data: convCounts } = await supabase
        .from("lead_conversions")
        .select("lead_id")
        .in("lead_id", leadIds);

      const convMap: Record<string, number> = {};
      (convCounts || []).forEach(c => {
        convMap[c.lead_id] = (convMap[c.lead_id] || 0) + 1;
      });

      for (const lead of leads) {
        let score = 0;

        // Cargo
        if (criteria.cargo_decisor.enabled) {
          const cargos = criteria.cargo_decisor.cargos || ['CEO', 'Fundador', 'Diretor', 'Sócio', 'COO', 'CFO', 'CTO'];
          const cargo = (lead.cargo || '').toLowerCase();
          if (cargos.some(c => cargo.includes(c.toLowerCase()))) score += criteria.cargo_decisor.points;
        }

        // Faturamento
        if (criteria.faturamento.enabled) {
          if (parseFat(lead.faturamento) >= (criteria.faturamento.min_value || 100000)) score += criteria.faturamento.points;
        }

        // Funcionários
        if (criteria.funcionarios?.enabled) {
          if (parseFunc(lead.funcionarios) >= (criteria.funcionarios.min_value || 10)) score += criteria.funcionarios.points;
        }

        // Desafios
        if (criteria.tem_desafios.enabled) {
          if ((lead.desafios || '').length >= 20) score += criteria.tem_desafios.points;
        }

        // Origem
        if (criteria.origem.enabled && criteria.origem.sources?.length) {
          const sources = criteria.origem.sources.map(s => s.toLowerCase().trim());
          const ls = (lead.utm_source || lead.source || '').toLowerCase();
          if (sources.some(s => ls.includes(s))) score += criteria.origem.points;
        }

        // Reconversão
        if (criteria.reconversao.enabled) {
          if ((convMap[lead.id] || 0) > 1) score += criteria.reconversao.points;
        }

        // WhatsApp
        if (criteria.tem_whatsapp.enabled) {
          if (lead.whatsapp && lead.whatsapp.trim()) score += criteria.tem_whatsapp.points;
        }

        score = Math.min(100, Math.max(0, score));
        const etiqueta = score >= thresholds.hotlead ? 'hotlead' : score >= thresholds.warm ? 'warm' : null;

        await supabase.from("leads").update({ lead_score: score, etiqueta }).eq("id", lead.id);
        updated++;
      }

      if (leads.length < BATCH) break;
      offset += BATCH;
    }

    return new Response(
      JSON.stringify({ success: true, updated, total }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
