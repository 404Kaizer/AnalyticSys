-- Aba Acordos: fornecedores com modalidade NOTA MÃE (lista do Hugo, 23/11/2026).
-- Rodar DEPOIS de 20261123_acordos.sql. Seguro rodar mais de uma vez.
-- O nome vem do cadastro de fornecedores da Cobrança (cob_fornecedores), quando existir.
insert into public.acordo_fornecedores (cnpj, nome, modalidade)
select c.cnpj, f.nome, 'nota_mae'
from unnest(array[
  '14117052000157',  -- 14.117.052/0001-57
  '19974518000316',  -- 19.974.518/0003-16
  '03334595000100',  -- 03.334.595/0001-00
  '27175959000114',  -- 27.175.959/0001-14
  '34089417000194',  -- 34.089.417/0001-94
  '33039223000626',  -- 33.039.223/0006-26
  '33039223000979',  -- 33.039.223/0009-79
  '49332665000272'   -- 49.332.665/0002-72
]) as c(cnpj)
left join public.cob_fornecedores f on f.cnpj = c.cnpj
on conflict (cnpj) do update
  set modalidade = 'nota_mae', nome = coalesce(excluded.nome, public.acordo_fornecedores.nome), atualizado_em = now();
