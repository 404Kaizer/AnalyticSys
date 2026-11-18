-- Base compartilhada de Entradas/Saídas (js/base-compartilhada.js).
-- O perfil INSUMOS (e o ADM) importa; todo mundo recebe. Cada importação
-- vira um "pacote" (JSON gzip em chunks no bucket base-compartilhada) e
-- uma linha aqui, que é o índice que os clientes comparam com o local.
-- Excluir uma importação = linha com excluido = true (os arquivos somem).
-- Seguro rodar mais de uma vez.

create table if not exists public.base_pacotes (
  import_id      text primary key,
  modulo         text not null check (modulo in ('entradas', 'saidas')),
  arquivo        text,
  data_hora      text,
  registros      integer not null default 0,
  chunks         integer not null default 0,
  hashes         text[]  not null default '{}',
  versao         bigint  not null default 0,
  excluido       boolean not null default false,
  atualizado_por uuid default auth.uid(),
  atualizado_em  timestamptz not null default now()
);

alter table public.base_pacotes enable row level security;

-- admin + insumos escrevem; qualquer usuário logado lê.
create or replace function public.base_pode_editar()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'insumos'));
$$;

drop policy if exists base_pacotes_ler on public.base_pacotes;
create policy base_pacotes_ler on public.base_pacotes
  for select to authenticated using (true);
drop policy if exists base_pacotes_inserir on public.base_pacotes;
create policy base_pacotes_inserir on public.base_pacotes
  for insert to authenticated with check ((select public.base_pode_editar()));
drop policy if exists base_pacotes_alterar on public.base_pacotes;
create policy base_pacotes_alterar on public.base_pacotes
  for update to authenticated using ((select public.base_pode_editar())) with check ((select public.base_pode_editar()));
drop policy if exists base_pacotes_apagar on public.base_pacotes;
create policy base_pacotes_apagar on public.base_pacotes
  for delete to authenticated using ((select public.base_pode_editar()));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'base_pacotes'
  ) then
    alter publication supabase_realtime add table public.base_pacotes;
  end if;
end $$;

-- Bucket privado dos pacotes.
insert into storage.buckets (id, name, public)
values ('base-compartilhada', 'base-compartilhada', false)
on conflict (id) do nothing;

drop policy if exists base_compartilhada_ler on storage.objects;
create policy base_compartilhada_ler on storage.objects
  for select to authenticated using (bucket_id = 'base-compartilhada');
drop policy if exists base_compartilhada_inserir on storage.objects;
create policy base_compartilhada_inserir on storage.objects
  for insert to authenticated with check (bucket_id = 'base-compartilhada' and (select public.base_pode_editar()));
drop policy if exists base_compartilhada_alterar on storage.objects;
create policy base_compartilhada_alterar on storage.objects
  for update to authenticated using (bucket_id = 'base-compartilhada' and (select public.base_pode_editar()));
drop policy if exists base_compartilhada_apagar on storage.objects;
create policy base_compartilhada_apagar on storage.objects
  for delete to authenticated using (bucket_id = 'base-compartilhada' and (select public.base_pode_editar()));
