import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Copy, Save, Cloud, Globe, ShieldAlert, ShieldCheck, Code2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { abCollectorUrl, domainOf, isHostInDomain, normalizeProductionDomain } from "@/lib/abConfig";
import { useAbConfig } from "@/hooks/useAbConfig";

// ⚠️ Era a URL das Edge Functions do Supabase da dn.ia. Agora é a nossa API.
// VITE_API_URL é resolvida em BUILD TIME — trocar a variável no servidor sem
// rebuildar não muda o que está escrito aqui na tela.
const API_URL = import.meta.env.VITE_API_URL ?? `${window.location.origin}/api`;

// Código exato do Cloudflare Worker. As linhas de `target` usam template
// literals — por isso os crases e ${...} estão escapados aqui dentro.
const WORKER_CODE = `// Cloudflare Worker do Teste A/B — ligado ao Custom Domain do redirecionador
//   https://<redirecionador>/{slug}  -> ${API_URL}/publico/ab/go/{slug}
//   https://<redirecionador>/e       -> ${API_URL}/publico/ab/eventos

const API = '${API_URL}';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    // M4: com barra final (go.<dom>/slug/) o Starlette responde 307 para o
    // host da API e o cookie de domínio se perde — tira a barra final antes
    // de montar o target, exceto quando o path é só '/'.
    let path = url.pathname;
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    let target;

    if (path === '/e') {
      target = \`\${API}/publico/ab/eventos\${url.search}\`;
    } else if (path === '' || path === '/') {
      target = \`\${API}/publico/ab/go\${url.search}\`;
    } else {
      target = \`\${API}/publico/ab/go\${path}\${url.search}\`;
    }

    const proxied = new Request(target, request);
    // O backend limita requisições por IP. Sem isto, todo visitante chegaria
    // com o IP do Cloudflare e dividiria o mesmo limite.
    const ip = request.headers.get('CF-Connecting-IP');
    if (ip) proxied.headers.set('X-Forwarded-For', ip);

    // redirect:'manual' => o 302 do redirecionador vai INTACTO para o navegador.
    const resp = await fetch(proxied, { redirect: 'manual' });
    return new Response(resp.body, resp);
  },
};`;

function copy(text: string, label: string) {
  navigator.clipboard.writeText(text);
  toast.success(`${label} copiado`);
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        className="absolute right-2 top-2 h-7"
        onClick={() => copy(code, label)}
      >
        <Copy className="h-3 w-3 mr-1" /> Copiar
      </Button>
      <pre className="bg-muted/50 rounded-lg p-4 pr-24 overflow-x-auto text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[--tint-primary] text-[--on-tint-primary] text-xs font-semibold flex items-center justify-center">
        {n}
      </span>
      <div className="flex-1 pt-0.5 text-sm">{children}</div>
    </li>
  );
}

export default function ExperimentsSetup() {
  const navigate = useNavigate();
  const abConfig = useAbConfig();
  const [base, setBase] = useState("");
  const [prodDomain, setProdDomain] = useState("");
  // M6: preenche os campos a partir do banco só na PRIMEIRA carga. Sem o
  // `inicializado`, este efeito reagia a QUALQUER mudança em productionDomain
  // OU redirectorBase — e salvar um dos dois reescrevia o outro por cima do
  // que a pessoa tinha digitado e ainda não salvo (o campo "esvaziava").
  // Depois da carga inicial, cada campo só se atualiza pelo PRÓPRIO save
  // (`salvarDominio` / `save`, abaixo).
  const inicializado = useRef(false);
  useEffect(() => {
    if (!abConfig.loading && !inicializado.current) {
      setProdDomain(abConfig.productionDomain);
      setBase(abConfig.redirectorBase ?? "");
      inicializado.current = true;
    }
  }, [abConfig.loading, abConfig.productionDomain, abConfig.redirectorBase]);
  const cleanBase = base.trim().replace(/\/+$/, "");
  const collector = abCollectorUrl(cleanBase || null) || "<configure o redirecionador>";
  const prodNormalized = normalizeProductionDomain(abConfig.productionDomain);
  // Exemplos nos textos: o domínio de verdade quando configurado.
  const exemploDominio = prodNormalized || "exemplo.com.br";
  const exemploRedirecionador = domainOf(cleanBase) || `go.${exemploDominio}`;
  const snippet = `<script src="${window.location.origin}/ab.js" async data-endpoint="${collector}" data-cookie-domain=".${exemploDominio}"></script>`;

  // O redirecionador tem de ser o próprio domínio de produção ou um subdomínio
  // dele — senão o cookie não gruda e o anúncio vira cross-domain redirect
  // (reprovação "Destination mismatch").
  const redirectorHost = domainOf(cleanBase);
  const redirectorOk = !!redirectorHost && isHostInDomain(redirectorHost, abConfig.productionDomain);
  const showRedirectorWarning = !abConfig.loading && !!prodNormalized && !redirectorOk;

  const save = async () => {
    if (!abConfig.loading && prodNormalized) {
      if (!redirectorHost) {
        toast.error("URL base inválida — use o endereço completo (https://…).");
        return;
      }
      if (!redirectorOk) {
        toast.error(
          `O redirecionador (${redirectorHost}) precisa estar no domínio de produção (${prodNormalized}). ` +
          `Ajuste aqui ou o domínio de produção acima.`,
        );
        return;
      }
    }
    // M6: só o campo salvo é atualizado — `prodDomain` não é tocado aqui.
    if (await abConfig.saveRedirector(cleanBase)) setBase(cleanBase);
  };

  const salvarDominio = async () => {
    const salvo = await abConfig.save(prodDomain);
    // M6: só o campo salvo é atualizado — `base` não é tocado aqui.
    if (salvo) setProdDomain(salvo);
  };

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/experiments")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <p className="text-sm text-muted-foreground">
            Como a infraestrutura do A/B está montada e como configurá-la.
          </p>
        </div>
      </div>

      {/* 1) Domínio de produção — base da validação de tudo o mais */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Domínio de produção (validação das variantes)</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Domínio oficial das landing pages — a <strong>referência</strong> contra a qual tudo é
          validado. Ao criar um teste, toda URL de variante é conferida contra ele: o destino precisa
          estar neste domínio (ou num subdomínio dele). Isso impede que um anúncio no Google/Meta caia
          em <strong>cross-domain redirect</strong> — a principal causa de reprovação por
          <em> Destination mismatch</em>. Compartilhado por todo o time (salvo no banco).
        </p>
        <div className="flex items-end gap-3 flex-wrap">
          <div className="flex-1 min-w-[260px]">
            <Label className="text-xs">Domínio</Label>
            <Input
              value={prodDomain}
              onChange={(e) => setProdDomain(e.target.value)}
              placeholder="exemplo.com.br"
              disabled={abConfig.loading}
            />
          </div>
          <Button onClick={salvarDominio} disabled={abConfig.saving || abConfig.loading}>
            <Save className="h-4 w-4 mr-2" /> Salvar
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Ex.: <code>{exemploDominio}</code> aceita <code>{exemploDominio}/lp</code> e{" "}
          <code>promo.{exemploDominio}</code>, mas rejeita <code>outro.com</code>. Não inclua{" "}
          <code>https://</code> nem caminho.
        </p>
      </Card>

      {/* 2) Domínio do redirecionador — tem de ser subdomínio do de produção */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Domínio do redirecionador</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          É o Custom Domain do Cloudflare Worker. Monta o Link de Distribuição de cada teste e o
          endpoint do coletor. Salvo no banco, compartilhado pelo time. Precisa ser o <strong>domínio
          de produção ou um subdomínio dele</strong> (ex.: <code>{exemploRedirecionador}</code> para uma
          produção em <code>{exemploDominio}</code>) — senão o cookie <code>.{exemploDominio}</code> não
          gruda e o anúncio vira cross-domain redirect. Se trocar o subdomínio de fato, atualize também
          o Custom Domain no Cloudflare e o
          <code> data-endpoint</code> do snippet.
        </p>
        <div className="flex items-end gap-3 flex-wrap">
          <div className="flex-1 min-w-[260px]">
            <Label className="text-xs">URL base</Label>
            <Input value={base} onChange={(e) => setBase(e.target.value)} placeholder={`https://${exemploRedirecionador}`} />
          </div>
          <Button onClick={save} disabled={abConfig.saving || abConfig.loading}>
            <Save className="h-4 w-4 mr-2" /> Salvar
          </Button>
        </div>
        {showRedirectorWarning && (
          <p className="text-xs text-[--on-tint-warning] flex items-start gap-1.5">
            <ShieldAlert className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-warning" />
            <span>
              Fora do domínio de produção (<code>{prodNormalized}</code>). O redirecionador precisa ser
              esse domínio ou um subdomínio dele — salvar está bloqueado até ajustar aqui ou o domínio
              de produção acima.
            </span>
          </p>
        )}
        <Separator />
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-xs text-muted-foreground mb-1">Link de Distribuição</div>
            <code className="font-mono text-xs break-all">{cleanBase}/{"{slug}"}</code>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Coletor de eventos</div>
            <code className="font-mono text-xs break-all">{collector}</code>
          </div>
        </div>
      </Card>

      {/* Por que um subdomínio dedicado */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-warning" />
          <h2 className="font-semibold">Por que um subdomínio dedicado ({exemploRedirecionador})</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          O redirecionador precisa estar sob o domínio de produção (ex.: <code>{exemploRedirecionador}</code>{" "}
          para uma produção em <code>{exemploDominio}</code>) para o cookie <code>.{exemploDominio}</code>{" "}
          ser same-site — cookie de outro domínio não é lido pela landing page, e o anúncio vira
          cross-domain redirect.
        </p>
      </Card>

      {/* Cloudflare Worker */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Cloud className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Cloudflare — Worker <Badge variant="secondary" className="ml-1">ab-router</Badge></h2>
        </div>
        <ol className="space-y-3">
          <Step n={1}>
            Conta Cloudflare → <strong>Compute → Workers &amp; Pages</strong> → <strong>Create
            application → Create Worker</strong>. Nome: <code>ab-router</code> → <strong>Deploy</strong>.
          </Step>
          <Step n={2}>
            <strong>Edit code</strong> → cole o código abaixo (o editor é um iframe cross-origin, então
            é preciso colar manualmente com Ctrl+V) → <strong>Deploy</strong>.
          </Step>
        </ol>
        <CodeBlock code={WORKER_CODE} label="Código do worker" />
      </Card>

      {/* Custom Domain */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Cloudflare — Custom Domain</h2>
        </div>
        <ol className="space-y-3">
          <Step n={1}>
            No worker <code>ab-router</code> → aba <strong>Domains</strong> → <strong>Add Domain</strong>.
          </Step>
          <Step n={2}>
            Selecione a zona do domínio de produção (ex.: <code>{exemploDominio}</code>), subdomínio
            dedicado ao redirecionador (ex.: <code>go</code>) → <strong>Add domain</strong>. O Cloudflare
            cria o registro DNS proxiado e o certificado automaticamente.
          </Step>
          <Step n={3}>
            Resultado: <code>{exemploRedirecionador}</code> → Production. Todo o tráfego desse domínio
            vai ao worker.
          </Step>
        </ol>
      </Card>

      {/* Rate Limiting */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Cloudflare — Rate Limiting</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Zona do domínio de produção (<code>{exemploDominio}</code>) → <strong>Security → Security
          rules → Create rule → Rate limiting rules</strong>. Configuração usada:
        </p>
        <ul className="text-sm space-y-1 list-disc pl-5 text-muted-foreground">
          <li>Expressão: <code>{`(http.host eq "${exemploRedirecionador}" and http.request.uri.path eq "/e")`}</code></li>
          <li>Características: <strong>IP</strong> · Taxa: <strong>50 req / 10 s</strong></li>
          <li>Ação: <strong>Block</strong> por <strong>10 s</strong> · Status: <strong>Active</strong></li>
        </ul>
      </Card>

      {/* Snippet */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Code2 className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Snippet nas landing pages ({exemploDominio})</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Cole 1 linha no <code>&lt;head&gt;</code> de cada landing do teste. O script lê a atribuição
          da URL, grava o cookie <code>.{exemploDominio}</code>, dispara exposição/comportamento, injeta
          os campos ocultos nos formulários e reescreve o iframe do agendamento (quando configurado).
        </p>
        <CodeBlock code={snippet} label="Snippet" />
        <p className="text-xs text-muted-foreground">
          Marque CTAs com <code>data-ab-cta="nome"</code> para cliques nomeados. Para exigir
          consentimento LGPD, adicione <code>data-require-consent="true"</code>. Para levar o teste até
          um agendamento em iframe, acrescente <code>data-iframe-match="&lt;trecho da URL do iframe&gt;"</code>{" "}
          ao script.
        </p>
      </Card>

    </div>
  );
}
