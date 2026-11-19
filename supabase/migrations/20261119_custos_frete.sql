-- Aba Custos: frete cadastrado por fornecedor e região (ADM + INSUMOS).
--   modalidade: 'cif'     = frete embutido no preço (soma 0)
--               'cte'     = FOB, soma o valor do CTe informado
--               'proprio' = transporte próprio (valor opcional; vazio = sem custo)
--   valor: R$ por tonelada (agregado, aglomerante) ou por kg (aditivo, adição) — a unidade do material.
--   Alcance: regional inteira, ou uma central (central preenchida vence a regional);
--   material vazio = todos os materiais do fornecedor. Vigência: vale a partir de 'vigencia'.
-- Quando a NF traz o frete real (Entradas, coluna TOTAL FRETE), ele é usado e, se diferir
-- do cadastrado, vira alerta de CTe "divergente". Seguro rodar mais de uma vez.

create table if not exists public.custos_frete (
  id          uuid primary key default gen_random_uuid(),
  fornecedor  text not null,            -- CNPJ (14 dígitos) ou, sem CNPJ, 'n:' + nome normalizado
  regional    text not null,
  central     text,                     -- alias; vazio = vale para a regional inteira
  material    text,                     -- vazio = todos os materiais
  modalidade  text not null check (modalidade in ('cif', 'cte', 'proprio')),
  valor       numeric check (valor is null or valor >= 0),
  vigencia    date not null default current_date,
  obs         text,
  autor_nome  text,
  user_id     uuid not null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists custos_frete_forn_idx on public.custos_frete (fornecedor, regional);

alter table public.custos_frete enable row level security;

-- Cadastro do time: ADM e INSUMOS leem e editam qualquer linha.
drop policy if exists custos_frete_ler on public.custos_frete;
create policy custos_frete_ler on public.custos_frete
  for select to authenticated using ((select public.base_pode_editar()));
drop policy if exists custos_frete_inserir on public.custos_frete;
create policy custos_frete_inserir on public.custos_frete
  for insert to authenticated with check ((select public.base_pode_editar()));
drop policy if exists custos_frete_alterar on public.custos_frete;
create policy custos_frete_alterar on public.custos_frete
  for update to authenticated using ((select public.base_pode_editar())) with check ((select public.base_pode_editar()));
drop policy if exists custos_frete_apagar on public.custos_frete;
create policy custos_frete_apagar on public.custos_frete
  for delete to authenticated using ((select public.base_pode_editar()));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'custos_frete'
  ) then
    alter publication supabase_realtime add table public.custos_frete;
  end if;
end $$;
