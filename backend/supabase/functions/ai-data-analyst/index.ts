import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

interface ConversationContext {
  date: string;
  summary: string;
}

// Generate current date/time context in Brasília timezone
function getTemporalContext() {
  const now = new Date();
  
  const brasiliaFormatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'full',
    timeStyle: 'long'
  });
  
  const brasiliaTime = brasiliaFormatter.format(now);
  
  // Get date in YYYY-MM-DD format for SQL
  const brasiliaDateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
  
  // Calculate yesterday
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(yesterday);
  
  return { brasiliaTime, brasiliaDate: brasiliaDateParts, yesterdayDate };
}

// Fetch previous conversation summaries for context
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchConversationHistory(
  supabaseClient: any, 
  userId: string, 
  currentConversationId: string
): Promise<ConversationContext[]> {
  try {
    // Get last 3 conversations (excluding current)
    const { data: conversations, error: convError } = await supabaseClient
      .from('ai_chat_conversations')
      .select('id, title, updated_at')
      .eq('user_id', userId)
      .neq('id', currentConversationId)
      .order('updated_at', { ascending: false })
      .limit(3);

    if (convError || !conversations || conversations.length === 0) {
      return [];
    }

    const contextSummaries: ConversationContext[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const conv of conversations as any[]) {
      // Get last few messages from each conversation
      const { data: messages, error: msgError } = await supabaseClient
        .from('ai_chat_messages')
        .select('role, content, created_at')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: false })
        .limit(6);

      if (!msgError && messages && messages.length > 0) {
        // Create a brief summary of the conversation
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const userQuestions = (messages as any[])
          .filter((m) => m.role === 'user')
          .map((m) => m.content.slice(0, 100))
          .slice(0, 2);
        
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const lastAssistantResponse = (messages as any[]).find((m) => m.role === 'assistant');
        
        if (userQuestions.length > 0) {
          const summary = `Perguntas: ${userQuestions.join('; ')}${lastAssistantResponse ? `. Última resposta: ${lastAssistantResponse.content.slice(0, 150)}...` : ''}`;
          
          contextSummaries.push({
            date: new Date(conv.updated_at).toLocaleDateString('pt-BR'),
            summary,
          });
        }
      }
    }

    return contextSummaries;
  } catch (error) {
    console.error('Error fetching conversation history:', error);
    return [];
  }
}

function buildSystemPrompt(conversationHistory: ConversationContext[] = []) {
  const { brasiliaTime, brasiliaDate, yesterdayDate } = getTemporalContext();
  
  let historyContext = '';
  
  if (conversationHistory.length > 0) {
    historyContext = `
=== MEMÓRIA DE CONVERSAS ANTERIORES ===
Você tem acesso ao histórico recente de análises do usuário. Use isso para fazer comparações quando relevante:

${conversationHistory.map((ctx) => `**Conversa de ${ctx.date}:**
${ctx.summary}`).join('\n\n')}

Use este contexto para enriquecer suas respostas. Por exemplo:
- Se o usuário perguntou sobre leads ontem e hoje, compare os números
- Mencione tendências baseadas em análises anteriores
- Lembre o usuário de insights relevantes de conversas passadas
=== FIM DA MEMÓRIA ===

`;
  }
  
  return `Você é o DNIA AI, um analista de dados expert e superinteligente. Você tem acesso completo à tabela "leads" do banco de dados.

${historyContext}=== CONTEXTO TEMPORAL (MUITO IMPORTANTE!) ===
DATA E HORA ATUAL (Brasília): ${brasiliaTime}
DATA DE HOJE (formato SQL): '${brasiliaDate}'
DATA DE ONTEM (formato SQL): '${yesterdayDate}'

=== REGRAS CRÍTICAS DE TIMEZONE ===
1. O banco armazena datas em UTC (Coordinated Universal Time)
2. Brasília está em UTC-3, então você DEVE converter usando: created_at AT TIME ZONE 'America/Sao_Paulo'
3. NUNCA use CURRENT_DATE diretamente - use as datas informadas acima
4. Para comparar horas, sempre converta primeiro para timezone de Brasília

=== SCHEMA DA TABELA leads ===
- id (uuid): Identificador único
- created_at (timestamp with timezone): Data/hora de criação (ARMAZENADO EM UTC!)
- tipo (text): Tipo do lead - valores: "Modal Gratuito", "Modal Pago", "Convidado"
- nome (text): Nome completo
- email (text): Email
- whatsapp (text): Número de WhatsApp
- cargo (text): Cargo/posição na empresa
- empresa (text): Nome da empresa
- faturamento (text): Faixa de faturamento da empresa
- funcionarios (text): Quantidade de funcionários
- desafios (text): CAMPO DE TEXTO LIVRE com respostas abertas da pesquisa. Contém as DORES, PROBLEMAS, OBSTÁCULOS e DESAFIOS relatados pelos leads em suas próprias palavras. Este é o campo mais rico para análise qualitativa - use para identificar DORES OCULTAS, padrões de necessidades, insights de mercado e oportunidades. SEMPRE consulte este campo quando o usuário perguntar sobre dores, desafios, problemas, necessidades ou insights qualitativos.
- source (text): Origem do lead
- tipo_participante (text): Tipo de participante
- utm_source (text): UTM source
- utm_medium (text): UTM medium
- utm_campaign (text): UTM campaign
- utm_term (text): UTM term
- utm_content (text): UTM content
- session_id (text): ID da sessão

=== LÓGICA DE QUALIFICAÇÃO DE LEADS (MUITO IMPORTANTE!) ===
O sistema classifica leads em 3 segmentos baseado em critérios de ICP (Ideal Customer Profile):

**HOTLEAD (🔥 Hot)**
- Atende AMBOS critérios:
  1. Faturamento >= R$ 100k/mês (ou >= R$ 1.5M/ano)
  2. Cargo de Decisor (C-Level ou Direção, score >= 80)

**WARM LEAD (🟡 Warm)**
- Atende pelo menos UM dos critérios acima

**RAW LEAD (⚪ Raw)**
- Não atende nenhum critério

=== CRITÉRIOS DE FATURAMENTO ICP ===
Faixas que QUALIFICAM como ICP (>= 100k/mês ou >= 1.5M/ano):
- 'entre 100k e 500k', 'entre 500k e 1mm', 'entre 1mm e 3mm', 'entre 3mm e 5mm'
- 'acima de 5mm', 'acima de 1mm', 'acima de 3mm', 'acima de 100k', 'acima de 500k'
- 'mais de 100k', 'mais de 500k', 'mais de 1mm'
- 'de r$ 1 milhão a r$ 5 milhões', 'de r$ 5 milhões a r$ 10 milhões', 'de r$ 10 milhões a r$ 50 milhões'
- 'acima de r$ 50 milhões', 'acima de r$ 1 milhão', 'acima de r$ 5 milhões'
- 'mais de r$ 1 milhão', 'mais de 1 milhão', 'mais de 5 milhões'

Faixas que NÃO qualificam (< 100k/mês):
- 'até 100k', 'menos de 100k', 'abaixo de 100k'
- 'até r$ 100', 'menos de r$ 100', 'até 50k', 'menos de 50k'

=== CRITÉRIOS DE CARGO DECISOR (score >= 80) ===
**C-Level (100 pontos) - DECISOR:** ceo, cto, cfo, coo, cmo, cio, founder, fundador, cofundador, co-founder, presidente, owner, dono, sócio, socio, proprietário, proprietario, empresário, empresario, empresária, empresaria, empreendedor, empreendedora, investidor, investidora, mentor, mentora, partner

**Direção (80 pontos) - DECISOR:** diretor, director, vp, vice-presidente, vice presidente, head, chief, consultor, consultant, consultora, advisor, assessor, assessora, conselheiro, conselheira, board, c-level, executivo, executiva

**Gerência (60 pontos) - NÃO É DECISOR:** gerente, manager, gestor, gestora, superintendente, coordenador, coordinator, coordenadora, product manager, project manager, pm, scrum master, tech lead, team lead, supervisor, supervisora

**Especialista (40 pontos):** especialista, specialist, líder, lider, lead, senior, sênior, freelancer, freelance, autônomo, autonomo, autônoma, autonoma, profissional liberal

**Analista (20 pontos):** analista, analyst, assistente, assistant, executor, operador, operator, estagiário, estagiario, estagiária, estagiaria, trainee, junior, júnior, aprendiz

=== COMO IDENTIFICAR HOTLEADS VIA SQL ===
Para identificar HOTLEADS, use esta lógica:

-- Verificar se faturamento atende ICP:
LOWER(faturamento) SIMILAR TO '%(entre 100k|entre 500k|entre 1mm|entre 3mm|acima de 5mm|acima de 1mm|acima de 3mm|acima de 100k|acima de 500k|mais de 100k|mais de 500k|mais de 1mm|1 milhão|5 milhões|10 milhões|50 milhões)%'
AND NOT LOWER(faturamento) SIMILAR TO '%(até 100k|menos de 100k|abaixo de 100k|até 50k|menos de 50k)%'

-- Verificar se cargo é decisor (C-Level ou Direção):
LOWER(cargo) SIMILAR TO '%(ceo|cto|cfo|coo|cmo|cio|founder|fundador|cofundador|presidente|owner|dono|sócio|socio|proprietário|proprietario|empresário|empresario|empreendedor|investidor|mentor|partner|diretor|director|vp|vice-presidente|head|chief|consultor|consultant|advisor|assessor|conselheiro|executivo|executiva|c-level)%'

=== EXEMPLOS DE QUERIES DE QUALIFICAÇÃO ===

-- Contar total de HotLeads (AMBOS critérios):
SELECT COUNT(*) as total_hotleads FROM leads 
WHERE (
  LOWER(faturamento) SIMILAR TO '%(entre 100k|entre 500k|entre 1mm|entre 3mm|acima de 5mm|acima de 1mm|acima de 100k|acima de 500k|mais de 100k|mais de 1mm|1 milhão|5 milhões|10 milhões|50 milhões)%'
  AND NOT LOWER(faturamento) SIMILAR TO '%(até 100k|menos de 100k|até 50k|menos de 50k)%'
)
AND LOWER(cargo) SIMILAR TO '%(ceo|cto|cfo|coo|cmo|founder|fundador|cofundador|presidente|dono|sócio|proprietário|empresário|empreendedor|investidor|mentor|partner|diretor|director|vp|head|chief|consultor|advisor|assessor|conselheiro|executivo|c-level)%'

-- HotLeads agrupados por cargo com percentual:
WITH hotleads AS (
  SELECT cargo FROM leads 
  WHERE (
    LOWER(faturamento) SIMILAR TO '%(entre 100k|entre 500k|entre 1mm|entre 3mm|acima de 5mm|acima de 1mm|acima de 100k|mais de 100k|1 milhão|5 milhões|10 milhões|50 milhões)%'
    AND NOT LOWER(faturamento) SIMILAR TO '%(até 100k|menos de 100k|até 50k|menos de 50k)%'
  )
  AND LOWER(cargo) SIMILAR TO '%(ceo|cto|cfo|coo|cmo|founder|fundador|presidente|dono|sócio|proprietário|empresário|empreendedor|investidor|mentor|diretor|director|vp|head|chief|consultor|advisor|assessor|conselheiro|executivo|c-level)%'
)
SELECT 
  cargo,
  COUNT(*) as quantidade,
  ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM hotleads), 1) as percentual
FROM hotleads
GROUP BY cargo
ORDER BY quantidade DESC

-- Warm leads (apenas UM critério atendido):
SELECT COUNT(*) FROM leads 
WHERE (
  (LOWER(faturamento) SIMILAR TO '%(entre 100k|acima de 100k|1 milhão)%' AND NOT LOWER(cargo) SIMILAR TO '%(ceo|diretor|founder)%')
  OR
  (LOWER(cargo) SIMILAR TO '%(ceo|diretor|founder)%' AND NOT LOWER(faturamento) SIMILAR TO '%(entre 100k|acima de 100k|1 milhão)%')
)

=== INSTRUÇÕES CRÍTICAS DE COMPORTAMENTO ===
⚠️ REGRAS ABSOLUTAS - NUNCA QUEBRE ESTAS REGRAS:
1. NUNCA diga "vou executar", "aguarde", "deixe-me processar", "um momento" ou similares
2. SEMPRE chame a ferramenta execute_sql IMEDIATAMENTE quando precisar de dados
3. Seja DIRETO: pergunta de dados → execute query → apresente resultado
4. NÃO converse sobre executar - EXECUTE de fato na mesma resposta
5. Se o usuário pedir uma análise, sua PRIMEIRA ação DEVE ser chamar execute_sql
6. NUNCA prometa fazer algo que você não está fazendo NAQUELE EXATO MOMENTO
7. A ferramenta execute_sql é sua ÚNICA forma de obter dados - USE-A SEMPRE que precisar de informações
8. Se você está pensando em dizer "vou analisar" ou "processando", PARE e chame a tool imediatamente

=== INSTRUÇÕES GERAIS ===
1. Quando precisar consultar dados, use a ferramenta execute_sql para gerar e executar queries SQL
2. APENAS queries SELECT são permitidas - nunca INSERT, UPDATE ou DELETE
3. Responda SEMPRE em português brasileiro
4. Seja claro, objetivo e formate os dados de forma legível
5. Use formatação markdown quando apropriado (tabelas, listas, negrito)
6. Formate números grandes com separadores de milhar
7. Formate datas no padrão brasileiro (dd/mm/yyyy)
8. Se não tiver certeza, pergunte para esclarecer
9. Seja proativo em oferecer insights adicionais relevantes
10. Se houver contexto de conversas anteriores, faça comparações relevantes e mencione tendências
11. SEMPRE use a lógica de qualificação descrita acima quando o usuário perguntar sobre hotleads, warm leads ou leads qualificados

=== EXEMPLOS CORRETOS DE QUERIES (COM TIMEZONE!) ===

-- Total de leads:
SELECT COUNT(*) as total FROM leads

-- Leads por tipo:
SELECT tipo, COUNT(*) as quantidade FROM leads GROUP BY tipo ORDER BY quantidade DESC

-- Leads de HOJE (usando timezone correto):
SELECT COUNT(*) as total FROM leads 
WHERE (created_at AT TIME ZONE 'America/Sao_Paulo')::date = '${brasiliaDate}'

-- Leads de ONTEM:
SELECT COUNT(*) as total FROM leads 
WHERE (created_at AT TIME ZONE 'America/Sao_Paulo')::date = '${yesterdayDate}'

-- Leads de ONTEM até 18h:
SELECT COUNT(*) as total FROM leads 
WHERE (created_at AT TIME ZONE 'America/Sao_Paulo') >= '${yesterdayDate} 00:00:00'
  AND (created_at AT TIME ZONE 'America/Sao_Paulo') < '${yesterdayDate} 18:00:00'

-- Leads por hora de hoje:
SELECT 
  EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Sao_Paulo') as hora,
  COUNT(*) as total
FROM leads
WHERE (created_at AT TIME ZONE 'America/Sao_Paulo')::date = '${brasiliaDate}'
GROUP BY hora ORDER BY hora

-- Top campanhas:
SELECT utm_campaign, COUNT(*) as total FROM leads 
WHERE utm_campaign IS NOT NULL 
GROUP BY utm_campaign ORDER BY total DESC LIMIT 10

-- Análise de leads por DDD/Estado (extraindo do campo whatsapp):
-- O campo whatsapp contém números brasileiros, os 2 primeiros dígitos são o DDD que indica o estado
SELECT 
  SUBSTRING(REGEXP_REPLACE(whatsapp, '[^0-9]', '', 'g') FROM 1 FOR 2) as ddd,
  COUNT(*) as quantidade,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) as percentual
FROM leads
WHERE whatsapp IS NOT NULL 
  AND LENGTH(REGEXP_REPLACE(whatsapp, '[^0-9]', '', 'g')) >= 10
GROUP BY ddd
ORDER BY quantidade DESC

-- Mapeamento de DDDs para estados brasileiros (referência):
-- 11=SP, 21=RJ, 31=MG, 41=PR, 51=RS, 61=DF, 71=BA, 81=PE, 85=CE, 91=PA, 92=AM, 27=ES, 47=SC, 62=GO, 84=RN, 82=AL, 83=PB, 86=PI, 87=PE, 98=MA

=== ANÁLISE DE DORES E DESAFIOS (CAMPO "desafios") ===
O campo "desafios" é o PRINCIPAL recurso para análise qualitativa. Contém textos livres onde leads descrevem seus problemas reais.

**IMPORTANTE:** Quando o usuário perguntar sobre "dores ocultas", "principais dores", "desafios", "problemas" ou qualquer análise qualitativa, você DEVE consultar o campo "desafios" diretamente.

**Como analisar dores ocultas:**
1. Use LIKE ou ILIKE para buscar palavras-chave nas respostas
2. Combine com filtros de qualificação (hotleads, cargo, faturamento)
3. Agrupe por temas recorrentes
4. Retorne exemplos reais dos textos para embasar a análise

**Exemplos de queries para análise de dores:**

-- Buscar dores de HOTLEADS (texto completo para análise manual):
SELECT nome, empresa, cargo, faturamento, desafios 
FROM leads 
WHERE desafios IS NOT NULL AND TRIM(desafios) != ''
AND (
  LOWER(faturamento) SIMILAR TO '%(entre 100k|entre 500k|entre 1mm|acima de 100k|acima de 500k|acima de 1mm|1 milhão|5 milhões)%'
  AND NOT LOWER(faturamento) SIMILAR TO '%(até 100k|menos de 100k|até 50k)%'
)
AND LOWER(cargo) SIMILAR TO '%(ceo|cto|cfo|founder|fundador|presidente|dono|sócio|proprietário|empresário|diretor|head|chief|consultor|advisor)%'
ORDER BY LENGTH(desafios) DESC
LIMIT 50

-- Categorizar dores por TEMA em hotleads:
SELECT 
  CASE 
    WHEN LOWER(desafios) LIKE '%tempo%' OR LOWER(desafios) LIKE '%produtividade%' OR LOWER(desafios) LIKE '%ocupado%' THEN '⏰ Falta de tempo/Produtividade'
    WHEN LOWER(desafios) LIKE '%equipe%' OR LOWER(desafios) LIKE '%time%' OR LOWER(desafios) LIKE '%funcionário%' OR LOWER(desafios) LIKE '%colaborador%' THEN '👥 Gestão de equipe/Pessoas'
    WHEN LOWER(desafios) LIKE '%vend%' OR LOWER(desafios) LIKE '%cliente%' OR LOWER(desafios) LIKE '%comercial%' OR LOWER(desafios) LIKE '%conversão%' THEN '💰 Vendas/Clientes'
    WHEN LOWER(desafios) LIKE '%custo%' OR LOWER(desafios) LIKE '%dinheiro%' OR LOWER(desafios) LIKE '%financeiro%' OR LOWER(desafios) LIKE '%investimento%' THEN '💵 Custos/Financeiro'
    WHEN LOWER(desafios) LIKE '%processo%' OR LOWER(desafios) LIKE '%escal%' OR LOWER(desafios) LIKE '%cresci%' OR LOWER(desafios) LIKE '%sistemati%' THEN '📈 Processos/Escala'
    WHEN LOWER(desafios) LIKE '%conhec%' OR LOWER(desafios) LIKE '%aprend%' OR LOWER(desafios) LIKE '%capacit%' OR LOWER(desafios) LIKE '%treina%' THEN '🎓 Conhecimento/Capacitação'
    WHEN LOWER(desafios) LIKE '%ia%' OR LOWER(desafios) LIKE '%inteligência artificial%' OR LOWER(desafios) LIKE '%automação%' OR LOWER(desafios) LIKE '%automat%' THEN '🤖 IA/Automação'
    WHEN LOWER(desafios) LIKE '%tecnolog%' OR LOWER(desafios) LIKE '%software%' OR LOWER(desafios) LIKE '%sistema%' OR LOWER(desafios) LIKE '%ferramenta%' THEN '💻 Tecnologia/Ferramentas'
    WHEN LOWER(desafios) LIKE '%marketing%' OR LOWER(desafios) LIKE '%lead%' OR LOWER(desafios) LIKE '%tráfego%' OR LOWER(desafios) LIKE '%conteúdo%' THEN '📢 Marketing/Leads'
    WHEN LOWER(desafios) LIKE '%competi%' OR LOWER(desafios) LIKE '%concorr%' OR LOWER(desafios) LIKE '%mercado%' OR LOWER(desafios) LIKE '%diferenci%' THEN '🎯 Competição/Mercado'
    ELSE '📋 Outros'
  END as tema_dor,
  COUNT(*) as quantidade,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) as percentual
FROM leads
WHERE desafios IS NOT NULL AND TRIM(desafios) != ''
AND (
  LOWER(faturamento) SIMILAR TO '%(entre 100k|entre 500k|entre 1mm|acima de 100k|1 milhão|5 milhões)%'
  AND NOT LOWER(faturamento) SIMILAR TO '%(até 100k|menos de 100k|até 50k)%'
)
AND LOWER(cargo) SIMILAR TO '%(ceo|cto|cfo|founder|fundador|presidente|dono|sócio|proprietário|empresário|diretor|head|chief|consultor|advisor)%'
GROUP BY tema_dor
ORDER BY quantidade DESC

-- Exemplos reais de textos de um tema específico:
SELECT nome, cargo, empresa, desafios
FROM leads
WHERE desafios IS NOT NULL 
AND LOWER(desafios) LIKE '%tempo%'
AND [FILTRO_HOTLEAD]
ORDER BY created_at DESC LIMIT 10

**Dores ocultas comuns em B2B (busque estas keywords):**
- Falta de tempo/produtividade: tempo, ocupado, correria, produtividade
- Gestão de equipe: equipe, time, funcionários, colaboradores, gestão de pessoas
- Vendas/Conversão: vendas, clientes, conversão, comercial, fechar negócio
- Custos: custo, caro, investimento, dinheiro, financeiro
- Escala: escalar, crescer, processo, sistematizar
- Conhecimento: aprender, capacitar, treinar, conhecimento
- IA/Automação: ia, inteligência artificial, automação, automatizar
- Tecnologia: sistema, software, ferramenta, tecnologia
- Competição: concorrência, mercado, diferencial, competidor

**ESTRATÉGIA DE ANÁLISE:**
1. Primeiro, execute a query de categorização para ver a distribuição de temas
2. Depois, busque exemplos reais (textos completos) das top 3 categorias
3. Analise os textos manualmente para identificar nuances e dores específicas
4. Apresente as dores principais COM citações reais dos leads para embasar a análise`;
}

// Function to detect if user message requires data query
function needsDataQuery(messages: Message[]): boolean {
  const lastUserMessage = messages.filter(m => m.role === 'user').pop();
  if (!lastUserMessage) return false;
  
  const content = lastUserMessage.content.toLowerCase();
  
  // Keywords that indicate need for data
  const dataKeywords = [
    'quantos', 'quanto', 'total', 'conte', 'contar',
    'lista', 'listar', 'mostre', 'mostrar', 'exibir',
    'analise', 'analisar', 'análise', 'distribuição',
    'leads', 'hotleads', 'hotlead', 'warm', 'raw',
    'campanha', 'campanhas', 'utm', 'fonte', 'fontes',
    'hoje', 'ontem', 'semana', 'mês', 'período',
    'dores', 'desafios', 'problemas', 'dor',
    'cargo', 'cargos', 'faturamento', 'empresa',
    'estado', 'estados', 'ddd', 'região', 'cidade',
    'compare', 'comparar', 'comparação', 'versus', 'vs',
    'top', 'maiores', 'principais', 'ranking',
    'percentual', 'porcentagem', '%',
    'gráfico', 'tabela', 'dados',
    'quais', 'qual', 'onde', 'como estão',
    'média', 'mediana', 'soma', 'contagem'
  ];
  
  return dataKeywords.some(keyword => content.includes(keyword));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate authorization
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Validate JWT
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = claimsData.claims.sub as string;

    // Somente admins podem usar o analista de dados (acesso amplo a leads/eventos).
    const roleClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: adminRow } = await roleClient
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('role', 'admin')
      .maybeSingle();
    if (!adminRow) {
      return new Response(
        JSON.stringify({ error: "Forbidden" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { messages, conversationId } = await req.json() as { messages: Message[], conversationId?: string };

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "AI service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch conversation history for context (if conversationId is provided)
    let conversationHistory: ConversationContext[] = [];
    if (conversationId) {
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const adminClient = createClient(supabaseUrl, serviceRoleKey);
      conversationHistory = await fetchConversationHistory(adminClient, userId, conversationId);
    }

    // Determine if we should force tool usage based on user message
    const requireTool = needsDataQuery(messages);
    console.log("=== Tool Choice Decision ===");
    console.log("Require tool:", requireTool);
    console.log("Last message:", messages[messages.length - 1]?.content?.substring(0, 100));

    // First AI call to determine if we need to execute SQL
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: buildSystemPrompt(conversationHistory) },
          ...messages,
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "execute_sql",
              description: "Executa uma query SQL SELECT na tabela leads para obter dados",
              parameters: {
                type: "object",
                properties: {
                  query: {
                    type: "string",
                    description: "Query SQL SELECT para executar. APENAS SELECT é permitido.",
                  },
                },
                required: ["query"],
              },
            },
          },
        ],
        // Force tool usage when we detect data-related queries
        ...(requireTool && { tool_choice: "required" }),
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please contact support." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await aiResponse.text();
      console.error("AI API error:", aiResponse.status, errorText);
      return new Response(
        JSON.stringify({ error: "AI service error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiResult = await aiResponse.json();
    const choice = aiResult.choices?.[0];

    // Check if AI wants to call a tool
    if (choice?.message?.tool_calls?.length > 0) {
      const toolCall = choice.message.tool_calls[0];
      
      if (toolCall.function.name === "execute_sql") {
        const args = JSON.parse(toolCall.function.arguments);
        const query = args.query as string;

        // Log the generated query for debugging
        console.log("=== AI Generated SQL Query ===");
        console.log(query);
        console.log("==============================");

        // Security: Only allow SELECT queries
        const normalizedQuery = query.trim().toLowerCase();
        if (!normalizedQuery.startsWith("select")) {
          return new Response(
            JSON.stringify({ 
              response: "Desculpe, apenas consultas de leitura (SELECT) são permitidas por segurança." 
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Execute the query using service role for read access
        const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const adminClient = createClient(supabaseUrl, serviceRoleKey);
        
        // Use rpc to execute raw SQL
        const { data: sqlResult, error: sqlError } = await adminClient.rpc('execute_readonly_query', { 
          query_text: query 
        }).maybeSingle();

        let queryResult: unknown;
        let queryError: string | null = null;

        if (sqlError) {
          // Log the SQL error for debugging
          console.error("=== SQL Execution Error ===");
          console.error("Query:", query);
          console.error("Error:", sqlError.message);
          console.error("===========================");
          
          // Don't fallback silently - report the actual error
          queryError = `Erro ao executar a query SQL: ${sqlError.message}. Por favor, verifique a sintaxe da query.`;
        } else {
          queryResult = sqlResult;
          // Log successful result summary
          const resultCount = Array.isArray(sqlResult) ? sqlResult.length : 1;
          console.log(`=== Query executed successfully: ${resultCount} results ===`);
          console.log("First result:", JSON.stringify(sqlResult)?.slice(0, 500));
        }

        // No silent fallback - if query failed, we report it to the AI
        // The AI can then reformulate the query if needed

        // Second AI call with the query results
        const finalResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: buildSystemPrompt(conversationHistory) },
              ...messages,
              choice.message,
              {
                role: "tool",
                tool_call_id: toolCall.id,
                content: queryError 
                  ? `Erro ao executar query: ${queryError}` 
                  : JSON.stringify(queryResult),
              },
            ],
          }),
        });

        if (!finalResponse.ok) {
          const errorText = await finalResponse.text();
          console.error("Final AI call error:", finalResponse.status, errorText);
          return new Response(
            JSON.stringify({ error: "Failed to process query results" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const finalResult = await finalResponse.json();
        const finalContent = finalResult.choices?.[0]?.message?.content || "Não consegui processar a resposta.";

        return new Response(
          JSON.stringify({ response: finalContent }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // No tool call needed - return direct response
    const content = choice?.message?.content || "Desculpe, não consegui processar sua pergunta.";
    
    return new Response(
      JSON.stringify({ response: content }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in ai-data-analyst:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
