import { requireAdmin } from "../_shared/callerAuth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Lead {
  id: string;
  created_at: string;
  tipo: string;
  nome: string | null;
  email: string | null;
  whatsapp: string | null;
  cargo: string | null;
  empresa: string | null;
  faturamento: string | null;
  funcionarios: string | null;
  desafios: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Analise agregada de leads: apenas admin ou chamada server-to-server.
  const denied = await requireAdmin(req, corsHeaders);
  if (denied) return denied;

  try {
    const { leads } = await req.json() as { leads: Lead[] };
    
    if (!leads || leads.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Nenhum lead fornecido para análise' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      console.error('LOVABLE_API_KEY not configured');
      return new Response(
        JSON.stringify({ error: 'Configuração de IA não disponível' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Prepare leads summary for analysis
    const leadsSummary = leads.map(l => ({
      data: l.created_at,
      tipo: l.tipo,
      cargo: l.cargo || 'N/A',
      empresa: l.empresa || 'N/A',
      faturamento: l.faturamento || 'N/A',
      funcionarios: l.funcionarios || 'N/A',
      desafios: l.desafios || 'N/A'
    }));

    const systemPrompt = `Você é um analista de marketing especializado em análise de leads B2B.
Você receberá dados de leads de um formulário de cadastro para um evento sobre IA para empresas.
Sua tarefa é analisar os dados e retornar insights estruturados em JSON.

IMPORTANTE: Retorne APENAS um JSON válido, sem markdown ou texto adicional.

O JSON deve ter esta estrutura exata:
{
  "summary": "Resumo executivo de 2-3 frases sobre o perfil geral dos leads",
  "demographics": {
    "cargos": [{"name": "Cargo", "count": 10, "percentage": 25}],
    "faturamentos": [{"name": "Faixa", "count": 5, "percentage": 12}],
    "funcionarios": [{"name": "Faixa", "count": 8, "percentage": 20}]
  },
  "patterns": {
    "bestDays": ["Segunda", "Terça"],
    "bestHours": ["10h-12h", "14h-16h"],
    "conversionInsights": "Insight sobre padrões de conversão"
  },
  "challenges": {
    "mainThemes": ["Tema 1", "Tema 2"],
    "opportunities": ["Oportunidade 1", "Oportunidade 2"]
  },
  "recommendations": ["Recomendação 1", "Recomendação 2", "Recomendação 3"],
  "icp": "Descrição do perfil do cliente ideal baseado nos dados"
}`;

    const userPrompt = `Analise os seguintes ${leads.length} leads e forneça insights:

${JSON.stringify(leadsSummary, null, 2)}

Lembre-se de retornar APENAS JSON válido.`;

    console.log(`Analyzing ${leads.length} leads with Lovable AI`);

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI gateway error:', response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Limite de requisições excedido. Tente novamente em alguns minutos.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: 'Créditos de IA esgotados. Entre em contato com o suporte.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: 'Erro ao processar análise com IA' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiResponse = await response.json();
    const content = aiResponse.choices?.[0]?.message?.content;

    if (!content) {
      console.error('Empty AI response:', aiResponse);
      return new Response(
        JSON.stringify({ error: 'Resposta vazia da IA' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse AI response - handle potential markdown wrapping
    let analysis;
    try {
      let jsonContent = content.trim();
      // Remove markdown code blocks if present
      if (jsonContent.startsWith('```')) {
        jsonContent = jsonContent.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      analysis = JSON.parse(jsonContent);
    } catch (parseError) {
      console.error('Failed to parse AI response:', content);
      return new Response(
        JSON.stringify({ error: 'Erro ao interpretar resposta da IA' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Analysis completed successfully');

    return new Response(
      JSON.stringify({ analysis }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in analyze-leads:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro desconhecido' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
