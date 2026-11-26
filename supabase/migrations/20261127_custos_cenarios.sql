-- Aba Custos: criador de rotas.
--   custos_cenarios: trajeto montado pelo analista para um par fornecedor → central (pontos de passagem,
--     praças que o motorista paga, caminhão, combustível, outros custos, frete contratado). Vários por par;
--     um marcado como oficial substitui a rota automática no mapa (km e pedágios).
--   custos_pedagio_tarifas: tarifa por eixo de cada praça (id do nó no OpenStreetMap), informada uma vez
--     e reaproveitada por todos os cenários.
-- Acesso: admin e insumos (base_pode_editar), como as demais tabelas da aba. Seguro rodar mais de uma vez.

create table if not exists public.custos_cenarios (
  id            uuid primary key default gen_random_uuid(),
  fornecedor    text not null,            -- CNPJ (ou nome normalizado)
  central       text not null,            -- alias da central
  nome          text not null check (length(btrim(nome)) > 0),
  oficial       boolean not null default false,
  pontos        jsonb not null default '[]',   -- pontos de passagem [[lng, lat], ...] entre origem e destino
  geometria     text not null,            -- polyline do OSRM (precisão 5)
  km            double precision not null,
  minutos       double precision,
  pedagios      jsonb not null default '[]',   -- praças no trajeto (ids OSM), em ordem
  pedagios_fora jsonb not null default '[]',   -- praças do trajeto que o motorista NÃO paga
  params        jsonb not null default '{}',   -- eixos, carga_t, consumo, diesel, volta, outros[], frete{}
  autor_nome    text,
  user_id       uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists custos_cenarios_par_idx on public.custos_cenarios (fornecedor, central);
-- No máximo um oficial por par.
create unique index if not exists custos_cenarios_oficial_uq on public.custos_cenarios (fornecedor, central) where oficial;

alter table public.custos_cenarios enable row level security;
drop policy if exists custos_cenarios_ler on public.custos_cenarios;
create policy custos_cenarios_ler on public.custos_cenarios
  for select to authenticated using ((select public.base_pode_editar()));
drop policy if exists custos_cenarios_inserir on public.custos_cenarios;
create policy custos_cenarios_inserir on public.custos_cenarios
  for insert to authenticated with check ((select public.base_pode_editar()));
drop policy if exists custos_cenarios_alterar on public.custos_cenarios;
create policy custos_cenarios_alterar on public.custos_cenarios
  for update to authenticated using ((select public.base_pode_editar())) with check ((select public.base_pode_editar()));
drop policy if exists custos_cenarios_apagar on public.custos_cenarios;
create policy custos_cenarios_apagar on public.custos_cenarios
  for delete to authenticated using ((select public.base_pode_editar()));

create table if not exists public.custos_pedagio_tarifas (
  praca          bigint primary key,       -- id do nó barrier=toll_booth no OpenStreetMap
  tarifa_eixo    numeric(10, 2) not null check (tarifa_eixo >= 0),
  atualizado_por uuid default auth.uid(),
  autor_nome     text,
  atualizado_em  timestamptz not null default now()
);

alter table public.custos_pedagio_tarifas enable row level security;
drop policy if exists custos_pedagio_tarifas_ler on public.custos_pedagio_tarifas;
create policy custos_pedagio_tarifas_ler on public.custos_pedagio_tarifas
  for select to authenticated using ((select public.base_pode_editar()));
drop policy if exists custos_pedagio_tarifas_inserir on public.custos_pedagio_tarifas;
create policy custos_pedagio_tarifas_inserir on public.custos_pedagio_tarifas
  for insert to authenticated with check ((select public.base_pode_editar()));
drop policy if exists custos_pedagio_tarifas_alterar on public.custos_pedagio_tarifas;
create policy custos_pedagio_tarifas_alterar on public.custos_pedagio_tarifas
  for update to authenticated using ((select public.base_pode_editar())) with check ((select public.base_pode_editar()));

-- Realtime: mudanças de um analista aparecem para os outros com a aba aberta.
do $$
declare t text;
begin
  foreach t in array array['custos_cenarios', 'custos_pedagio_tarifas'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
