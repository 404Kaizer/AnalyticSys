-- Aba Reposições (ADM + INSUMOS): rateio do desfalque de agregados entre os
-- fornecedores (ver js/reposicoes.js e js/reposicoes-motor.js). Seguro rodar
-- mais de uma vez.
--   rep_publicacoes : resultado de um mês FECHADO calculado pelo ADM (JSON gzip em
--                     base64), versionado. É o que o INSUMOS vê (ele não tem SAP
--                     nem Lançamentos). Só o ADM grava; ninguém altera nem apaga.
--   rep_negociacoes : negociação por fornecedor (raiz do CNPJ) × mês. "congelado"
--                     são os números do dia da abertura: o banco recusa mudá-los.
-- Acesso: base_pode_editar() (= admin + insumos); publicar e apagar = is_admin().

create table if not exists public.rep_publicacoes (
  ym             text not null check (ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  versao         int  not null check (versao > 0),
  payload        text not null,
  hash           text not null,
  resumo         jsonb not null default '{}',
  publicado_por  uuid not null default auth.uid(),
  publicado_nome text,
  publicado_em   timestamptz not null default now(),
  primary key (ym, versao)
);

create table if not exists public.rep_negociacoes (
  raiz            text not null check (raiz ~ '^[0-9]{8}$'),
  ym              text not null check (ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  nome            text not null,
  status          text not null default 'negociando'
                  check (status in ('negociando', 'acordada', 'concluida', 'sem_acordo')),
  congelado       jsonb not null,
  dados           jsonb not null default '{}',
  criado_por      uuid not null default auth.uid(),
  criado_nome     text,
  criado_em       timestamptz not null default now(),
  atualizado_por  uuid default auth.uid(),
  atualizado_nome text,
  atualizado_em   timestamptz not null default now(),
  primary key (raiz, ym)
);

create or replace function public.rep_negociacoes_trava()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.congelado is distinct from old.congelado
     or new.raiz <> old.raiz or new.ym <> old.ym
     or new.criado_em <> old.criado_em or new.criado_por <> old.criado_por then
    raise exception 'Os numeros congelados da negociacao nao podem ser alterados.';
  end if;
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end $$;
drop trigger if exists rep_negociacoes_trava on public.rep_negociacoes;
create trigger rep_negociacoes_trava before update on public.rep_negociacoes
  for each row execute function public.rep_negociacoes_trava();

alter table public.rep_publicacoes enable row level security;
drop policy if exists rep_publicacoes_ler on public.rep_publicacoes;
create policy rep_publicacoes_ler on public.rep_publicacoes
  for select to authenticated using ((select public.base_pode_editar()));
drop policy if exists rep_publicacoes_inserir on public.rep_publicacoes;
create policy rep_publicacoes_inserir on public.rep_publicacoes
  for insert to authenticated with check ((select public.is_admin()) and publicado_por = (select auth.uid()));

alter table public.rep_negociacoes enable row level security;
drop policy if exists rep_negociacoes_ler on public.rep_negociacoes;
create policy rep_negociacoes_ler on public.rep_negociacoes
  for select to authenticated using ((select public.base_pode_editar()));
drop policy if exists rep_negociacoes_inserir on public.rep_negociacoes;
create policy rep_negociacoes_inserir on public.rep_negociacoes
  for insert to authenticated with check ((select public.base_pode_editar()));
drop policy if exists rep_negociacoes_alterar on public.rep_negociacoes;
create policy rep_negociacoes_alterar on public.rep_negociacoes
  for update to authenticated using ((select public.base_pode_editar())) with check ((select public.base_pode_editar()));
drop policy if exists rep_negociacoes_apagar on public.rep_negociacoes;
create policy rep_negociacoes_apagar on public.rep_negociacoes
  for delete to authenticated using ((select public.is_admin()));

-- Realtime só na negociação (a publicação leva payload grande; a tela confere
-- as versões ao abrir e ao voltar o foco da janela).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rep_negociacoes'
  ) then
    alter publication supabase_realtime add table public.rep_negociacoes;
  end if;
end $$;
