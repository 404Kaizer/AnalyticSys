-- Aba Acordos (ADM + INSUMOS): notas mães/adiantamentos, rebates e acordos
-- financeiros por fornecedor (ver js/acordos.js). Seguro rodar mais de uma vez.
--   cob_cfop.acordo        : 'mae' (simples faturamento, entrega futura) ou
--                            'filha' (remessa da entrega futura) — editável
--                            no cadastro de CFOP das Configurações.
--   acordo_fornecedores    : modalidade do acordo por CNPJ do fornecedor.
--   acordo_nf_status       : status manual da nota mãe (cancelada vem do SEFAZ).
--   acordo_vinculos        : vínculo manual nota filha → nota mãe.
--   acordo_maes_ocultas()  : chaves/números das notas mães, lidas por TODOS os
--                            autenticados (só esses 3 campos) para tirar as
--                            mães das Entradas dos analistas de estoque.
-- Acesso às tabelas: base_pode_editar() (= admin + insumos).

alter table public.cob_cfop add column if not exists acordo text;
alter table public.cob_cfop drop constraint if exists cob_cfop_acordo_check;
alter table public.cob_cfop add constraint cob_cfop_acordo_check check (acordo in ('mae', 'filha'));

-- CFOPs padrão. CFOP que não existia entra com resumo ENTREGA FUTURA (fora de
-- VENDA/REMESSA → não muda nada na Cobrança). O que já existe só ganha o acordo.
insert into public.cob_cfop (cfop, resumo, descricao, acordo) values
  ('5922', 'ENTREGA FUTURA', 'Simples faturamento - venda para entrega futura', 'mae'),
  ('6922', 'ENTREGA FUTURA', 'Simples faturamento - venda para entrega futura', 'mae'),
  ('5116', 'ENTREGA FUTURA', 'Venda de producao originada de encomenda para entrega futura', 'filha'),
  ('6116', 'ENTREGA FUTURA', 'Venda de producao originada de encomenda para entrega futura', 'filha'),
  ('5117', 'ENTREGA FUTURA', 'Venda de mercadoria originada de encomenda para entrega futura', 'filha'),
  ('6117', 'ENTREGA FUTURA', 'Venda de mercadoria originada de encomenda para entrega futura', 'filha')
on conflict (cfop) do update set acordo = excluded.acordo;

create table if not exists public.acordo_fornecedores (
  cnpj           text primary key check (cnpj ~ '^[0-9]{14}$'),
  nome           text,
  modalidade     text check (modalidade in ('nota_mae', 'rebate', 'acordo_financeiro')),
  atualizado_por uuid default auth.uid(),
  atualizado_em  timestamptz not null default now()
);

create table if not exists public.acordo_nf_status (
  chave          text primary key check (chave ~ '^[0-9]{44}$'),
  status         text not null check (status in ('autorizada', 'devolvida', 'inutilizada', 'indevida', 'recusada')),
  atualizado_por uuid default auth.uid(),
  atualizado_em  timestamptz not null default now()
);

create table if not exists public.acordo_vinculos (
  chave_filha    text primary key check (chave_filha ~ '^[0-9]{44}$'),
  chave_mae      text not null check (chave_mae ~ '^[0-9]{44}$'),
  numero_mae     text not null,
  atualizado_por uuid default auth.uid(),
  atualizado_em  timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['acordo_fornecedores', 'acordo_nf_status', 'acordo_vinculos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_ler', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.base_pode_editar()))', t || '_ler', t);
    execute format('drop policy if exists %I on public.%I', t || '_inserir', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select public.base_pode_editar()))', t || '_inserir', t);
    execute format('drop policy if exists %I on public.%I', t || '_alterar', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select public.base_pode_editar())) with check ((select public.base_pode_editar()))', t || '_alterar', t);
    execute format('drop policy if exists %I on public.%I', t || '_apagar', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select public.base_pode_editar()))', t || '_apagar', t);
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Notas mães do SEFAZ (algum item com CFOP marcado 'mae'). SECURITY DEFINER:
-- o analista de estoque não lê cob_sefaz, só esta lista (chave, CNPJ, número).
create or replace function public.acordo_maes_ocultas()
returns table (chave text, cnpj text, numero text)
language sql stable security definer set search_path = public as $$
  select s.chave, s.cnpj_emitente, s.numero
  from public.cob_sefaz s
  where exists (
    select 1 from jsonb_array_elements(s.itens) i
    join public.cob_cfop c on c.cfop = i->>'cfop'
    where c.acordo = 'mae'
  )
  order by s.chave
$$;
revoke all on function public.acordo_maes_ocultas() from public, anon;
grant execute on function public.acordo_maes_ocultas() to authenticated;
