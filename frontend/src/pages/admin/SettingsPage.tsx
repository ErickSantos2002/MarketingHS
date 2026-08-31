import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Plug, Bell, UserCircle, Copy, Check, Eye, EyeOff, Send, Loader2, BookOpen, Target, Key, Users, MailX, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import ApiDocumentation from '@/components/admin/settings/ApiDocumentation';
import LeadScoringSettings from '@/components/admin/settings/LeadScoringSettings';
import NexusCard from '@/components/admin/settings/NexusCard';
import ResendConfigCard from '@/components/admin/settings/ResendConfigCard';
import PingbackCard from '@/components/admin/settings/PingbackCard';
import MetaCard from '@/components/admin/settings/MetaCard';

import ApiKeysManagement from '@/components/admin/settings/ApiKeysManagement';
import UserManagement from '@/components/admin/settings/UserManagement';
import SuppressionList from '@/components/admin/settings/SuppressionList';
import SocialLinksSettings from '@/components/admin/settings/SocialLinksSettings';

const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID || '';
const BASE = `https://${projectId}.supabase.co/functions/v1`;

export default function SettingsPage() {
  const endpointUrl = `${BASE}/receive-contact-event`;
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [tokenRevealed, setTokenRevealed] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleCopy = async (value: string, field: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      toast.success('Copiado!');
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      toast.error('Erro ao copiar');
    }
  };

  const handleTestWebhook = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(endpointUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer TEST_TOKEN' },
        body: JSON.stringify({ source_app: 'dnmarketing', event_type: 'test', title: 'Evento de teste', description: 'Testando conexão do webhook', email: 'teste@teste.com' }),
      });
      if (res.status === 401) {
        setTestResult({ ok: true, message: 'Endpoint acessível! (token de teste rejeitado como esperado)' });
      } else if (res.ok) {
        setTestResult({ ok: true, message: 'Evento de teste enviado com sucesso!' });
      } else {
        const data = await res.json().catch(() => ({}));
        setTestResult({ ok: false, message: `Erro ${res.status}: ${data.error || 'Falha desconhecida'}` });
      }
    } catch {
      setTestResult({ ok: false, message: 'Não foi possível conectar ao endpoint' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Configurações</h1>

      <Tabs defaultValue="integrations">
        <TabsList className="h-9">
          <TabsTrigger value="integrations" className="text-xs gap-1.5">
            <Plug className="h-3.5 w-3.5" /> Integrações
          </TabsTrigger>
          <TabsTrigger value="docs" className="text-xs gap-1.5">
            <BookOpen className="h-3.5 w-3.5" /> Documentação da API
          </TabsTrigger>
          <TabsTrigger value="scoring" className="text-xs gap-1.5">
            <Target className="h-3.5 w-3.5" /> Lead Scoring
          </TabsTrigger>
          <TabsTrigger value="apikeys" className="text-xs gap-1.5">
            <Key className="h-3.5 w-3.5" /> API Keys
          </TabsTrigger>
          <TabsTrigger value="users" className="text-xs gap-1.5">
            <Users className="h-3.5 w-3.5" /> Usuários
          </TabsTrigger>
          <TabsTrigger value="suppression" className="text-xs gap-1.5">
            <MailX className="h-3.5 w-3.5" /> Supressão de Email
          </TabsTrigger>
          <TabsTrigger value="social" className="text-xs gap-1.5">
            <Share2 className="h-3.5 w-3.5" /> Redes sociais
          </TabsTrigger>
        </TabsList>

        <TabsContent value="integrations" className="mt-4">
          <div className="grid gap-4">
            {/* Webhook Card */}
            <Card className="border-border/40">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <Plug className="h-6 w-6 text-primary" />
                  <div>
                    <CardTitle className="text-base">Webhook de eventos</CardTitle>
                    <CardDescription className="text-xs mt-0.5">Use este endpoint para enviar eventos de outras plataformas para a timeline dos contatos</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-xs text-muted-foreground font-medium mb-1.5 block">URL do endpoint</label>
                  <div className="flex gap-2">
                    <Input readOnly value={endpointUrl} className="text-xs font-mono bg-muted/30" />
                    <Button variant="outline" size="sm" className="flex-shrink-0" onClick={() => handleCopy(endpointUrl, 'url')}>
                      {copiedField === 'url' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground font-medium mb-1.5 block">Token de autenticação</label>
                  <div className="flex gap-2">
                    <Input readOnly type={tokenRevealed ? 'text' : 'password'} value="Configure WEBHOOK_SECRET no Supabase Secrets" className="text-xs font-mono bg-muted/30" />
                    <Button variant="outline" size="sm" className="flex-shrink-0" onClick={() => setTokenRevealed(!tokenRevealed)}>
                      {tokenRevealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Envie como header: <code className="bg-muted/50 px-1 py-0.5 rounded">Authorization: Bearer SEU_TOKEN</code>
                  </p>
                </div>
                <div className="pt-2 border-t border-border/30">
                  <div className="flex items-center gap-3">
                    <Button variant="outline" size="sm" onClick={handleTestWebhook} disabled={testing} className="gap-1.5">
                      {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      {testing ? 'Testando...' : 'Enviar evento de teste'}
                    </Button>
                    {testResult && (
                      <span className={`text-xs ${testResult.ok ? 'text-emerald-500' : 'text-red-500'}`}>{testResult.message}</span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Nexus Card */}
            <NexusCard />

            {/* Resend Card */}
            <ResendConfigCard />

            {/* Pingback Card */}
            <PingbackCard />

            {/* Meta Card */}
            <MetaCard />



            {/* Mentoria Card */}
            <Card className="border-border/40">
              <CardHeader className="flex flex-row items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-md flex items-center justify-center text-white font-bold text-sm" style={{ backgroundColor: '#0F6E56' }}>M</div>
                  <div>
                    <CardTitle className="text-base">mentor.ia</CardTitle>
                    <CardDescription className="text-xs">Gestão de mentorias</CardDescription>
                  </div>
                </div>
              </CardHeader>
            </Card>

            {/* Notifications */}
            <Card className="border-border/40">
              <CardHeader className="flex flex-row items-center gap-3">
                <Bell className="h-6 w-6 text-muted-foreground" />
                <div>
                  <CardTitle className="text-base">Notificações</CardTitle>
                  <CardDescription className="text-xs">Em construção</CardDescription>
                </div>
              </CardHeader>
            </Card>

            {/* Account */}
            <Card className="border-border/40">
              <CardHeader className="flex flex-row items-center gap-3">
                <UserCircle className="h-6 w-6 text-muted-foreground" />
                <div>
                  <CardTitle className="text-base">Conta</CardTitle>
                  <CardDescription className="text-xs">Em construção</CardDescription>
                </div>
              </CardHeader>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="docs" className="mt-4">
          <ApiDocumentation />
        </TabsContent>

        <TabsContent value="scoring" className="mt-4">
          <LeadScoringSettings />
        </TabsContent>

        <TabsContent value="apikeys" className="mt-4">
          <ApiKeysManagement />
        </TabsContent>

        <TabsContent value="users" className="mt-4">
          <UserManagement />
        </TabsContent>

        <TabsContent value="suppression" className="mt-4">
          <SuppressionList />
        </TabsContent>

        <TabsContent value="social" className="mt-4">
          <SocialLinksSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
