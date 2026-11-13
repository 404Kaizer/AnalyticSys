-- Motivo da "Coleta de material" (13/11/2026): as duas coletas antigas
-- (contaminado / substituição) viraram uma só situação + motivo.
-- Rodar ANTES do deploy da Edge Function que grava a coluna.
-- Seguro rodar mais de uma vez.
alter table public.solicitacoes add column if not exists motivo text;
