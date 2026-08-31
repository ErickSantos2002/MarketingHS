import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireAdmin } from "../_shared/callerAuth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ChallengeData {
  desafio: string | null;
  cargo: string | null;
  faturamento: string | null;
  empresa: string | null;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Dados de leads (desafios/cargo/faturamento): apenas admin ou server-to-server.
  const denied = await requireAdmin(req, corsHeaders);
  if (denied) return denied;

  try {
    const { challenges } = await req.json() as { challenges: ChallengeData[] };

    if (!challenges || challenges.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No challenges provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    // Prepare challenges summary for AI
    const challengesSummary = challenges
      .filter(c => c.desafio && c.desafio.trim())
      .map(c => `- "${c.desafio}" (Cargo: ${c.cargo || 'N/A'}, Faturamento: ${c.faturamento || 'N/A'})`)
      .join('\n');

    const systemPrompt = `Você é um analista de marketing especializado em análise de dados de leads B2B. 
Analise os desafios reportados pelos leads e forneça insights acionáveis.

Responda SEMPRE em português brasileiro.
Seja específico e prático nas recomendações.
Foque em padrões que possam ser usados para melhorar campanhas de marketing e vendas.`;

    const userPrompt = `Analise os seguintes desafios reportados por ${challenges.length} leads:

${challengesSummary}

Forneça a análise usando a ferramenta analyze_challenges.`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'analyze_challenges',
              description: 'Retorna a análise estruturada dos desafios dos leads',
              parameters: {
                type: 'object',
                properties: {
                  patterns: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '3-5 padrões principais identificados nos desafios'
                  },
                  copyRecommendations: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '3-5 sugestões de copy para anúncios baseadas nos desafios'
                  },
                  contentSuggestions: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '3-5 ideias de conteúdo (posts, vídeos, artigos) baseadas nos desafios'
                  },
                  gems: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        response: { type: 'string', description: 'Trecho da resposta destacada' },
                        reason: { type: 'string', description: 'Por que essa resposta é valiosa' }
                      },
                      required: ['response', 'reason']
                    },
                    description: '2-3 respostas excepcionais que revelam insights únicos'
                  },
                  opportunities: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '3-5 oportunidades de produto/serviço identificadas'
                  }
                },
                required: ['patterns', 'copyRecommendations', 'contentSuggestions', 'gems', 'opportunities'],
                additionalProperties: false
              }
            }
          }
        ],
        tool_choice: { type: 'function', function: { name: 'analyze_challenges' } }
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: 'Payment required. Please add credits to your account.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const errorText = await response.text();
      console.error('AI gateway error:', response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const aiResponse = await response.json();
    console.log('AI Response:', JSON.stringify(aiResponse, null, 2));

    // Extract the function call result
    const toolCall = aiResponse.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.function.name !== 'analyze_challenges') {
      throw new Error('Invalid AI response format');
    }

    const insights = JSON.parse(toolCall.function.arguments);

    return new Response(
      JSON.stringify(insights),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in analyze-challenges:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
