import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2, AlertTriangle, Sparkles, Download, Tag, X } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const CHUNK_SIZE = 500;
const TAG_CONCURRENCY = 5;

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
  shouldAbort?: () => boolean,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      if (shouldAbort?.()) return;
      const i = cursor++;
      if (i >= items.length) return;
      try {
        const value = await fn(items[i], i);
        results[i] = { status: 'fulfilled', value };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
      done++;
      onProgress?.(done, items.length);
    }
  });
  await Promise.all(workers);
  return results;
}

interface LeadRow {
  email?: string;
  nome?: string;
  whatsapp?: string;
  fullPhone?: string;
  empresa?: string;
  cargo?: string;
  faturamento?: string;
  funcionarios?: string;
  desafios_ia?: string;
  source?: string;
  status?: string;
  tipo?: string;
  [key: string]: string | undefined;
}

interface ImportResult {
  success: boolean;
  updated: number;
  created?: number;
  notFound: number;
  unchanged?: number;
  skippedNoEmail?: number;
  totalRows?: number;
  fieldsEnriched?: number;
  fieldsSkipped?: number;
  mergeMode?: 'enrich' | 'overwrite';
  notFoundEmails?: string[];
  errors: string[];
  tagApplied?: number;
  tagName?: string;
  tagError?: string;
  fatalError?: string;
}

export function LeadsImport() {
  const [csvData, setCsvData] = useState<LeadRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [enrichOnly, setEnrichOnly] = useState(true);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [existingTags, setExistingTags] = useState<string[]>([]);
  const [progress, setProgress] = useState<{
    phase: 'import' | 'tag';
    current: number;
    total: number;
    label: string;
  } | null>(null);
  const abortRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase
      .from('tags')
      .select('name')
      .order('name')
      .then(({ data }) => {
        if (data) setExistingTags(data.map((t: { name: string }) => t.name));
      });
  }, []);

  const headerMap: Record<string, string> = {
    'email': 'email',
    'nome': 'nome',
    'whatsapp': 'whatsapp',
    'fullphone': 'whatsapp',
    'telefone': 'whatsapp',
    'phone': 'whatsapp',
    'cargo': 'cargo',
    'empresa': 'empresa',
    'company': 'empresa',
    'faturamento': 'faturamento',
    'revenue': 'faturamento',
    'funcionarios': 'funcionarios',
    'funcionários': 'funcionarios',
    'employees': 'funcionarios',
    'desafios': 'desafios_ia',
    'desafios_ia': 'desafios_ia',
    'challenges': 'desafios_ia',
    'source': 'source',
    'origem': 'source',
    'status': 'status',
    'etapa': 'status',
    'stage': 'status',
    'tipo': 'tipo',
    'type': 'tipo',
  };

  const normalizeHeader = (h: string): string => {
    const normalized = h.toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
    return headerMap[normalized] || normalized;
  };

  const parseCSV = (text: string): LeadRow[] => {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];

    const firstLine = lines[0];
    const separator = firstLine.includes(';') ? ';' : ',';

    const rawHeaders = firstLine.split(separator).map(h => h.trim().replace(/^"|"$/g, ''));
    const headers = rawHeaders.map(normalizeHeader);

    return lines.slice(1).map(line => {
      const values: string[] = [];
      let current = '';
      let inQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === separator && !inQuotes) {
          values.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current.trim());

      const row: LeadRow = {};
      headers.forEach((header, index) => {
        row[header] = values[index]?.replace(/^"|"$/g, '') || '';
      });
      return row;
    });
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setImportResult(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const data = parseCSV(text);
      setCsvData(data);
      toast.success(`${data.length} registros carregados do CSV`);
    };
    reader.readAsText(file);
  };

  const openTagDialog = () => {
    if (csvData.length === 0) {
      toast.error('Nenhum dado para importar');
      return;
    }
    setTagInput('');
    setTagDialogOpen(true);
  };

  const cancelImport = () => {
    abortRef.current = true;
    toast.info('Cancelando após o lote atual...');
  };

  const runImport = async (tagToApply: string | null) => {
    setTagDialogOpen(false);
    setIsLoading(true);
    setImportResult(null);
    abortRef.current = false;

    const mergeMode: 'enrich' | 'overwrite' = enrichOnly ? 'enrich' : 'overwrite';
    const totalChunks = Math.ceil(csvData.length / CHUNK_SIZE);

    const agg: ImportResult = {
      success: true,
      updated: 0,
      created: 0,
      notFound: 0,
      unchanged: 0,
      skippedNoEmail: 0,
      totalRows: csvData.length,
      fieldsEnriched: 0,
      fieldsSkipped: 0,
      mergeMode,
      notFoundEmails: [],
      errors: [],
    };
    const allProcessedIds: string[] = [];

    try {
      setProgress({ phase: 'import', current: 0, total: csvData.length, label: 'Importando leads' });

      let processedRows = 0;
      for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
        if (abortRef.current) {
          agg.fatalError = `Importação cancelada após ${chunkIdx} de ${totalChunks} lotes.`;
          break;
        }

        const chunk = csvData.slice(chunkIdx * CHUNK_SIZE, (chunkIdx + 1) * CHUNK_SIZE);

        try {
          const { data, error } = await supabase.functions.invoke('import-leads-csv', {
            body: { leads: chunk, mergeMode },
          });

          if (error) throw error;

          agg.updated += data.updated ?? 0;
          agg.created = (agg.created ?? 0) + (data.created ?? 0);
          agg.notFound += data.notFound ?? 0;
          agg.fieldsEnriched = (agg.fieldsEnriched ?? 0) + (data.fieldsEnriched ?? 0);
          agg.fieldsSkipped = (agg.fieldsSkipped ?? 0) + (data.fieldsSkipped ?? 0);
          agg.unchanged = (agg.unchanged ?? 0) + (data.unchanged ?? 0);
          agg.skippedNoEmail = (agg.skippedNoEmail ?? 0) + (data.skippedNoEmail ?? 0);
          if (Array.isArray(data.errors)) agg.errors.push(...data.errors);
          if (Array.isArray(data.notFoundEmails)) {
            agg.notFoundEmails = [...(agg.notFoundEmails ?? []), ...data.notFoundEmails].slice(0, 10);
          }
          if (Array.isArray(data.processedLeadIds)) allProcessedIds.push(...data.processedLeadIds);
        } catch (chunkErr) {
          const msg = chunkErr instanceof Error ? chunkErr.message : 'Erro desconhecido';
          agg.errors.push(`lote ${chunkIdx + 1}/${totalChunks}: ${msg}`);
        }

        processedRows += chunk.length;
        setProgress({
          phase: 'import',
          current: processedRows,
          total: csvData.length,
          label: `Importando: lote ${chunkIdx + 1} de ${totalChunks}`,
        });
      }

      // Aplicar tag
      if (tagToApply && allProcessedIds.length > 0 && !abortRef.current) {
        agg.tagName = tagToApply;
        setProgress({
          phase: 'tag',
          current: 0,
          total: allProcessedIds.length,
          label: `Aplicando tag "${tagToApply}"`,
        });

        try {
          const results = await runWithConcurrency(
            allProcessedIds,
            TAG_CONCURRENCY,
            async (leadId) => {
              const { error } = await supabase.functions.invoke('apply-lead-tag', {
                body: { lead_id: leadId, tag: tagToApply },
              });
              if (error) throw error;
              return true;
            },
            (done, total) => {
              setProgress({
                phase: 'tag',
                current: done,
                total,
                label: `Aplicando tag "${tagToApply}"`,
              });
            },
            () => abortRef.current,
          );
          agg.tagApplied = results.filter((r) => r?.status === 'fulfilled').length;
          const tagFailed = results.filter((r) => r?.status === 'rejected').length;
          if (tagFailed > 0) {
            agg.tagError = `${tagFailed} contato(s) não receberam a tag`;
          }

          const { data: tagsRefreshed } = await supabase.from('tags').select('name').order('name');
          if (tagsRefreshed) setExistingTags(tagsRefreshed.map((t: { name: string }) => t.name));
        } catch (tagErr) {
          const msg = tagErr instanceof Error ? tagErr.message : 'Erro desconhecido';
          agg.tagError = msg;
        }
      }

      // Toasts finais
      if (agg.updated > 0) toast.success(`${agg.updated} leads atualizados`);
      if ((agg.created ?? 0) > 0) toast.success(`${agg.created} novos leads criados`);
      if (agg.notFound > 0) toast.warning(`${agg.notFound} emails não puderam ser processados`);
      if (agg.errors.length > 0) toast.error(`${agg.errors.length} erros durante a importação`);
      if (agg.tagName && agg.tagApplied !== undefined) {
        toast.success(`Tag "${agg.tagName}" aplicada a ${agg.tagApplied} contato(s)`);
      }

      setImportResult(agg);
    } catch (error) {
      console.error('Erro na importação:', error);
      const msg = error instanceof Error ? error.message : 'Erro desconhecido';
      agg.fatalError = msg;
      setImportResult(agg);
      toast.error('Erro ao importar dados');
    } finally {
      setIsLoading(false);
      setProgress(null);
      abortRef.current = false;
    }
  };


  const clearData = () => {
    setCsvData([]);
    setImportResult(null);
    setFileName('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Dynamic columns from the parsed CSV
  const previewColumns: string[] = csvData.length > 0
    ? Array.from(
        csvData.slice(0, 50).reduce((set, row) => {
          Object.keys(row).forEach((k) => set.add(k));
          return set;
        }, new Set<string>())
      )
    : [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Importar Dados de CSV
          </CardTitle>
          <CardDescription>
            Faça upload de um arquivo CSV para atualizar os dados qualitativos dos leads existentes.
            O email será usado como chave única para correspondência.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
            <div className="flex items-center gap-3">
              <Sparkles className="h-5 w-5 text-primary" />
              <div>
                <Label htmlFor="enrich-mode" className="text-sm font-medium">
                  Modo de Enriquecimento Inteligente
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {enrichOnly
                    ? 'Apenas preenche campos que estão vazios na base'
                    : 'Sobrescreve todos os campos, mesmo os já preenchidos'}
                </p>
              </div>
            </div>
            <Switch
              id="enrich-mode"
              checked={enrichOnly}
              onCheckedChange={setEnrichOnly}
            />
          </div>

          {!enrichOnly && (
            <Alert variant="destructive" className="border-destructive/50 bg-destructive/10">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Atenção: Modo Sobrescrever Ativado</AlertTitle>
              <AlertDescription>
                Os dados do CSV irão substituir os dados existentes, mesmo os já preenchidos.
                Use com cuidado para não perder informações importantes.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              className="hidden"
              id="csv-upload"
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
            >
              <Upload className="h-4 w-4 mr-2" />
              Selecionar Arquivo CSV
            </Button>
            <a
              href="/templates/modelo-importacao-leads.csv"
              download="modelo-importacao-leads.csv"
              className="inline-flex items-center text-sm text-primary hover:underline"
            >
              <Download className="h-4 w-4 mr-1.5" />
              Baixar modelo de importação
            </a>
            {fileName && (
              <span className="text-sm text-muted-foreground">
                {fileName} ({csvData.length} registros)
              </span>
            )}
          </div>

          {csvData.length > 0 && (
            <>
              <div className="border rounded-lg overflow-hidden">
                <div className="max-h-64 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {previewColumns.map((col) => (
                          <TableHead key={col} className="whitespace-nowrap capitalize">
                            {col.replace(/_/g, ' ')}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {csvData.slice(0, 10).map((row, index) => (
                        <TableRow key={index}>
                          {previewColumns.map((col) => (
                            <TableCell key={col} className="whitespace-nowrap">
                              {row[col] ?? ''}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {csvData.length > 10 && (
                  <div className="p-2 text-center text-sm text-muted-foreground border-t">
                    Mostrando 10 de {csvData.length} registros
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <Button onClick={openTagDialog} disabled={isLoading}>
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Importando...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      {enrichOnly ? 'Enriquecer Leads' : 'Sobrescrever Dados'}
                    </>
                  )}
                </Button>
                <Button variant="outline" onClick={clearData} disabled={isLoading}>
                  Limpar
                </Button>
                {isLoading && (
                  <Button variant="ghost" onClick={cancelImport}>
                    <X className="h-4 w-4 mr-2" />
                    Cancelar
                  </Button>
                )}
              </div>

              {progress && (
                <div className="space-y-2 p-4 rounded-lg border bg-muted/30">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{progress.label}</span>
                    <span className="text-muted-foreground">
                      {progress.current} / {progress.total}
                    </span>
                  </div>
                  <Progress
                    value={progress.total > 0 ? (progress.current / progress.total) * 100 : 0}
                  />
                  <p className="text-xs text-muted-foreground">
                    Processando em lotes de {CHUNK_SIZE.toLocaleString('pt-BR')} para arquivos grandes.
                    Mantenha esta aba aberta até o final.
                  </p>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {importResult && (
        <Alert variant={importResult.errors.length > 0 || importResult.fatalError ? 'destructive' : 'default'}>
          {importResult.errors.length > 0 || importResult.fatalError ? (
            <AlertCircle className="h-4 w-4" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
          <AlertTitle>
            Resultado da Importação
            {importResult.mergeMode && (
              <span className="text-xs font-normal ml-2 text-muted-foreground">
                (modo: {importResult.mergeMode === 'enrich' ? 'enriquecimento' : 'sobrescrita'})
              </span>
            )}
          </AlertTitle>
          <AlertDescription>
            <ul className="list-disc list-inside mt-2 space-y-1">
              {importResult.fatalError && (
                <li className="text-destructive">
                  <strong>Falha geral:</strong> {importResult.fatalError}
                </li>
              )}
              <li><strong>{importResult.updated}</strong> leads atualizados com sucesso</li>
              {importResult.created !== undefined && importResult.created > 0 && (
                <li className="text-primary">
                  <strong>{importResult.created}</strong> novos leads criados
                </li>
              )}
              {importResult.fieldsEnriched !== undefined && (
                <li className="text-primary">
                  <strong>{importResult.fieldsEnriched}</strong> campos enriquecidos (estavam vazios)
                </li>
              )}
              {importResult.fieldsSkipped !== undefined && importResult.fieldsSkipped > 0 && (
                <li className="text-muted-foreground">
                  <strong>{importResult.fieldsSkipped}</strong> campos ignorados (já tinham valor)
                </li>
              )}
              {importResult.unchanged !== undefined && importResult.unchanged > 0 && (
                <li className="text-muted-foreground">
                  <strong>{importResult.unchanged}</strong> leads sem alterações (já existiam e todos os campos do CSV já estavam preenchidos)
                </li>
              )}
              {importResult.skippedNoEmail !== undefined && importResult.skippedNoEmail > 0 && (
                <li className="text-muted-foreground">
                  <strong>{importResult.skippedNoEmail}</strong> linhas ignoradas (sem email)
                </li>
              )}
              {importResult.notFound > 0 && (
                <li><strong>{importResult.notFound}</strong> emails não puderam ser processados</li>
              )}
              {importResult.totalRows !== undefined && (
                <li className="text-muted-foreground border-t pt-1 mt-1">
                  Total de linhas no arquivo: <strong>{importResult.totalRows}</strong>
                  {' '}(={' '}
                  {(importResult.updated ?? 0)} atualizados +{' '}
                  {(importResult.created ?? 0)} criados +{' '}
                  {(importResult.unchanged ?? 0)} sem alterações +{' '}
                  {(importResult.notFound ?? 0)} falharam +{' '}
                  {(importResult.skippedNoEmail ?? 0)} sem email)
                </li>
              )}
              {importResult.tagName && importResult.tagApplied !== undefined && (
                <li className="text-primary">
                  Tag <strong>"{importResult.tagName}"</strong> aplicada a <strong>{importResult.tagApplied}</strong> contato(s)
                </li>
              )}
              {importResult.tagError && (
                <li className="text-destructive">
                  <strong>Erro ao aplicar tag:</strong> {importResult.tagError}
                </li>
              )}
              {importResult.errors.length > 0 && (
                <li className="text-destructive">
                  <strong>{importResult.errors.length}</strong> erros:
                  <ul className="ml-4 mt-1">
                    {importResult.errors.slice(0, 5).map((err, i) => (
                      <li key={i} className="text-sm">{err}</li>
                    ))}
                  </ul>
                </li>
              )}
              {importResult.notFoundEmails && importResult.notFoundEmails.length > 0 && (
                <li className="text-muted-foreground">
                  Emails com falha (primeiros 10):
                  <ul className="ml-4 mt-1">
                    {importResult.notFoundEmails.map((email, i) => (
                      <li key={i} className="text-sm">{email}</li>
                    ))}
                  </ul>
                </li>
              )}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Tag dialog */}
      <Dialog open={tagDialogOpen} onOpenChange={setTagDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="h-5 w-5" />
              Aplicar uma tag aos contatos importados?
            </DialogTitle>
            <DialogDescription>
              Opcional. Uma tag facilita segmentar esses contatos depois. Digite uma tag existente ou crie uma nova.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2">
            <Label htmlFor="tag-input">Tag</Label>
            <Input
              id="tag-input"
              list="existing-tags"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder="ex: importacao-jan2026"
              autoFocus
            />
            <datalist id="existing-tags">
              {existingTags.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            {existingTags.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {existingTags.length} tag(s) existente(s) — comece a digitar para ver sugestões.
              </p>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => runImport(null)} disabled={isLoading}>
              Pular
            </Button>
            <Button
              onClick={() => runImport(tagInput.trim() || null)}
              disabled={isLoading || !tagInput.trim()}
            >
              Importar com tag
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
