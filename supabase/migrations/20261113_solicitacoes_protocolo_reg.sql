-- Protocolo SOL- → REG- (13/11/2026): o formulário virou "Registro
-- Operacional". A Edge Function já gera REG-; aqui renomeia os antigos.
-- Os arquivos de assinatura continuam no caminho antigo (o path gravado em
-- informantes[].assinatura não muda) — só o número exibido muda.
-- Seguro rodar mais de uma vez.
update public.solicitacoes
   set protocolo = 'REG-' || substring(protocolo from 5)
 where protocolo like 'SOL-%';
