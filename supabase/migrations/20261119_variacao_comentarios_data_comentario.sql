-- Data do comentário (19/11/2026): campo próprio no modal de Comentários de
-- Variação, escolhido pelo analista (a coluna `data` é a DATA DA VARIAÇÃO).
-- Comentários antigos recebem o dia em que foram registrados (created_at,
-- no fuso de Brasília).
-- Rodar ANTES do deploy do front (o app passa a gravar a coluna).
-- Seguro rodar mais de uma vez.
alter table public.variacao_comentarios add column if not exists data_comentario date;
update public.variacao_comentarios
   set data_comentario = (created_at at time zone 'America/Sao_Paulo')::date
 where data_comentario is null and created_at is not null;
