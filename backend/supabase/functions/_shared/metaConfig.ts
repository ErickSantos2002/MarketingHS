// Meta (Conversions API) credentials loader. Reads from the `meta_config`
// table via service-role client, with fallback to Deno.env for backward
// compatibility. Same pattern as _shared/nexusConfig.ts.
import { createClient } from 'npm:@supabase/supabase-js@2';

export type MetaCredentials = {
  pixelId: string | null;
  accessToken: string | null;
  testEventCode: string | null;
  source: 'db' | 'env' | 'mixed' | 'none';
};

let cached: { creds: MetaCredentials; at: number } | null = null;
const TTL_MS = 30_000;

export async function getMetaCredentials(force = false): Promise<MetaCredentials> {
  if (!force && cached && Date.now() - cached.at < TTL_MS) {
    return cached.creds;
  }

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  const envPixelId = Deno.env.get('META_PIXEL_ID') ?? null;
  const envAccessToken = Deno.env.get('META_ACCESS_TOKEN') ?? null;
  const envTestEventCode = Deno.env.get('META_TEST_EVENT_CODE') ?? null;

  let dbPixelId: string | null = null;
  let dbAccessToken: string | null = null;
  let dbTestEventCode: string | null = null;

  if (url && serviceKey) {
    try {
      const admin = createClient(url, serviceKey);
      const { data, error } = await admin
        .from('meta_config')
        .select('pixel_id, access_token, test_event_code')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!error && data) {
        dbPixelId = (data.pixel_id ?? '').toString().trim() || null;
        dbAccessToken = (data.access_token ?? '').toString().trim() || null;
        dbTestEventCode = (data.test_event_code ?? '').toString().trim() || null;
      }
    } catch (e) {
      console.warn('getMetaCredentials: failed to read meta_config', e);
    }
  }

  const pixelId = dbPixelId ?? envPixelId;
  const accessToken = dbAccessToken ?? envAccessToken;
  const testEventCode = dbTestEventCode ?? envTestEventCode;

  let source: MetaCredentials['source'];
  if (dbPixelId && dbAccessToken) source = 'db';
  else if (!dbPixelId && !dbAccessToken) source = pixelId || accessToken ? 'env' : 'none';
  else source = 'mixed';

  const creds: MetaCredentials = { pixelId, accessToken, testEventCode, source };
  cached = { creds, at: Date.now() };
  return creds;
}

export function invalidateMetaCredentialsCache() {
  cached = null;
}
