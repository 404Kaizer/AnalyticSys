-- Entradas/Saídas fora da trava de fechamento de período (decisão de
-- 18/11/2026 — espelha _periodoMesDoRegistro em js/ui.js). Recria as
-- policies de escrita SEM o _periodo_fechado_data_br(...), mantendo a
-- regra de dono/admin. SELECT não muda. Seguro rodar mais de uma vez.

do $$
declare t text;
begin
  foreach t in array array['entradas', 'saidas'] loop
    execute format('drop policy if exists %I on public.%I', t || '_insert_dono', t);
    execute format('create policy %I on public.%I for insert to authenticated
                      with check ((select auth.uid()) = user_id)', t || '_insert_dono', t);

    execute format('drop policy if exists %I on public.%I', t || '_update_dono_admin', t);
    execute format('create policy %I on public.%I for update to authenticated
                      using ((select public.is_admin()) or (select auth.uid()) = user_id)', t || '_update_dono_admin', t);

    execute format('drop policy if exists %I on public.%I', t || '_delete_dono_admin', t);
    execute format('create policy %I on public.%I for delete to authenticated
                      using ((select public.is_admin()) or (select auth.uid()) = user_id)', t || '_delete_dono_admin', t);
  end loop;
end $$;
