import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Tabelas ab_* são novas e ainda não constam em types.ts (auto-gerado pelo
// Lovable — não editar à mão). Acessamos via um cliente destipado local; as
// interfaces abaixo garantem a tipagem no nosso lado.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface AbVariant {
  key: string;
  url: string;
  weight: number;
  label?: string;
}

export interface AbTest {
  id: string;
  /** Chave interna do teste: circula em cookies, params ab_test, eventos e
   *  relatórios. Única e imutável — nunca se repete entre testes. */
  slug: string;
  /** Slug da URL pública (go.dnia.ai/{public_slug}). Reutilizável entre testes;
   *  só um teste `running` por vez em cada um. */
  public_slug: string;
  name: string;
  hypothesis: string | null;
  status: "draft" | "running" | "paused" | "completed" | "archived";
  variants: AbVariant[];
  control_variant: string | null;
  /** Variante escolhida ao concluir o teste: recebe 100% do tráfego da
   *  public_slug até outro teste ser ativado nela. */
  winner_variant: string | null;
  primary_metric: string;
  guardrail_metric: string | null;
  target_sample_per_variant: number | null;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AbEventRow {
  id: string;
  ab_test: string;
  ab_var: string | null;
  ab_vid: string;
  event_type: string;
  event_name: string | null;
  occurred_at: string;
  page_slug: string | null;
  url: string | null;
  referrer: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  gclid: string | null;
  fbclid: string | null;
  ttclid: string | null;
  msclkid: string | null;
  device_type: string | null;
  browser: string | null;
  os: string | null;
  language: string | null;
  screen_resolution: string | null;
  metadata: Record<string, unknown> | null;
}

// Slug da URL pública, sugerido a partir do nome. Sem sufixo aleatório: é um
// endereço que o time cola no anúncio e reutiliza em testes futuros.
export function publicSlugify(name: string): string {
  const base = (name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "teste";
}

// Slug interno (chave de dados): derivado do público + sufixo aleatório, que
// mantém o UNIQUE global mesmo quando vários testes compartilham a mesma URL.
export function internalSlug(publicSlug: string): string {
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${publicSlugify(publicSlug)}-${suffix}`;
}

export const PUBLIC_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Teste ativo numa slug pública (a partir da lista já carregada — sem query
// extra). Alimenta o hint do formulário e o diálogo de conflito na ativação.
export function runningTestForSlug(
  tests: AbTest[] | undefined,
  publicSlug: string,
  excludeId?: string,
): AbTest | undefined {
  return (tests || []).find(
    (t) => t.status === "running" && t.public_slug === publicSlug && t.id !== excludeId,
  );
}

export function useAbTests() {
  return useQuery({
    queryKey: ["ab_tests"],
    queryFn: async (): Promise<AbTest[]> => {
      const { data, error } = await db
        .from("ab_tests")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as AbTest[];
    },
  });
}

export function useAbTest(id: string | undefined) {
  return useQuery({
    queryKey: ["ab_test", id],
    enabled: !!id,
    queryFn: async (): Promise<AbTest | null> => {
      const { data, error } = await db.from("ab_tests").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return (data as AbTest) || null;
    },
  });
}

export function useCreateAbTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<AbTest>) => {
      const { data, error } = await db.from("ab_tests").insert(payload).select().single();
      if (error) throw error;
      return data as AbTest;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ab_tests"] }),
  });
}

export function useUpdateAbTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<AbTest> }) => {
      const { data, error } = await db.from("ab_tests").update(patch).eq("id", id).select().single();
      if (error) throw error;
      return data as AbTest;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["ab_tests"] });
      qc.invalidateQueries({ queryKey: ["ab_test", vars.id] });
    },
  });
}

export interface ActivateResult {
  activated: boolean;
  conflict_id?: string | null;
  conflict_name?: string | null;
  completed_id?: string | null;
  completed_name?: string | null;
}

// Ativação de um teste. A RPC é atômica: sem `force`, recusa e devolve o teste
// que já está rodando na mesma slug; com `force`, conclui esse teste e ativa o
// novo na mesma transação (nunca deixa a slug sem ativo por falha no meio).
export function useActivateAbTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, force }: { id: string; force?: boolean }): Promise<ActivateResult> => {
      const { data, error } = await db.rpc("ab_activate_test", {
        p_test_id: id,
        p_force: !!force,
      });
      if (error) {
        // 23505: perdeu a corrida contra o índice único parcial (outro admin).
        if (error.code === "23505") {
          throw new Error("Outro teste foi ativado nesta slug agora mesmo. Recarregue a página.");
        }
        // PGRST202: a migration ab_public_slug_reuse ainda não foi aplicada.
        if (error.code === "PGRST202") {
          throw new Error("Ativação indisponível: a migration ab_public_slug_reuse ainda não foi aplicada.");
        }
        throw error;
      }
      return (data || { activated: false }) as ActivateResult;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["ab_tests"] });
      qc.invalidateQueries({ queryKey: ["ab_test", vars.id] });
    },
  });
}

// Busca eventos do teste (pagina de 1000 em 1000, cap ~20000 — convenção do projeto).
export function useAbEvents(slug: string | undefined) {
  return useQuery({
    queryKey: ["ab_events", slug],
    enabled: !!slug,
    refetchInterval: 60000,
    queryFn: async (): Promise<AbEventRow[]> => {
      const all: AbEventRow[] = [];
      const PAGE = 1000;
      for (let from = 0; from < 20000; from += PAGE) {
        const { data, error } = await db
          .from("ab_events")
          .select("*")
          .eq("ab_test", slug)
          .order("occurred_at", { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const rows = (data || []) as AbEventRow[];
        all.push(...rows);
        if (rows.length < PAGE) break;
      }
      return all;
    },
  });
}
