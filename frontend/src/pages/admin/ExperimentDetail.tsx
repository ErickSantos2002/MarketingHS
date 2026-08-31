import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Copy, Loader2, Trophy, AlertTriangle, Download, FlaskConical,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useAbTest, useAbEvents, AbEventRow } from "@/hooks/useAbTests";
import { analyzeVariants, VariantVerdict } from "@/lib/abStats";
import { abDistributionLink, abBaseHost } from "@/lib/abConfig";

const pct = (n: number) => (n * 100).toFixed(2) + "%";

function uniqueVals(rows: AbEventRow[], key: keyof AbEventRow): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const v = r[key];
    if (v) set.add(String(v));
  }
  return Array.from(set).sort();
}

interface Filters {
  from: string;
  to: string;
  event_type: string;
  ab_var: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  device_type: string;
  browser: string;
  os: string;
  language: string;
  page_slug: string;
}
const EMPTY_FILTERS: Filters = {
  from: "", to: "", event_type: "", ab_var: "", utm_source: "", utm_medium: "",
  utm_campaign: "", device_type: "", browser: "", os: "", language: "", page_slug: "",
};

const ALL = "__all__";

export default function ExperimentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: test, isLoading } = useAbTest(id);
  const { data: events, isLoading: loadingEvents } = useAbEvents(test?.slug);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  const rows = useMemo(() => events || [], [events]);

  // ---- Agregação por variante (relatório) ----------------------------------
  const report = useMemo(() => {
    const keys = (test?.variants || []).map((v) => v.key);
    const exposures: Record<string, Set<string>> = {};
    const conv: Record<string, Record<string, Set<string>>> = {};
    const steps: Record<string, Record<string, Set<string>>> = {};
    const behavior: Record<string, { scrollSum: number; scrollN: number; cta: number; timeSum: number; timeN: number }> = {};
    for (const k of keys) {
      exposures[k] = new Set();
      conv[k] = {};
      steps[k] = {};
      behavior[k] = { scrollSum: 0, scrollN: 0, cta: 0, timeSum: 0, timeN: 0 };
    }
    for (const r of rows) {
      const k = r.ab_var || "?";
      if (!exposures[k]) continue;
      if (r.event_type === "exposure") exposures[k].add(r.ab_vid);
      else if (r.event_type === "conversion" && r.event_name) {
        (conv[k][r.event_name] = conv[k][r.event_name] || new Set()).add(r.ab_vid);
      } else if (r.event_type === "schedule_step") {
        const st = String((r.metadata as { step?: unknown } | null)?.step ?? r.event_name ?? "?");
        (steps[k][st] = steps[k][st] || new Set()).add(r.ab_vid);
      } else if (r.event_type === "behavior") {
        const md = (r.metadata || {}) as { depth?: number; seconds?: number };
        if (r.event_name === "scroll" && typeof md.depth === "number") { behavior[k].scrollSum += md.depth; behavior[k].scrollN++; }
        else if (r.event_name === "cta_click") behavior[k].cta++;
        else if (r.event_name === "time_on_page" && typeof md.seconds === "number") { behavior[k].timeSum += md.seconds; behavior[k].timeN++; }
      }
    }
    return { keys, exposures, conv, steps, behavior };
  }, [rows, test]);

  const verdicts: VariantVerdict[] = useMemo(() => {
    if (!test) return [];
    const primary = test.primary_metric;
    const inputs = report.keys.map((k) => ({
      key: k,
      conversions: report.conv[k]?.[primary]?.size || 0,
      exposures: report.exposures[k]?.size || 0,
    }));
    if (inputs.every((i) => i.exposures === 0)) return [];
    return analyzeVariants(inputs, test.control_variant || undefined);
  }, [report, test]);

  const winner = useMemo(() => {
    if (!verdicts.length) return null;
    return verdicts.reduce((a, b) => (b.probBest > a.probBest ? b : a));
  }, [verdicts]);

  const preliminary = useMemo(() => {
    if (!test?.target_sample_per_variant) return true;
    return report.keys.some((k) => (report.exposures[k]?.size || 0) < (test.target_sample_per_variant || 0));
  }, [report, test]);

  const controlGuardrailRate = useMemo(() => {
    if (!test?.guardrail_metric || !test.control_variant) return null;
    const k = test.control_variant;
    const exp = report.exposures[k]?.size || 0;
    if (!exp) return null;
    return (report.conv[k]?.[test.guardrail_metric]?.size || 0) / exp;
  }, [report, test]);

  // ---- Filtro (análise) ----------------------------------------------------
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filters.from && r.occurred_at < filters.from) return false;
      if (filters.to && r.occurred_at > filters.to + "T23:59:59") return false;
      if (filters.event_type && r.event_type !== filters.event_type) return false;
      if (filters.ab_var && r.ab_var !== filters.ab_var) return false;
      if (filters.utm_source && r.utm_source !== filters.utm_source) return false;
      if (filters.utm_medium && r.utm_medium !== filters.utm_medium) return false;
      if (filters.utm_campaign && r.utm_campaign !== filters.utm_campaign) return false;
      if (filters.device_type && r.device_type !== filters.device_type) return false;
      if (filters.browser && r.browser !== filters.browser) return false;
      if (filters.os && r.os !== filters.os) return false;
      if (filters.language && r.language !== filters.language) return false;
      if (filters.page_slug && r.page_slug !== filters.page_slug) return false;
      return true;
    });
  }, [rows, filters]);

  const filtersActive = Object.values(filters).some(Boolean);

  const copyLink = () => {
    if (!test) return;
    navigator.clipboard.writeText(abDistributionLink(test.public_slug));
    toast.success("Link de distribuição copiado.");
  };

  const exportCsv = () => {
    const cols: (keyof AbEventRow)[] = [
      "occurred_at", "event_type", "event_name", "ab_var", "ab_vid", "page_slug",
      "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
      "gclid", "fbclid", "ttclid", "msclkid", "device_type", "browser", "os",
      "language", "screen_resolution", "referrer",
    ];
    const esc = (v: unknown) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
    const header = cols.join(";");
    const body = filtered.map((r) => cols.map((c) => esc(r[c])).join(";")).join("\n");
    const blob = new Blob(["﻿" + header + "\n" + body], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ab-${test?.slug || "teste"}.csv`;
    a.click();
  };

  if (isLoading) return <div className="p-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (!test) return <div className="p-10 text-center text-muted-foreground">Teste não encontrado.</div>;

  const stepKeys = Array.from(new Set(report.keys.flatMap((k) => Object.keys(report.steps[k] || {})))).sort();

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/experiments")}><ArrowLeft className="h-4 w-4" /></Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-primary" /> {test.name}
          </h1>
          <p className="text-xs text-muted-foreground font-mono">
            {abBaseHost()}/{test.public_slug} · {test.status}
            {test.status === "completed" && test.winner_variant && ` · vencedora ${test.winner_variant}`}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={copyLink}><Copy className="h-4 w-4 mr-2" /> Link</Button>
      </div>

      {preliminary && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-700 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" /> Resultado <strong>PRELIMINAR</strong> — amostra alvo ainda não atingida. Não declare vencedor cedo.
        </div>
      )}

      <Tabs defaultValue="report">
        <TabsList>
          <TabsTrigger value="report">Relatório</TabsTrigger>
          <TabsTrigger value="analysis">Análise</TabsTrigger>
        </TabsList>

        {/* ---------------- RELATÓRIO ---------------- */}
        <TabsContent value="report" className="space-y-6">
          {loadingEvents ? (
            <div className="p-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : (
            <>
              {winner && !preliminary && (
                <div className="rounded-lg border border-primary/40 bg-primary/10 px-4 py-3 text-sm flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-primary" />
                  Variante <strong>{winner.key}</strong> tem <strong>{pct(winner.probBest)}</strong> de probabilidade de ser a melhor
                  em <strong>{test.primary_metric}</strong> (bayesiano).
                </div>
              )}

              <Card className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Variante</TableHead>
                      <TableHead>Exposições únicas</TableHead>
                      <TableHead>{test.primary_metric}</TableHead>
                      <TableHead>Taxa (primária)</TableHead>
                      <TableHead>P(melhor)</TableHead>
                      <TableHead>Uplift</TableHead>
                      {test.guardrail_metric && <TableHead>{test.guardrail_metric} (guardrail)</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.keys.map((k) => {
                      const v = verdicts.find((x) => x.key === k);
                      const exp = report.exposures[k]?.size || 0;
                      const guard = test.guardrail_metric ? (report.conv[k]?.[test.guardrail_metric]?.size || 0) : 0;
                      const guardRate = exp > 0 ? guard / exp : 0;
                      const guardWorse =
                        controlGuardrailRate != null && k !== test.control_variant && guardRate < controlGuardrailRate;
                      const isControl = k === test.control_variant;
                      return (
                        <TableRow key={k}>
                          <TableCell className="font-medium">
                            {k} {isControl && <Badge variant="outline" className="ml-1 text-[10px]">controle</Badge>}
                          </TableCell>
                          <TableCell>{exp.toLocaleString("pt-BR")}</TableCell>
                          <TableCell>{v?.conversions ?? 0}</TableCell>
                          <TableCell>
                            {v ? pct(v.rate) : "—"}
                            {v && <span className="text-xs text-muted-foreground ml-1">[{pct(v.ciLow)}–{pct(v.ciHigh)}]</span>}
                          </TableCell>
                          <TableCell>{v ? pct(v.probBest) : "—"}</TableCell>
                          <TableCell>{v?.upliftVsControl != null ? (v.upliftVsControl >= 0 ? "+" : "") + pct(v.upliftVsControl) : "—"}</TableCell>
                          {test.guardrail_metric && (
                            <TableCell className={guardWorse ? "text-red-600 font-semibold" : ""}>
                              {pct(guardRate)} {guardWorse && <AlertTriangle className="h-3 w-3 inline ml-1" />}
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>

              {stepKeys.length > 0 && (
                <Card className="p-4">
                  <h3 className="font-semibold mb-3 text-sm">Funil do agendamento (etapas, visitantes únicos)</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Variante</TableHead>
                        {stepKeys.map((s) => <TableHead key={s}>Etapa {s}</TableHead>)}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.keys.map((k) => (
                        <TableRow key={k}>
                          <TableCell className="font-medium">{k}</TableCell>
                          {stepKeys.map((s) => <TableCell key={s}>{report.steps[k]?.[s]?.size || 0}</TableCell>)}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              )}

              <Card className="p-4">
                <h3 className="font-semibold mb-3 text-sm">Comportamento por variante (explica o porquê)</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Variante</TableHead>
                      <TableHead>Scroll médio</TableHead>
                      <TableHead>Cliques em CTA</TableHead>
                      <TableHead>Tempo médio (s)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.keys.map((k) => {
                      const b = report.behavior[k];
                      return (
                        <TableRow key={k}>
                          <TableCell className="font-medium">{k}</TableCell>
                          <TableCell>{b.scrollN ? Math.round(b.scrollSum / b.scrollN) + "%" : "—"}</TableCell>
                          <TableCell>{b.cta}</TableCell>
                          <TableCell>{b.timeN ? Math.round(b.timeSum / b.timeN) : "—"}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ---------------- ANÁLISE ---------------- */}
        <TabsContent value="analysis" className="space-y-4">
          <Card className="p-4 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div><Label className="text-xs">De</Label><Input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></div>
              <div><Label className="text-xs">Até</Label><Input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></div>
              <FilterSelect label="Tipo de evento" value={filters.event_type} options={uniqueVals(rows, "event_type")} onChange={(v) => setFilters({ ...filters, event_type: v })} />
              <FilterSelect label="Variante" value={filters.ab_var} options={uniqueVals(rows, "ab_var")} onChange={(v) => setFilters({ ...filters, ab_var: v })} />
              <FilterSelect label="utm_source" value={filters.utm_source} options={uniqueVals(rows, "utm_source")} onChange={(v) => setFilters({ ...filters, utm_source: v })} />
              <FilterSelect label="utm_medium" value={filters.utm_medium} options={uniqueVals(rows, "utm_medium")} onChange={(v) => setFilters({ ...filters, utm_medium: v })} />
              <FilterSelect label="utm_campaign" value={filters.utm_campaign} options={uniqueVals(rows, "utm_campaign")} onChange={(v) => setFilters({ ...filters, utm_campaign: v })} />
              <FilterSelect label="Dispositivo" value={filters.device_type} options={uniqueVals(rows, "device_type")} onChange={(v) => setFilters({ ...filters, device_type: v })} />
              <FilterSelect label="Navegador" value={filters.browser} options={uniqueVals(rows, "browser")} onChange={(v) => setFilters({ ...filters, browser: v })} />
              <FilterSelect label="SO" value={filters.os} options={uniqueVals(rows, "os")} onChange={(v) => setFilters({ ...filters, os: v })} />
              <FilterSelect label="Idioma" value={filters.language} options={uniqueVals(rows, "language")} onChange={(v) => setFilters({ ...filters, language: v })} />
              <FilterSelect label="Página" value={filters.page_slug} options={uniqueVals(rows, "page_slug")} onChange={(v) => setFilters({ ...filters, page_slug: v })} />
            </div>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-sm text-muted-foreground">
                {filtered.length.toLocaleString("pt-BR")} de {rows.length.toLocaleString("pt-BR")} eventos
                {filtersActive && <Button variant="link" size="sm" className="h-auto p-0 ml-2" onClick={() => setFilters(EMPTY_FILTERS)}>limpar filtros</Button>}
              </div>
              <Button variant="outline" size="sm" onClick={exportCsv}><Download className="h-4 w-4 mr-2" /> Exportar CSV</Button>
            </div>
            {filtersActive && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 flex items-center gap-2">
                <AlertTriangle className="h-3 w-3" /> Leitura exploratória — filtros reduzem a amostra e geram hipótese, não veredito.
              </div>
            )}
          </Card>

          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Evento</TableHead>
                  <TableHead>Var</TableHead>
                  <TableHead>Página</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Device</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.slice(0, 300).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs whitespace-nowrap">{new Date(r.occurred_at).toLocaleString("pt-BR")}</TableCell>
                    <TableCell className="text-xs">{r.event_type}{r.event_name ? `:${r.event_name}` : ""}</TableCell>
                    <TableCell className="text-xs">{r.ab_var}</TableCell>
                    <TableCell className="text-xs">{r.page_slug}</TableCell>
                    <TableCell className="text-xs">{r.utm_source || "—"}{r.utm_campaign ? ` / ${r.utm_campaign}` : ""}</TableCell>
                    <TableCell className="text-xs">{r.device_type} · {r.browser}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {filtered.length > 300 && <div className="p-3 text-xs text-muted-foreground text-center">Mostrando 300 de {filtered.length}. Exporte o CSV para o recorte completo.</div>}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function FilterSelect({ label, value, options, onChange }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? "" : v)}>
        <SelectTrigger className="h-9"><SelectValue placeholder="Todos" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todos</SelectItem>
          {options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
