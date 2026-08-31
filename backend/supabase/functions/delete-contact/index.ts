import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { getNexusCredentials } from "../_shared/nexusConfig.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify user is admin
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: roleData } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleData) {
      return new Response(JSON.stringify({ error: "Admin role required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse body
    const { lead_id } = await req.json();
    if (!lead_id) {
      return new Response(JSON.stringify({ error: "lead_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch lead
    const { data: lead, error: leadErr } = await adminClient
      .from("leads")
      .select("id, dnia_id, email, whatsapp")
      .eq("id", lead_id)
      .maybeSingle();

    if (leadErr || !lead) {
      return new Response(JSON.stringify({ error: "Lead not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check ecosystem identity for Nexus
    let nexusContactId: string | null = null;
    let dniaId: string | null = lead.dnia_id;

    if (dniaId) {
      const { data: identity } = await adminClient
        .from("ecosystem_identities")
        .select("nexus_contact_id")
        .eq("dnia_id", dniaId)
        .maybeSingle();

      if (identity?.nexus_contact_id) {
        nexusContactId = identity.nexus_contact_id;
      }
    }

    // If linked to Nexus, delete there first
    if (nexusContactId) {
      const { apiKey: nexusApiKey, workspaceId: nexusWorkspaceId, baseUrl: nexusBaseUrl } = await getNexusCredentials();

      if (nexusBaseUrl && nexusApiKey && nexusWorkspaceId) {
        const nexusRes = await fetch(
          `${nexusBaseUrl}/crm/contacts/${nexusContactId}`,
          {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": nexusApiKey,
              "x-workspace-id": nexusWorkspaceId,
            },
          }
        );

        if (!nexusRes.ok && nexusRes.status !== 404) {
          const body = await nexusRes.text();
          console.error("Nexus delete failed:", nexusRes.status, body);
          return new Response(
            JSON.stringify({ error: `Falha ao apagar no Nexus: ${nexusRes.status}` }),
            {
              status: 502,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
        // Consume body if 404 (already deleted)
        if (nexusRes.status === 404) await nexusRes.text();
      }
    }

    // Soft delete: mark the lead as deleted, keeping all related records intact for auditability
    const { error: delErr } = await adminClient
      .from("leads")
      .update({ deleted_at: new Date().toISOString(), deleted_by: user.id })
      .eq("id", lead_id);
    if (delErr) {
      console.error("Soft delete lead error:", delErr);
      return new Response(JSON.stringify({ error: delErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Audit trail event
    await adminClient.from("contact_events").insert({
      lead_id,
      dnia_id: dniaId,
      source_app: "dnmarketing",
      event_type: "contact_soft_deleted",
      title: "Contato excluído (soft delete)",
      metadata: { deleted_by: user.id, nexus_deleted: !!nexusContactId },
    });

    return new Response(
      JSON.stringify({ success: true, nexus_deleted: !!nexusContactId }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("delete-contact error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
