import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ErroApi } from "@/lib/api";

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
  /** Slug da URL pública ({redirecionador}/{public_slug}). Reutilizável entre testes;
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
    queryFn: () => api.get<AbTest[]>("/ab/testes"),
  });
}

export function useAbTest(id: string | undefined) {
  return useQuery({
    queryKey: ["ab_test", id],
    enabled: !!id,
    queryFn: async (): Promise<AbTest | null> => {
      try {
        return await api.get<AbTest>(`/ab/testes/${id}`);
      } catch (e) {
        // A tela trata "não existe" como null, como o maybeSingle() de antes.
        if (e instanceof ErroApi && e.status === 404) return null;
        throw e;
      }
    },
  });
}

export function useCreateAbTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<AbTest>) => api.post<AbTest>("/ab/testes", payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ab_tests"] }),
  });
}

export function useUpdateAbTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<AbTest> }) =>
      api.patch<AbTest>(`/ab/testes/${id}`, patch),
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
// novo na mesma transação. Se outro admin ganhar a corrida, a rota devolve 409
// com a mensagem pronta para o toast.
export function useActivateAbTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, force }: { id: string; force?: boolean }) =>
      api.post<ActivateResult>(`/ab/testes/${id}/ativar`, { force: !!force }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["ab_tests"] });
      qc.invalidateQueries({ queryKey: ["ab_test", vars.id] });
    },
  });
}

export interface AbEventsPage {
  events: AbEventRow[];
  // true quando o teste tem mais eventos que o teto — o relatório é parcial.
  truncado: boolean;
  teto: number;
}

// Eventos do teste, mais novos primeiro, até 20.000 (o teto da origem).
export function useAbEvents(testId: string | undefined) {
  return useQuery({
    queryKey: ["ab_events", testId],
    enabled: !!testId,
    refetchInterval: 60000,
    queryFn: () => api.get<AbEventsPage>(`/ab/testes/${testId}/eventos`),
  });
}
