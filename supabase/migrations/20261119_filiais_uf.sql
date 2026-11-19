-- UF da central (19/11/2026): estado de cada filial, usado no quadro
-- "Onde este material tem uso" da aba Sem uso (só centrais do mesmo estado).
-- Preenchida pelo botão "Preencher UF" (Configurações › Centrais), que
-- consulta o CNPJ na BrasilAPI, ou à mão no cadastro.
-- Rodar ANTES do deploy do front (o app passa a ler/gravar a coluna).
-- Seguro rodar mais de uma vez.
alter table public.filiais add column if not exists uf text;
