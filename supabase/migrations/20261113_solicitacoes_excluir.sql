-- Registros: excluir (tirar da lista) + limpar excluídos (apagar de vez) — 13/11/2026.
-- "Excluir" é só um status ('excluida', com observação em status_obs) — o
-- analista já tem UPDATE nas colunas de status. "Limpar excluídos" apaga de
-- vez, via RPC (authenticated não tem DELETE na tabela).
-- Seguro rodar mais de uma vez.

alter table public.solicitacoes drop constraint if exists solicitacoes_status_check;
alter table public.solicitacoes add constraint solicitacoes_status_check
  check (status in ('pendente', 'em_analise', 'concluida', 'recusada', 'excluida'));

-- Apaga os excluídos que o usuário enxerga (o dele; o ADM, todos).
-- ponytail: as assinaturas/anexos no bucket solicitacoes-anexos ficam lá
-- (privado, sem nenhuma linha apontando) — apagar arquivo exige a Storage
-- API com Service Role; se precisar, vira uma ação na Edge Function.
create or replace function public.solicitacoes_limpar_excluidas()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  delete from public.solicitacoes
   where status = 'excluida'
     and (user_id = auth.uid() or public.is_admin());
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.solicitacoes_limpar_excluidas() from public, anon;
grant execute on function public.solicitacoes_limpar_excluidas() to authenticated;
