-- Entradas/Saídas: analista só consulta (decisão de 23/11/2026). Escrita
-- só para admin + insumos (public.base_pode_editar(), criada em
-- 20261118_base_compartilhada.sql) — espelha as travas do app
-- (_criarRegistroEntrada/_criarRegistroSaida, removerRegistro,
-- excluirSelecionados). O insumos só mexe no que é dele; o admin em tudo.
-- SELECT não muda (dono ou admin). Seguro rodar mais de uma vez.

do $$
declare t text;
begin
  foreach t in array array['entradas', 'saidas'] loop
    execute format('drop policy if exists %I on public.%I', t || '_insert_dono', t);
    execute format('create policy %I on public.%I for insert to authenticated
                      with check ((select public.base_pode_editar()) and (select auth.uid()) = user_id)', t || '_insert_dono', t);

    execute format('drop policy if exists %I on public.%I', t || '_update_dono_admin', t);
    execute format('create policy %I on public.%I for update to authenticated
                      using ((select public.base_pode_editar()) and ((select public.is_admin()) or (select auth.uid()) = user_id))', t || '_update_dono_admin', t);

    execute format('drop policy if exists %I on public.%I', t || '_delete_dono_admin', t);
    execute format('create policy %I on public.%I for delete to authenticated
                      using ((select public.base_pode_editar()) and ((select public.is_admin()) or (select auth.uid()) = user_id))', t || '_delete_dono_admin', t);
  end loop;
end $$;
