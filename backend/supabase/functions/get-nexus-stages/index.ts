import { getNexusCredentials } from '../_shared/nexusConfig.ts';
import { requireAdmin } from '../_shared/callerAuth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Expoe estrutura interna do CRM: apenas admin ou server-to-server.
  const denied = await requireAdmin(req, corsHeaders);
  if (denied) return denied;

  try {
    const { apiKey: nexusApiKey, workspaceId: nexusWorkspaceId, baseUrl: nexusBaseUrl } = await getNexusCredentials(true);

    if (!nexusApiKey || !nexusWorkspaceId) {
      console.error('Missing credentials - API_KEY:', !!nexusApiKey, 'WORKSPACE_ID:', !!nexusWorkspaceId);
      return new Response(
        JSON.stringify({ error: 'Nexus credentials not configured', stages: [] }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const url = `${nexusBaseUrl}/crm/pipeline/stages`;
    console.log('Fetching:', url);

    const res = await fetch(url, {
      headers: {
        'X-API-Key': nexusApiKey,
        'X-Workspace-Id': nexusWorkspaceId,
      },
    });

    const rawText = await res.text();
    console.log('Nexus status:', res.status);
    console.log('Nexus response:', rawText.slice(0, 500));

    if (!res.ok) {
      console.error('Nexus fetch failed:', res.status, rawText.slice(0, 300));
      return new Response(
        JSON.stringify({ error: 'Nexus returned error', status: res.status, raw: rawText.slice(0, 500), stages: [] }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      console.error('Nexus returned non-JSON:', contentType, rawText.slice(0, 300));
      return new Response(
        JSON.stringify({ error: 'Nexus returned invalid response', status: res.status, raw: rawText.slice(0, 500), stages: [] }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      return new Response(
        JSON.stringify({ error: 'Failed to parse JSON', raw: rawText.slice(0, 500), stages: [] }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const raw = data.data || data.stages || data || [];
    const stages = Array.isArray(raw)
      ? raw
          .filter((s: any) => !s.is_won && !s.is_lost)
          .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))
      : [];

    return new Response(
      JSON.stringify({ stages }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('get-nexus-stages error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal error', message: String(error), stages: [] }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
