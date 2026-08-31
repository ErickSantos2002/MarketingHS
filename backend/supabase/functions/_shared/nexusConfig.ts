// Nexus credentials loader. Reads from the `nexus_config` table via
// service-role client, with fallback to Deno.env for backward compatibility.
import { createClient } from 'npm:@supabase/supabase-js@2';

const DEFAULT_BASE_URL = 'https://apbvnbubxyaihygnxdev.supabase.co/functions/v1/api-gateway';

export type NexusCredentials = {
  apiKey: string | null;
  workspaceId: string | null;
  baseUrl: string;
  source: 'db' | 'env' | 'mixed';
};

let cached: { creds: NexusCredentials; at: number } | null = null;
const TTL_MS = 30_000;

export async function getNexusCredentials(force = false): Promise<NexusCredentials> {
  if (!force && cached && Date.now() - cached.at < TTL_MS) {
    return cached.creds;
  }

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  const envApiKey = Deno.env.get('NEXUS_API_KEY') ?? null;
  const envWorkspaceId = Deno.env.get('NEXUS_WORKSPACE_ID') ?? null;
  const envBaseUrl = Deno.env.get('NEXUS_BASE_URL') || null;

  let dbApiKey: string | null = null;
  let dbWorkspaceId: string | null = null;
  let dbBaseUrl: string | null = null;

  if (url && serviceKey) {
    try {
      const admin = createClient(url, serviceKey);
      const { data, error } = await admin
        .from('nexus_config')
        .select('api_key, workspace_id, base_url')
        .limit(1)
        .maybeSingle();
      if (!error && data) {
        dbApiKey = (data.api_key ?? '').toString().trim() || null;
        dbWorkspaceId = (data.workspace_id ?? '').toString().trim() || null;
        dbBaseUrl = (data.base_url ?? '').toString().trim() || null;
      }
    } catch (e) {
      console.warn('getNexusCredentials: failed to read nexus_config', e);
    }
  }

  const apiKey = dbApiKey ?? envApiKey;
  const workspaceId = dbWorkspaceId ?? envWorkspaceId;
  const baseUrl = dbBaseUrl ?? envBaseUrl ?? DEFAULT_BASE_URL;
  const source: NexusCredentials['source'] =
    dbApiKey && dbWorkspaceId ? 'db' : (!dbApiKey && !dbWorkspaceId ? 'env' : 'mixed');

  const creds: NexusCredentials = { apiKey, workspaceId, baseUrl, source };
  cached = { creds, at: Date.now() };
  return creds;
}

export function invalidateNexusCredentialsCache() {
  cached = null;
}
