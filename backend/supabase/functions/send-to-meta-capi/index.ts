import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getMetaCredentials } from "../_shared/metaConfig.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Meta Conversions API endpoint
const META_API_VERSION = 'v18.0';

// Hash function for user data (Meta requires SHA256 hashing)
async function hashData(data: string): Promise<string> {
  if (!data) return '';
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data.toLowerCase().trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Normalize phone number (remove non-digits, add country code if missing)
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  // Add Brazil country code if not present
  if (digits.length === 10 || digits.length === 11) {
    return '55' + digits;
  }
  return digits;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Credenciais: tabela meta_config (aba Integrações) → fallback env
    const metaCreds = await getMetaCredentials();
    const META_ACCESS_TOKEN = metaCreds.accessToken;
    const META_PIXEL_ID = metaCreds.pixelId;

    if (!META_ACCESS_TOKEN || !META_PIXEL_ID) {
      console.error('Missing Meta credentials (meta_config/env)');
      return new Response(
        JSON.stringify({ error: 'Missing Meta configuration' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const payload = await req.json();
    console.log('Received payload for Meta CAPI:', JSON.stringify(payload));

    const {
      event_name = 'Lead',
      email,
      phone,
      first_name,
      last_name,
      client_ip_address,
      client_user_agent,
      event_source_url,
      fbc, // Facebook click ID (from _fbc cookie)
      fbp, // Facebook browser ID (from _fbp cookie)
      external_id, // Your own user ID
      event_id, // Shared ID for Pixel + CAPI deduplication
      custom_data = {}
    } = payload;

    // Hash user data as required by Meta
    const hashedEmail = email ? await hashData(email) : undefined;
    const hashedPhone = phone ? await hashData(normalizePhone(phone)) : undefined;
    const hashedFirstName = first_name ? await hashData(first_name) : undefined;
    const hashedLastName = last_name ? await hashData(last_name) : undefined;
    const hashedExternalId = external_id ? await hashData(external_id) : undefined;

    // Build user_data object (only include fields that have values)
    const user_data: Record<string, any> = {};
    if (hashedEmail) user_data.em = [hashedEmail];
    if (hashedPhone) user_data.ph = [hashedPhone];
    if (hashedFirstName) user_data.fn = hashedFirstName;
    if (hashedLastName) user_data.ln = hashedLastName;
    if (hashedExternalId) user_data.external_id = [hashedExternalId];
    if (client_ip_address) user_data.client_ip_address = client_ip_address;
    if (client_user_agent) user_data.client_user_agent = client_user_agent;
    if (fbc) user_data.fbc = fbc;
    if (fbp) user_data.fbp = fbp;

    // Build the event
    const eventPayload = {
      event_name,
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'website',
      event_source_url,
      user_data,
      custom_data,
      ...(event_id ? { event_id } : {}),
    };

    const eventData = {
      data: [eventPayload],
      ...(metaCreds.testEventCode ? { test_event_code: metaCreds.testEventCode } : {}),
    };

    console.log('Sending to Meta CAPI:', JSON.stringify(eventData));

    // Send to Meta Conversions API
    const metaResponse = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${META_PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(eventData),
      }
    );

    const metaResult = await metaResponse.json();
    console.log('Meta CAPI response:', JSON.stringify(metaResult));

    if (!metaResponse.ok) {
      console.error('Meta CAPI error:', metaResult);
      return new Response(
        JSON.stringify({ error: 'Meta CAPI request failed', details: metaResult }),
        { status: metaResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, meta_response: metaResult }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in send-to-meta-capi:', error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
