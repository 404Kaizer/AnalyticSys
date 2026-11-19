-- Padronização do ADM para o perfil INSUMOS (19/11/2026).
-- O INSUMOS não tem cadastro próprio de Centrais, Materiais e Fatores de conversão:
-- espelha ao vivo o do ADM (só consulta). A RLS dessas tabelas continua como está
-- (cada usuário lê só o que é dele); estas funções devolvem SÓ as linhas dos perfis
-- 'admin', e só para quem é admin ou insumos (base_pode_editar, da base compartilhada).
-- Seguro rodar mais de uma vez.

create or replace function public.padrao_adm_filiais()
returns setof public.filiais language sql stable security definer set search_path = public as $$
  select f.* from public.filiais f
  where public.base_pode_editar() and f.user_id in (select id from public.profiles where role = 'admin');
$$;

create or replace function public.padrao_adm_materiais()
returns setof public.materiais language sql stable security definer set search_path = public as $$
  select m.* from public.materiais m
  where public.base_pode_editar() and m.user_id in (select id from public.profiles where role = 'admin');
$$;

create or replace function public.padrao_adm_fatores_conversao()
returns setof public.fatores_conversao language sql stable security definer set search_path = public as $$
  select c.* from public.fatores_conversao c
  where public.base_pode_editar() and c.user_id in (select id from public.profiles where role = 'admin');
$$;

revoke all on function public.padrao_adm_filiais() from public, anon;
revoke all on function public.padrao_adm_materiais() from public, anon;
revoke all on function public.padrao_adm_fatores_conversao() from public, anon;
grant execute on function public.padrao_adm_filiais() to authenticated;
grant execute on function public.padrao_adm_materiais() to authenticated;
grant execute on function public.padrao_adm_fatores_conversao() to authenticated;
