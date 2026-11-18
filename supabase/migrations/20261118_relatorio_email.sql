-- Contatos para e-mail dos relatórios de regional + histórico de preparo (.eml)
create table if not exists public.relatorio_contatos (
  id uuid primary key default gen_random_uuid(),
  nome text not null default '',
  email text not null,
  tipo text not null check (tipo in ('fixo', 'regional')),
  regional text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint relatorio_contatos_regional_chk check (tipo = 'fixo' or coalesce(regional, '') <> '')
);
alter table public.relatorio_contatos enable row level security;
revoke all on public.relatorio_contatos from anon;
revoke all on public.relatorio_contatos from authenticated;
grant select, insert, update, delete on public.relatorio_contatos to authenticated;

create policy relatorio_contatos_ler on public.relatorio_contatos
  for select to authenticated using (true);
create policy relatorio_contatos_inserir on public.relatorio_contatos
  for insert to authenticated with check ((select public.is_admin()));
create policy relatorio_contatos_alterar on public.relatorio_contatos
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy relatorio_contatos_apagar on public.relatorio_contatos
  for delete to authenticated using ((select public.is_admin()));

create table if not exists public.relatorio_envios (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid not null default auth.uid(),
  user_nome text,
  regional text not null,
  para text[] not null default '{}',
  cc text[] not null default '{}',
  assunto text,
  modo text not null default 'unico' check (modo in ('unico', 'massa'))
);
create index if not exists relatorio_envios_criado_idx on public.relatorio_envios (created_at desc);
alter table public.relatorio_envios enable row level security;
revoke all on public.relatorio_envios from anon;
revoke all on public.relatorio_envios from authenticated;
grant select, insert on public.relatorio_envios to authenticated;

create policy relatorio_envios_ler on public.relatorio_envios
  for select to authenticated using (true);
create policy relatorio_envios_inserir on public.relatorio_envios
  for insert to authenticated with check (user_id = (select auth.uid()));
