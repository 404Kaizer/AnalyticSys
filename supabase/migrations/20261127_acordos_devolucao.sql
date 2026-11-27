-- Aba Acordos: NFs de DEVOLUÇÃO (Hugo, 27/11/2026). Seguro rodar mais de uma vez.
--   cob_cfop.acordo ganha 'devolucao'. Cada NF de devolução cita, no complementar,
--   a nota mãe ou a nota filha que devolve (parte ou tudo) — ver js/acordos.js.
--   acordo_sefaz_nfs(): numa consulta só, as NFs do SEFAZ com algum item de CFOP
--   marcado no cadastro (antes era uma consulta por CFOP; com as devoluções seriam ~80).
--   acordo_vinculos passa a guardar também devolução → mãe/filha (chave_filha = a
--   devolução, chave_mae = a nota devolvida); acordo_nf_status vale para filhas.

alter table public.cob_cfop drop constraint if exists cob_cfop_acordo_check;
alter table public.cob_cfop add constraint cob_cfop_acordo_check check (acordo in ('mae', 'filha', 'devolucao'));

-- CFOPs de devolução (tabela CFOP do Convênio s/nº de 1970 / Ajuste SINIEF 07/01).
-- Fora: anulação de valor (x206/x207), retornos e vasilhame/sacaria.
-- CFOP que não existia entra com resumo DEVOLUCAO (fora de VENDA/REMESSA → não
-- muda nada na Cobrança). O que já existe só ganha o acordo, se ainda não tinha.
insert into public.cob_cfop (cfop, resumo, descricao, acordo)
select v.cfop, 'DEVOLUCAO', v.descricao, 'devolucao'
from (values
  -- Entradas: devolução de venda (emitida por quem vendeu)
  ('1201', 'Devolucao de venda de producao do estabelecimento'),
  ('1202', 'Devolucao de venda de mercadoria adquirida ou recebida de terceiros'),
  ('1203', 'Devolucao de venda de producao do estabelecimento, destinada a ZFM ou ALC'),
  ('1204', 'Devolucao de venda de mercadoria adquirida ou recebida de terceiros, destinada a ZFM ou ALC'),
  ('1208', 'Devolucao de producao do estabelecimento, remetida em transferencia'),
  ('1209', 'Devolucao de mercadoria adquirida ou recebida de terceiros, remetida em transferencia'),
  ('1410', 'Devolucao de venda de producao do estabelecimento em operacao com ST'),
  ('1411', 'Devolucao de venda de mercadoria adquirida ou recebida de terceiros em operacao com ST'),
  ('1503', 'Entrada decorrente de devolucao de produto remetido com fim especifico de exportacao, de producao do estabelecimento'),
  ('1504', 'Entrada decorrente de devolucao de mercadoria remetida com fim especifico de exportacao, adquirida de terceiros'),
  ('1505', 'Entrada decorrente de devolucao simbolica de mercadoria remetida para formacao de lote de exportacao, de producao do estabelecimento'),
  ('1506', 'Entrada decorrente de devolucao simbolica de mercadoria remetida para formacao de lote de exportacao, adquirida de terceiros'),
  ('1553', 'Devolucao de venda de bem do ativo imobilizado'),
  ('1660', 'Devolucao de venda de combustivel ou lubrificante destinado a industrializacao subsequente'),
  ('1661', 'Devolucao de venda de combustivel ou lubrificante destinado a comercializacao'),
  ('1662', 'Devolucao de venda de combustivel ou lubrificante destinado a consumidor ou usuario final'),
  ('1918', 'Devolucao de mercadoria remetida em consignacao mercantil ou industrial'),
  ('1919', 'Devolucao simbolica de mercadoria vendida ou utilizada em processo industrial, remetida em consignacao'),
  ('2201', 'Devolucao de venda de producao do estabelecimento'),
  ('2202', 'Devolucao de venda de mercadoria adquirida ou recebida de terceiros'),
  ('2203', 'Devolucao de venda de producao do estabelecimento, destinada a ZFM ou ALC'),
  ('2204', 'Devolucao de venda de mercadoria adquirida ou recebida de terceiros, destinada a ZFM ou ALC'),
  ('2208', 'Devolucao de producao do estabelecimento, remetida em transferencia'),
  ('2209', 'Devolucao de mercadoria adquirida ou recebida de terceiros, remetida em transferencia'),
  ('2410', 'Devolucao de venda de producao do estabelecimento em operacao com ST'),
  ('2411', 'Devolucao de venda de mercadoria adquirida ou recebida de terceiros em operacao com ST'),
  ('2503', 'Entrada decorrente de devolucao de produto remetido com fim especifico de exportacao, de producao do estabelecimento'),
  ('2504', 'Entrada decorrente de devolucao de mercadoria remetida com fim especifico de exportacao, adquirida de terceiros'),
  ('2505', 'Entrada decorrente de devolucao simbolica de mercadoria remetida para formacao de lote de exportacao, de producao do estabelecimento'),
  ('2506', 'Entrada decorrente de devolucao simbolica de mercadoria remetida para formacao de lote de exportacao, adquirida de terceiros'),
  ('2553', 'Devolucao de venda de bem do ativo imobilizado'),
  ('2660', 'Devolucao de venda de combustivel ou lubrificante destinado a industrializacao subsequente'),
  ('2661', 'Devolucao de venda de combustivel ou lubrificante destinado a comercializacao'),
  ('2662', 'Devolucao de venda de combustivel ou lubrificante destinado a consumidor ou usuario final'),
  ('2918', 'Devolucao de mercadoria remetida em consignacao mercantil ou industrial'),
  ('2919', 'Devolucao simbolica de mercadoria vendida ou utilizada em processo industrial, remetida em consignacao'),
  ('3201', 'Devolucao de venda de producao do estabelecimento (exterior)'),
  ('3202', 'Devolucao de venda de mercadoria adquirida ou recebida de terceiros (exterior)'),
  ('3211', 'Devolucao de venda de producao do estabelecimento sob o regime de drawback'),
  ('3503', 'Devolucao de mercadoria exportada que tenha sido recebida com fim especifico de exportacao'),
  ('3553', 'Devolucao de venda de bem do ativo imobilizado (exterior)'),
  -- Saídas: devolução de compra (emitida por quem comprou)
  ('5201', 'Devolucao de compra para industrializacao ou producao rural'),
  ('5202', 'Devolucao de compra para comercializacao'),
  ('5208', 'Devolucao de mercadoria recebida em transferencia para industrializacao ou producao rural'),
  ('5209', 'Devolucao de mercadoria recebida em transferencia para comercializacao'),
  ('5210', 'Devolucao de compra para utilizacao na prestacao de servico'),
  ('5410', 'Devolucao de compra para industrializacao ou producao rural em operacao com ST'),
  ('5411', 'Devolucao de compra para comercializacao em operacao com ST'),
  ('5412', 'Devolucao de bem do ativo imobilizado, em operacao com ST'),
  ('5413', 'Devolucao de mercadoria destinada ao uso ou consumo, em operacao com ST'),
  ('5503', 'Devolucao de mercadoria recebida com fim especifico de exportacao'),
  ('5553', 'Devolucao de compra de bem para o ativo imobilizado'),
  ('5555', 'Devolucao de bem do ativo imobilizado de terceiro, recebido para uso no estabelecimento'),
  ('5556', 'Devolucao de compra de material de uso ou consumo'),
  ('5660', 'Devolucao de compra de combustivel ou lubrificante adquirido para industrializacao subsequente'),
  ('5661', 'Devolucao de compra de combustivel ou lubrificante adquirido para comercializacao'),
  ('5662', 'Devolucao de compra de combustivel ou lubrificante adquirido por consumidor ou usuario final'),
  ('5918', 'Devolucao de mercadoria recebida em consignacao mercantil ou industrial'),
  ('5919', 'Devolucao simbolica de mercadoria vendida ou utilizada em processo industrial, recebida em consignacao'),
  ('6201', 'Devolucao de compra para industrializacao ou producao rural'),
  ('6202', 'Devolucao de compra para comercializacao'),
  ('6208', 'Devolucao de mercadoria recebida em transferencia para industrializacao ou producao rural'),
  ('6209', 'Devolucao de mercadoria recebida em transferencia para comercializacao'),
  ('6210', 'Devolucao de compra para utilizacao na prestacao de servico'),
  ('6410', 'Devolucao de compra para industrializacao ou producao rural em operacao com ST'),
  ('6411', 'Devolucao de compra para comercializacao em operacao com ST'),
  ('6412', 'Devolucao de bem do ativo imobilizado, em operacao com ST'),
  ('6413', 'Devolucao de mercadoria destinada ao uso ou consumo, em operacao com ST'),
  ('6503', 'Devolucao de mercadoria recebida com fim especifico de exportacao'),
  ('6553', 'Devolucao de compra de bem para o ativo imobilizado'),
  ('6555', 'Devolucao de bem do ativo imobilizado de terceiro, recebido para uso no estabelecimento'),
  ('6556', 'Devolucao de compra de material de uso ou consumo'),
  ('6660', 'Devolucao de compra de combustivel ou lubrificante adquirido para industrializacao subsequente'),
  ('6661', 'Devolucao de compra de combustivel ou lubrificante adquirido para comercializacao'),
  ('6662', 'Devolucao de compra de combustivel ou lubrificante adquirido por consumidor ou usuario final'),
  ('6918', 'Devolucao de mercadoria recebida em consignacao mercantil ou industrial'),
  ('6919', 'Devolucao simbolica de mercadoria vendida ou utilizada em processo industrial, recebida em consignacao'),
  ('7201', 'Devolucao de compra para industrializacao ou producao rural (exterior)'),
  ('7202', 'Devolucao de compra para comercializacao (exterior)'),
  ('7210', 'Devolucao de compra para utilizacao na prestacao de servico (exterior)'),
  ('7211', 'Devolucao de compras para industrializacao sob o regime de drawback'),
  ('7553', 'Devolucao de compra de bem para o ativo imobilizado (exterior)'),
  ('7556', 'Devolucao de compra de material de uso ou consumo (exterior)')
) as v(cfop, descricao)
on conflict (cfop) do update set acordo = excluded.acordo
  where public.cob_cfop.acordo is null;

-- NFs do SEFAZ que interessam à aba (algum item com CFOP marcado). security
-- invoker: vale a RLS de cob_sefaz de quem chama.
create or replace function public.acordo_sefaz_nfs()
returns setof public.cob_sefaz
language sql stable security invoker set search_path = public as $$
  select s.* from public.cob_sefaz s
  where exists (
    select 1 from jsonb_array_elements(case when jsonb_typeof(s.itens) = 'array' then s.itens else '[]'::jsonb end) i
    join public.cob_cfop c on c.cfop::text = i->>'cfop'
    where c.acordo is not null)
$$;
revoke all on function public.acordo_sefaz_nfs() from public, anon;
grant execute on function public.acordo_sefaz_nfs() to authenticated;
