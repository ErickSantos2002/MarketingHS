-- Duas coisas, e a segunda é a que faz o scoring existir.
--
-- 1) Remove o classificador de etiqueta com regras cravadas no corpo. Ele já
--    chegou DESABILITADO no dump (pg_trigger.tgenabled = 'D') — a própria
--    dn.ia o desligou —, mas função e trigger continuavam no schema com o ICP
--    deles dentro: regex de faturamento de infoproduto ('entre 100k',
--    'de r$ 1 milhão') e lista de cargos de quem compra imersão.
--    Trigger desabilitado é armadilha: alguém o reativa daqui a seis meses
--    achando que está "ligando o scoring", e a base recebe a régua errada.
--    A régua passa a ter um lugar só: a tabela scoring_config.
--
-- 2) Semeia scoring_config, que veio vazia no dump. Sem ela,
--    score_lead_from_config cai no RETURN NEW e NADA é pontuado.

DROP TRIGGER IF EXISTS trigger_classify_lead_etiqueta ON public.leads;
DROP FUNCTION IF EXISTS public.classify_lead_etiqueta();

-- ⚠️ As chaves abaixo são as que score_lead_from_config lê de verdade,
-- conferidas no corpo da função. Em especial: é **points**, não "pontos".
-- Chave com nome errado não dá erro — passa por COALESCE(...,0) e o critério
-- vale zero em silêncio.
--
-- ⚠️ Régua PROVISÓRIA, e de propósito. A definitiva é decisão do Erick e do
-- Nicholson, com a base real na tela. O que esta migration garante é que o
-- mecanismo funcione e que trocá-la seja um UPDATE nesta linha.
--
-- O critério de desempate: os critérios ligados medem **comportamento e
-- alcançabilidade** — coisas que valem para qualquer negócio. Os que afirmam
-- perfil de cliente ideal (faturamento, número de funcionários) ficam
-- DESLIGADOS, porque as faixas do original vinham do formulário de um evento
-- de infoproduto e nenhum formulário da HS coleta esses campos hoje. Ligar um
-- critério sobre um campo que ninguém preenche só produz ruído.
INSERT INTO public.scoring_config (criteria, thresholds)
VALUES (
  jsonb_build_object(

    -- Quem decide compra de bafômetro e contrato de calibração. Herda os
    -- decisores clássicos e acrescenta os papéis de segurança do trabalho,
    -- que são quem especifica o equipamento na indústria.
    'cargo_decisor', jsonb_build_object(
      'enabled', true,
      'points', 25,
      'cargos', jsonb_build_array(
        'CEO','Fundador','Sócio','Proprietário','Dono','Diretor','Gerente',
        'Coordenador','Responsável','SESMT','Segurança do Trabalho',
        'Técnico de Segurança','Engenheiro de Segurança','RH')),

    -- Desligados: nenhum formulário da HS coleta estes campos hoje.
    'faturamento', jsonb_build_object('enabled', false, 'points', 0, 'min_value', 0),
    'funcionarios', jsonb_build_object('enabled', false, 'points', 0, 'min_value', 0),

    -- Escreveu um problema real (>= 20 caracteres) em vez de deixar em branco.
    'tem_desafios', jsonb_build_object('enabled', true, 'points', 10),

    -- Origem que indica intenção. csv_import fica de fora de propósito:
    -- importar uma lista não é sinal de interesse de quem está na lista.
    'origem', jsonb_build_object(
      'enabled', true, 'points', 15,
      'sources', jsonb_build_array('site','indicacao','google','organic')),

    -- Converteu mais de uma vez. É o sinal mais forte que existe sem saber o
    -- ICP: comportamento observado, não afirmação de quem preencheu.
    'reconversao', jsonb_build_object('enabled', true, 'points', 25),

    -- Alcançável pelo canal que a HS de fato usa.
    'tem_whatsapp', jsonb_build_object('enabled', true, 'points', 10)
  ),
  -- Máximo possível com os critérios ligados: 25+10+15+25+10 = 85.
  jsonb_build_object('hotlead', 60, 'warm', 30)
);
