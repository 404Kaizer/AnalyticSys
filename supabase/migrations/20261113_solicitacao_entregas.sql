-- Fornecedores da cubagem relacionados a CENTRAL + MATERIAL (13/11/2026).
-- Substitui a lista simples de nomes: cada linha diz que o fornecedor já
-- entregou aquele material (grupo SAP) naquela central, segundo as
-- Entradas do ADM (publicadas pelo navegador dele — solPublicarFornecedores).
-- A tabela antiga só tinha nomes republicados automaticamente — nada se
-- perde ao recriá-la. Seguro rodar mais de uma vez.

drop function if exists public.solicitacao_fornecedores_substituir(text[]);
drop table if exists public.solicitacao_fornecedores;

create table if not exists public.solicitacao_entregas (
  fornecedor    text not null,
  central       text not null,  -- mesmo nome que o formulário mostra (filiais.origem || alias)
  material      text not null,  -- grupo SAP (materiais.alias)
  atualizado_em timestamptz not null default now(),
  primary key (fornecedor, central, material)
);
alter table public.solicitacao_entregas enable row level security;
revoke all on public.solicitacao_entregas from anon;
drop policy if exists solicitacao_entregas_select on public.solicitacao_entregas;
create policy solicitacao_entregas_select on public.solicitacao_entregas for select to authenticated
  using (public.is_admin());

-- Substitui a relação inteira de uma vez (só ADM).
-- p_linhas: [{ "f": fornecedor, "c": central, "m": material }, ...]
create or replace function public.solicitacao_entregas_substituir(p_linhas jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  if not public.is_admin() then
    raise exception 'apenas o administrador publica as entregas';
  end if;
  delete from public.solicitacao_entregas where true;
  insert into public.solicitacao_entregas (fornecedor, central, material)
    select distinct trim(x->>'f'), trim(x->>'c'), trim(x->>'m')
    from jsonb_array_elements(p_linhas) x
    where coalesce(trim(x->>'f'), '') <> '' and coalesce(trim(x->>'c'), '') <> '' and coalesce(trim(x->>'m'), '') <> '';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.solicitacao_entregas_substituir(jsonb) from public, anon;
grant execute on function public.solicitacao_entregas_substituir(jsonb) to authenticated;
