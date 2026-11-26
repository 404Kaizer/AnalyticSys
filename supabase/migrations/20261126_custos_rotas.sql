-- Aba Custos: rota rodoviária fornecedor → central (OSRM), calculada uma vez
-- e reaproveitada por todos. Guarda as coordenadas usadas: se o endereço do
-- fornecedor ou da central mudar, o app recalcula a rota.
-- Acesso igual ao custos_geo (admin e insumos). Seguro rodar mais de uma vez.

create table if not exists public.custos_rotas (
  fornecedor    text not null,            -- CNPJ (ou nome normalizado, como em custos_comentarios)
  central       text not null,            -- alias da central
  km            double precision not null,
  minutos       double precision,
  geometria     text not null,            -- polyline do OSRM (precisão 5)
  o_lat double precision, o_lng double precision,   -- fornecedor usado no cálculo
  d_lat double precision, d_lng double precision,   -- central usada no cálculo
  pedagios      jsonb,                    -- ids OSM das praças de pedágio no trajeto, em ordem
  atualizado_por uuid default auth.uid(),
  atualizado_em  timestamptz not null default now(),
  primary key (fornecedor, central)
);

-- Para quem já rodou a versão sem pedágios:
alter table public.custos_rotas add column if not exists pedagios jsonb;

alter table public.custos_rotas enable row level security;

drop policy if exists custos_rotas_ler on public.custos_rotas;
create policy custos_rotas_ler on public.custos_rotas
  for select to authenticated using ((select public.base_pode_editar()));
drop policy if exists custos_rotas_inserir on public.custos_rotas;
create policy custos_rotas_inserir on public.custos_rotas
  for insert to authenticated with check ((select public.base_pode_editar()));
drop policy if exists custos_rotas_alterar on public.custos_rotas;
create policy custos_rotas_alterar on public.custos_rotas
  for update to authenticated using ((select public.base_pode_editar())) with check ((select public.base_pode_editar()));
drop policy if exists custos_rotas_apagar on public.custos_rotas;
create policy custos_rotas_apagar on public.custos_rotas
  for delete to authenticated using ((select public.is_admin()));
