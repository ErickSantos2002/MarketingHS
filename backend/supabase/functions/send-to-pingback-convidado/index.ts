import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { resolvePingbackUrl, validatePingbackPayload, payloadTooLarge } from "../_shared/pingback.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  if (payloadTooLarge(req)) {
    return new Response(JSON.stringify({ error: 'Payload too large' }), {
      status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    const raw = await req.json();
    const validation = validatePingbackPayload(raw);
    if (!validation.ok) {
      return new Response(JSON.stringify({ error: validation.error }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const pingbackResponse = await fetch(await resolvePingbackUrl("convidado"), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validation.data),
    });

    if (!pingbackResponse.ok) {
      console.error("Pingback convidado webhook failed:", pingbackResponse.status);
      return new Response(
        JSON.stringify({ error: 'Pingback webhook failed' }),
        { status: pingbackResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error: unknown) {
    console.error("send-to-pingback-convidado error:", error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
