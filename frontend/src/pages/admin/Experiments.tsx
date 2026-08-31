import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  FlaskConical, Plus, Copy, Play, Pause, Trash2, BarChart3, Loader2, Settings2, Flag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useAbTests, useCreateAbTest, useUpdateAbTest, useActivateAbTest,
  publicSlugify, internalSlug, runningTestForSlug, PUBLIC_SLUG_RE,
  AbTest, AbVariant,
} from "@/hooks/useAbTests";
import { requiredSamplePerVariant, estimateDurationDays } from "@/lib/abStats";
import { abDistributionLink, abBaseHost, normalizeProductionDomain, domainOf, isHostInDomain } from "@/lib/abConfig";
import { useAbConfig } from "@/hooks/useAbConfig";

const VARIANT_KEYS = ["A", "B", "C", "D", "E", "F"];

const STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho", running: "Rodando", paused: "Pausado",
  completed: "Concluído", archived: "Arquivado",
};
const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  running: "default", paused: "secondary", draft: "outline",
  completed: "secondary", archived: "outline",
};

interface FormState {
  name: string;
  public_slug: string;
  hypothesis: string;
  primary_metric: string;
  guardrail_metric: string;
  variants: AbVariant[];
  control_variant: string;
  baseline: string;
  mde: string;
  dailyTraffic: string;
  starts_at: string;
  ends_at: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  public_slug: "",
  hypothesis: "",
  primary_metric: "lead_criado",
  guardrail_metric: "agendamento",
  variants: [
    { key: "A", url: "", weight: 50, label: "Controle" },
    { key: "B", url: "", weight: 50, label: "Variante" },
  ],
  control_variant: "A",
  baseline: "3",
  mde: "30",
  dailyTraffic: "100",
  starts_at: "",
  ends_at: "",
};

export default function Experiments() {
  const navigate = useNavigate();
  const { data: tests, isLoading } = useAbTests();
  const { productionDomain } = useAbConfig();
  const createTest = useCreateAbTest();
  const updateTest = useUpdateAbTest();
  const activateTest = useActivateAbTest();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  // Enquanto o admin não editar a slug à mão, ela acompanha o nome.
  const [slugTouched, setSlugTouched] = useState(false);
  // Teste que o admin quer ativar + o nome do que já está rodando na mesma slug.
  const [conflict, setConflict] = useState<{ target: AbTest; runningName: string } | null>(null);
  // Teste sendo concluído + variante vencedora escolhida ("" = usar controle).
  const [finishing, setFinishing] = useState<AbTest | null>(null);
  const [winner, setWinner] = useState("");

  const sample = useMemo(() => {
    const baseline = parseFloat(form.baseline) / 100;
    const mde = parseFloat(form.mde) / 100;
    const daily = parseFloat(form.dailyTraffic);
    const perVariant = requiredSamplePerVariant(baseline, mde);
    const days = estimateDurationDays(perVariant, daily, form.variants.length);
    return { perVariant, days };
  }, [form.baseline, form.mde, form.dailyTraffic, form.variants.length]);

  const setVariant = (i: number, patch: Partial<AbVariant>) => {
    setForm((f) => ({
      ...f,
      variants: f.variants.map((v, idx) => (idx === i ? { ...v, ...patch } : v)),
    }));
  };
  const addVariant = () => {
    setForm((f) => {
      if (f.variants.length >= VARIANT_KEYS.length) return f;
      const key = VARIANT_KEYS[f.variants.length];
      return { ...f, variants: [...f.variants, { key, url: "", weight: 0, label: `Variante ${key}` }] };
    });
  };
  const removeVariant = (i: number) => {
    setForm((f) => {
      if (f.variants.length <= 2) return f;
      const variants = f.variants.filter((_, idx) => idx !== i).map((v, idx) => ({ ...v, key: VARIANT_KEYS[idx] }));
      const control = variants.some((v) => v.key === f.control_variant) ? f.control_variant : variants[0].key;
      return { ...f, variants, control_variant: control };
    });
  };

  // Slug pública efetiva: o que o admin digitou ou a sugestão a partir do nome.
  const publicSlug = slugTouched ? form.public_slug : publicSlugify(form.name);
  const slugInUseBy = runningTestForSlug(tests, publicSlug);

  const handleCreate = async () => {
    if (!form.name.trim()) return toast.error("Dê um nome ao teste.");
    if (!PUBLIC_SLUG_RE.test(publicSlug)) {
      return toast.error("Slug inválida — use apenas letras minúsculas, números e hífens (ex.: home-oferta).");
    }
    if (form.variants.some((v) => !v.url.trim())) return toast.error("Toda variante precisa de uma URL de destino.");
    // Guardrail de conformidade: toda variante tem de ficar no domínio de produção
    // (ou num subdomínio dele). URLs fora dele viram cross-domain redirect no
    // anúncio — principal causa de reprovação por "Destination mismatch" no
    // Google/Meta. O domínio é configurável em /experiments/setup.
    const prod = normalizeProductionDomain(productionDomain);
    for (const v of form.variants) {
      const host = domainOf(v.url);
      if (!host) {
        return toast.error(`Variante ${v.key}: URL inválida — use o endereço completo (https://…).`);
      }
      if (!isHostInDomain(host, prod)) {
        return toast.error(
          `Variante ${v.key}: a URL deve estar no domínio de produção (${prod}). ` +
          `URLs fora dele causam reprovação por cross-domain no Google/Meta.`
        );
      }
    }
    try {
      const test = await createTest.mutateAsync({
        public_slug: publicSlug,
        slug: internalSlug(publicSlug),
        name: form.name.trim(),
        hypothesis: form.hypothesis.trim() || null,
        status: "draft",
        variants: form.variants.map((v) => ({ ...v, weight: Number(v.weight) || 0 })),
        control_variant: form.control_variant,
        primary_metric: form.primary_metric,
        guardrail_metric: form.guardrail_metric || null,
        target_sample_per_variant: sample.perVariant || null,
        starts_at: form.starts_at || null,
        ends_at: form.ends_at || null,
      });
      toast.success("Teste criado como rascunho.");
      setOpen(false);
      setForm(EMPTY_FORM);
      setSlugTouched(false);
      navigate(`/experiments/${test.id}`);
    } catch (e) {
      toast.error("Erro ao criar teste: " + (e as Error).message);
    }
  };

  const pause = async (t: AbTest) => {
    try {
      await updateTest.mutateAsync({ id: t.id, patch: { status: "paused" } });
      toast.success("Teste pausado (kill switch: 100% controle).");
    } catch (e) {
      toast.error("Erro: " + (e as Error).message);
    }
  };

  // Ativar: só um teste pode rodar por slug. Se já houver outro rodando, abre o
  // diálogo para o admin decidir se finaliza o atual.
  const activate = async (t: AbTest, force = false) => {
    const running = runningTestForSlug(tests, t.public_slug, t.id);
    if (running && !force) {
      setConflict({ target: t, runningName: running.name });
      return;
    }
    try {
      const res = await activateTest.mutateAsync({ id: t.id, force });
      if (!res.activated) {
        // A RPC recusou: outro teste passou a rodar nesta slug entre a checagem
        // local e a chamada (outro admin). Pergunta com o nome que ela devolveu.
        setConflict({ target: t, runningName: res.conflict_name || "outro teste" });
        return;
      }
      setConflict(null);
      toast.success(
        res.completed_name
          ? `"${res.completed_name}" concluído; "${t.name}" ativado.`
          : "Teste ativado.",
      );
    } catch (e) {
      toast.error("Erro: " + (e as Error).message);
    }
  };

  // Concluir: encerra o teste e define quem recebe o tráfego da slug daqui pra frente.
  const finish = async () => {
    if (!finishing) return;
    try {
      await updateTest.mutateAsync({
        id: finishing.id,
        patch: {
          status: "completed",
          winner_variant: winner || null,
          ends_at: new Date().toISOString(),
        },
      });
      toast.success(
        winner
          ? `Teste concluído — variante ${winner} recebe 100% do tráfego.`
          : "Teste concluído — o controle recebe 100% do tráfego.",
      );
      setFinishing(null);
      setWinner("");
    } catch (e) {
      toast.error("Erro: " + (e as Error).message);
    }
  };

  const archive = async (t: AbTest) => {
    try {
      await updateTest.mutateAsync({ id: t.id, patch: { status: "archived" } });
      toast.success("Teste arquivado.");
    } catch (e) {
      toast.error("Erro: " + (e as Error).message);
    }
  };

  const copyLink = (slug: string) => {
    navigator.clipboard.writeText(abDistributionLink(slug));
    toast.success("Link de distribuição copiado.");
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FlaskConical className="h-6 w-6 text-primary" /> Testes A/B
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Split-URL por redirecionamento — mede qual página gera leads e agendamentos de maior valor.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => navigate("/experiments/setup")}>
            <Settings2 className="h-4 w-4 mr-2" /> Configuração & Instruções
          </Button>
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> Novo teste
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-10 flex justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : !tests || tests.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground">
            Nenhum teste ainda. Crie o primeiro para gerar um Link de Distribuição.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Teste</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Métrica primária</TableHead>
                <TableHead>Variantes</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tests.map((t) => {
                const busyBy = t.status === "running" ? undefined : runningTestForSlug(tests, t.public_slug, t.id);
                return (
                <TableRow key={t.id} className="cursor-pointer" onClick={() => navigate(`/experiments/${t.id}`)}>
                  <TableCell>
                    <div className="font-medium">{t.name}</div>
                    <div className="text-xs text-muted-foreground font-mono">{abBaseHost()}/{t.public_slug}</div>
                    {busyBy && (
                      <div className="text-xs text-muted-foreground mt-0.5">slug em uso por "{busyBy.name}"</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[t.status] || "outline"}>{STATUS_LABEL[t.status] || t.status}</Badge>
                    {t.status === "completed" && t.winner_variant && (
                      <span className="text-xs text-muted-foreground ml-2">vencedora {t.winner_variant}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{t.primary_metric}</TableCell>
                  <TableCell className="text-sm">{t.variants?.length ?? 0}</TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" title="Copiar link" onClick={() => copyLink(t.public_slug)}>
                        <Copy className="h-4 w-4" />
                      </Button>
                      {t.status === "running" ? (
                        <Button variant="ghost" size="icon" title="Pausar (kill switch)" onClick={() => pause(t)}>
                          <Pause className="h-4 w-4" />
                        </Button>
                      ) : t.status === "archived" ? null : (
                        <Button variant="ghost" size="icon" title="Ativar" onClick={() => activate(t)}>
                          <Play className="h-4 w-4" />
                        </Button>
                      )}
                      {(t.status === "running" || t.status === "paused") && (
                        <Button variant="ghost" size="icon" title="Concluir teste"
                          onClick={() => { setFinishing(t); setWinner(""); }}>
                          <Flag className="h-4 w-4" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" title="Relatório" onClick={() => navigate(`/experiments/${t.id}`)}>
                        <BarChart3 className="h-4 w-4" />
                      </Button>
                      {t.status !== "archived" && (
                        <Button variant="ghost" size="icon" title="Arquivar" onClick={() => archive(t)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Novo teste A/B</DialogTitle>
            <DialogDescription>
              Em baixo volume, teste páginas bem diferentes (oferta/estrutura), não variações sutis.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Nome</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ex.: Home — oferta A vs. oferta B" />
            </div>
            <div>
              <Label>Slug da URL</Label>
              <Input value={publicSlug}
                onChange={(e) => { setSlugTouched(true); setForm({ ...form, public_slug: e.target.value }); }}
                placeholder="home-oferta" />
              <p className="text-xs text-muted-foreground mt-1 font-mono">{abBaseHost()}/{publicSlug || "…"}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Este é o link que vai no anúncio. Pode ser reutilizado em testes futuros — só um teste fica ativo por slug de cada vez.
              </p>
              {slugInUseBy && (
                <p className="text-xs text-amber-600 mt-1">
                  Esta slug tem o teste "{slugInUseBy.name}" ativo. O novo nasce como rascunho; ao ativá-lo você poderá finalizar o atual.
                </p>
              )}
            </div>
            <div>
              <Label>Hipótese</Label>
              <Textarea value={form.hypothesis} onChange={(e) => setForm({ ...form, hypothesis: e.target.value })}
                placeholder="Porque [observação], acreditamos que [mudança] causará [resultado] para [público]; saberemos quando [métrica]." rows={3} />
            </div>

            <Separator />

            <div className="space-y-2">
              <Label>Variantes (URLs de destino + peso)</Label>
              {form.variants.map((v, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Badge variant="outline" className="w-8 justify-center">{v.key}</Badge>
                  <Input className="flex-1" placeholder="https://dnia.ai/pagina" value={v.url}
                    onChange={(e) => setVariant(i, { url: e.target.value })} />
                  <Input className="w-20" type="number" min={0} value={v.weight}
                    onChange={(e) => setVariant(i, { weight: Number(e.target.value) })} title="Peso" />
                  {form.variants.length > 2 && (
                    <Button variant="ghost" size="icon" onClick={() => removeVariant(i)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              <div className="flex items-center gap-3">
                <Button variant="outline" size="sm" onClick={addVariant} disabled={form.variants.length >= VARIANT_KEYS.length}>
                  <Plus className="h-4 w-4 mr-1" /> Variante
                </Button>
                <div className="flex items-center gap-2">
                  <Label className="text-xs">Controle:</Label>
                  <Select value={form.control_variant} onValueChange={(val) => setForm({ ...form, control_variant: val })}>
                    <SelectTrigger className="w-20 h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {form.variants.map((v) => <SelectItem key={v.key} value={v.key}>{v.key}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Métrica primária (decisão)</Label>
                <Select value={form.primary_metric} onValueChange={(val) => setForm({ ...form, primary_metric: val })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lead_criado">lead_criado</SelectItem>
                    <SelectItem value="agendamento">agendamento</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Guardrail (valor)</Label>
                <Select value={form.guardrail_metric} onValueChange={(val) => setForm({ ...form, guardrail_metric: val })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="agendamento">agendamento</SelectItem>
                    <SelectItem value="lead_criado">lead_criado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Conversão base (%)</Label>
                <Input type="number" value={form.baseline} onChange={(e) => setForm({ ...form, baseline: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Efeito mínimo (%)</Label>
                <Input type="number" value={form.mde} onChange={(e) => setForm({ ...form, mde: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Tráfego/dia</Label>
                <Input type="number" value={form.dailyTraffic} onChange={(e) => setForm({ ...form, dailyTraffic: e.target.value })} />
              </div>
            </div>
            <div className="rounded-lg bg-muted/40 p-3 text-sm">
              Amostra necessária: <strong>{sample.perVariant.toLocaleString("pt-BR")}</strong> por variante ·
              duração estimada: <strong>{sample.days}</strong> dias.
              {sample.days > 60 && <span className="text-amber-600"> ⚠ Muito longo — teste diferenças maiores.</span>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Início (opcional)</Label>
                <Input type="date" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Fim (opcional)</Label>
                <Input type="date" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setSlugTouched(false); }}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={createTest.isPending}>
              {createTest.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Criar como rascunho
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!conflict} onOpenChange={(o) => !o && setConflict(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Já existe um teste ativo nesta slug</AlertDialogTitle>
            <AlertDialogDescription>
              {abBaseHost()}/{conflict?.target.public_slug} está rodando "{conflict?.runningName}".
              Só pode haver um teste ativo por slug de cada vez.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); if (conflict) activate(conflict.target, true); }}
              disabled={activateTest.isPending}
            >
              {activateTest.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Finalizar "{conflict?.runningName}" e ativar este
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!finishing} onOpenChange={(o) => !o && setFinishing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Concluir "{finishing?.name}"</DialogTitle>
            <DialogDescription>
              O tráfego de {abBaseHost()}/{finishing?.public_slug} passa a ir 100% para a vencedora
              (ou para o controle) até outro teste ser ativado nesta slug.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label>Variante vencedora</Label>
            <Select value={winner || "__control__"} onValueChange={(v) => setWinner(v === "__control__" ? "" : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__control__">— usar o controle —</SelectItem>
                {(finishing?.variants || []).map((v) => (
                  <SelectItem key={v.key} value={v.key}>{v.key}{v.label ? ` — ${v.label}` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFinishing(null)}>Cancelar</Button>
            <Button onClick={finish} disabled={updateTest.isPending}>
              {updateTest.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Concluir teste
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
