-- Aba Custos (ADM + INSUMOS).
--   custos_geo: endereço e coordenada de centrais e fornecedores, buscados
--     uma vez (CNPJ → BrasilAPI → CEP → coordenada) e reaproveitados por todos.
--   custos_comentarios: registro do analista sobre uma comparação
--     (fornecedor + material + central) ou sobre uma NF desse par.
-- Acesso: só admin e insumos (reaproveita base_pode_editar(), da base
-- compartilhada, que é exatamente esse grupo). Seguro rodar mais de uma vez.

create table if not exists public.custos_geo (
  cnpj          text primary key check (cnpj ~ '^[0-9]{14}$'),
  tipo          text not null check (tipo in ('central', 'fornecedor')),
  nome          text,
  logradouro    text,
  numero        text,
  bairro        text,
  cep           text,
  municipio     text,
  uf            text,
  lat           double precision,
  lng           double precision,
  precisao      text check (precisao in ('cep', 'endereco', 'municipio', 'manual', 'falhou')),
  atualizado_por uuid default auth.uid(),
  atualizado_em  timestamptz not null default now()
);

alter table public.custos_geo enable row level security;

drop policy if exists custos_geo_ler on public.custos_geo;
create policy custos_geo_ler on public.custos_geo
  for select to authenticated using ((select public.base_pode_editar()));
drop policy if exists custos_geo_inserir on public.custos_geo;
create policy custos_geo_inserir on public.custos_geo
  for insert to authenticated with check ((select public.base_pode_editar()));
drop policy if exists custos_geo_alterar on public.custos_geo;
create policy custos_geo_alterar on public.custos_geo
  for update to authenticated using ((select public.base_pode_editar())) with check ((select public.base_pode_editar()));
drop policy if exists custos_geo_apagar on public.custos_geo;
create policy custos_geo_apagar on public.custos_geo
  for delete to authenticated using ((select public.is_admin()));

create table if not exists public.custos_comentarios (
  id          uuid primary key default gen_random_uuid(),
  fornecedor  text not null,            -- CNPJ (14 dígitos) ou, sem CNPJ, o nome normalizado
  material    text not null,            -- material padronizado do sistema
  central     text not null,            -- alias da central de destino
  nf          text,                     -- preenchido quando o comentário é sobre uma NF do par
  texto       text not null check (length(btrim(texto)) > 0),
  autor_nome  text,
  user_id     uuid not null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists custos_comentarios_par_idx
  on public.custos_comentarios (fornecedor, material, central);

alter table public.custos_comentarios enable row level security;

-- ADM e INSUMOS leem e comentam; cada um edita ou apaga só o próprio.
drop policy if exists custos_comentarios_ler on public.custos_comentarios;
create policy custos_comentarios_ler on public.custos_comentarios
  for select to authenticated using ((select public.base_pode_editar()));
drop policy if exists custos_comentarios_inserir on public.custos_comentarios;
create policy custos_comentarios_inserir on public.custos_comentarios
  for insert to authenticated with check ((select public.base_pode_editar()) and user_id = (select auth.uid()));
drop policy if exists custos_comentarios_alterar on public.custos_comentarios;
create policy custos_comentarios_alterar on public.custos_comentarios
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists custos_comentarios_apagar on public.custos_comentarios;
create policy custos_comentarios_apagar on public.custos_comentarios
  for delete to authenticated using (user_id = (select auth.uid()));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'custos_comentarios'
  ) then
    alter publication supabase_realtime add table public.custos_comentarios;
  end if;
end $$;
