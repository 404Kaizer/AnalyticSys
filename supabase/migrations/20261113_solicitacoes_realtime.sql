-- Solicitações em tempo real na tela do analista (js/solicitacoes.js,
-- solRealtimeInit). O Realtime respeita a RLS de SELECT: cada analista só
-- recebe as suas; o ADM recebe todas. Seguro rodar mais de uma vez.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'solicitacoes'
  ) then
    alter publication supabase_realtime add table public.solicitacoes;
  end if;
end $$;
