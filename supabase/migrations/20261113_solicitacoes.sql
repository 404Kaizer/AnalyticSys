-- Solicitações do formulário público (solicitacao.html) — 13/11/2026.
-- Substitui a geração automática de DAI: a Edge Function solicitacao-dai
-- passa a gravar aqui (Service Role), um registro por categoria de
-- material, atribuído ao analista da categoria (analistas_categoria).

create table if not exists public.solicitacoes (
  id                 uuid primary key default gen_random_uuid(),
  protocolo          text not null,               -- comum aos registros do mesmo envio
  user_id            uuid not null references auth.users(id),
  analista_nome      text,
  categoria          text not null,               -- categoria de material
  status             text not null default 'pendente'
                     check (status in ('pendente', 'em_analise', 'concluida', 'recusada')),
  status_obs         text,
  status_por         text,
  status_em          timestamptz,
  central            text not null,
  cnpj_central       text,
  regional_central   text,
  data_ocorrido      date not null,
  categoria_situacao text not null,
  filial_destino     text,
  descricao          text not null,
  itens              jsonb not null default '[]',
  informantes        jsonb not null default '[]', -- { nome, cargo, contato, assinatura (path no bucket) }
  anexos             jsonb not null default '[]',
  sem_comprovante    boolean not null default false,
  created_at         timestamptz not null default now()
);
create index if not exists solicitacoes_user_created on public.solicitacoes (user_id, created_at desc);

alter table public.solicitacoes enable row level security;
revoke all on public.solicitacoes from anon;
revoke all on public.solicitacoes from authenticated;
grant select on public.solicitacoes to authenticated;
-- Analista só mexe no andamento — o conteúdo declarado pelo operador é imutável.
grant update (status, status_obs, status_por, status_em) on public.solicitacoes to authenticated;

create policy solicitacoes_select on public.solicitacoes for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy solicitacoes_update on public.solicitacoes for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- Fornecedores de agregados publicados a partir das Entradas do ADM (que
-- vivem só no IndexedDB dele). Lido pela Edge Function (Service Role).
create table if not exists public.solicitacao_fornecedores (
  nome          text primary key,
  atualizado_em timestamptz not null default now()
);
alter table public.solicitacao_fornecedores enable row level security;
revoke all on public.solicitacao_fornecedores from anon;
create policy solicitacao_fornecedores_select on public.solicitacao_fornecedores for select to authenticated
  using (public.is_admin());

-- Substitui a lista inteira de uma vez (só ADM).
create or replace function public.solicitacao_fornecedores_substituir(p_nomes text[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  if not public.is_admin() then
    raise exception 'apenas o administrador publica fornecedores';
  end if;
  delete from public.solicitacao_fornecedores where true;
  insert into public.solicitacao_fornecedores (nome)
    select distinct trim(x) from unnest(p_nomes) x where trim(coalesce(x, '')) <> '';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.solicitacao_fornecedores_substituir(text[]) from public, anon;
grant execute on function public.solicitacao_fornecedores_substituir(text[]) to authenticated;
