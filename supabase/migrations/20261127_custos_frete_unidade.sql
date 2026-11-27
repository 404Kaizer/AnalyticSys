-- Aba Custos: frete cadastrado passa a ser por unidade da NF do fornecedor (R$/m³, R$/t, R$/kg…).
-- unidade = UN em que o valor foi digitado. Linhas antigas ficam com null e continuam valendo como antes
-- (R$/t para agregados/aglomerantes, R$/kg para aditivos/adições). Seguro rodar mais de uma vez.
alter table public.custos_frete add column if not exists unidade text;
