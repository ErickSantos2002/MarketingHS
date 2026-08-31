-- `receive-contact-event` aceita source_app 'website' na validação dela, mas o
-- trigger do banco só aceitava 'dnmarketing', 'nexus' e 'mentoria'. A function
-- deixava passar e o banco derrubava com exceção — quebrada para esse valor
-- desde sempre, e provavelmente ninguém nunca mandou 'website'.
--
-- 'website' é origem plausível na HS (o site postando um lead), então a lista
-- do banco é que se ajusta. As duas pontas passam a dizer a mesma coisa.

CREATE OR REPLACE FUNCTION public.validate_contact_event_source_app()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.source_app NOT IN ('marketinghs','dnmarketing','nexus','mentoria','website') THEN
    RAISE EXCEPTION 'Invalid source_app value: %', NEW.source_app;
  END IF;
  RETURN NEW;
END;
$$;
