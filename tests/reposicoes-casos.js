// PROVA da aba Reposições: casos resolvidos à mão ("esp" escrito antes de rodar).
// Números em toneladas; o motor recebe kg. Usado por reposicoes.test.mjs.
const PV_TS = new Date(2026, 9, 10).getTime();
const PV_A = { cnpj: '11111111000100', f: 'Fornecedor A' }, PV_B = { cnpj: '22222222000100', f: 'Fornecedor B' }, PV_C = { cnpj: '33333333000100', f: 'Fornecedor C' };
const pvNf = (F, nf, t, x = {}) => ({ cnpj: F.cnpj, fornecedor: F.f, nf: String(nf), material: 'BRITA 1', qtd: t, um: 'TO', valor: t * 50, dt: '10/10/2026', ts: PV_TS, compra: 'CEN1', destino: 'CEN1', chave: '', ...x });
const pvM = (mov, t, ref = '') => ({ mov, kg: t * 1000, ref: String(ref), dt: '10/10/2026', ts: PV_TS });
const pvPar = (ini, fim, movs, x = {}) => ({ central: 'CEN1', regional: 'R', material: 'BRITA 1', sub: 'Graúdo', ym: '2026-10', estIniKg: ini == null ? null : ini * 1000, estIniFisKg: ini == null ? null : ini * 1000, estFimKg: fim == null ? null : fim * 1000, custoSap: 45, outroCod: '', movs, ...x });
const REP_PROVA = [
  { n: 1, t: 'Exemplo da pergunta 1', por: 'Est. Inicial 200, A 500, B 300, consumo 600. Teórico 200 + 500 + 300 − 600 = 400. Real 360. Desfalque 40. Base 1.000. A 50% = 20, B 30% = 12, estoque inicial 20% = 8.',
    par: pvPar(200, 360, [pvM('101', 500, 1), pvM('101', 300, 2), pvM('201', -600)]), nfs: [pvNf(PV_A, 1, 500), pvNf(PV_B, 2, 300)],
    esp: { estado: 'desfalque', desfalque: 40000, A: 20000, B: 12000, ini: 8000, valorA: 1000 } },
  { n: 2, t: 'Arredondamento fecha no quilo', por: 'Sem estoque inicial, A, B e C com 100 t cada, consumo 290. Teórico 10, Real 0. Desfalque 10.000 kg ÷ 3 = 3.333,33. O quilo que sobra vai para o primeiro da ordem: 3.334 + 3.333 + 3.333 = 10.000.',
    par: pvPar(0, 0, [pvM('101', 100, 1), pvM('101', 100, 2), pvM('101', 100, 3), pvM('201', -290)]), nfs: [pvNf(PV_A, 1, 100), pvNf(PV_B, 2, 100), pvNf(PV_C, 3, 100)],
    esp: { estado: 'desfalque', desfalque: 10000, A: 3334, B: 3333, C: 3333, ini: 0 } },
  { n: 3, t: 'Mês sem entrada de fornecedor', por: 'Est. Inicial 100, sem entradas, consumo 60. Teórico 40, Real 35. Desfalque 5, todo do estoque inicial.',
    par: pvPar(100, 35, [pvM('201', -60)]), nfs: [], esp: { estado: 'desfalque', desfalque: 5000, ini: 5000 } },
  { n: 4, t: 'Y12 de fechamento não esconde o desfalque', por: 'Igual ao caso 1, com Y12 de −40 t lançado no fechamento. Com ele a Variação daria zero; fora da conta, o desfalque continua 40.',
    par: pvPar(200, 360, [pvM('101', 500, 1), pvM('101', 300, 2), pvM('201', -600), pvM('Y12', -40)]), nfs: [pvNf(PV_A, 1, 500), pvNf(PV_B, 2, 300)],
    esp: { estado: 'desfalque', desfalque: 40000, A: 20000, B: 12000, ini: 8000 } },
  { n: 5, t: 'NF estornada (102) não conta', por: 'Est. Inicial 200, A 500 e mais uma NF de A de 100 lançada e estornada, B 300. A continua com 500. Mesmo resultado do caso 1.',
    par: pvPar(200, 360, [pvM('101', 500, 1), pvM('101', 100, 9), pvM('102', -100, 9), pvM('101', 300, 2), pvM('201', -600)]), nfs: [pvNf(PV_A, 1, 500), pvNf(PV_A, 9, 100), pvNf(PV_B, 2, 300)],
    esp: { estado: 'desfalque', desfalque: 40000, A: 20000, B: 12000, ini: 8000 } },
  { n: 6, t: 'Nota mãe não conta, filha conta', por: 'A tem nota mãe de 5.000 t (faturamento) e filha de 500 t (entrega). Só a filha está no SAP. Mesmo resultado do caso 1.',
    par: pvPar(200, 360, [pvM('101', 500, 1), pvM('101', 300, 2), pvM('201', -600)]), nfs: [pvNf(PV_A, 1, 5000, { fora: true }), pvNf(PV_A, 1, 500), pvNf(PV_B, 2, 300)],
    esp: { estado: 'desfalque', desfalque: 40000, A: 20000, B: 12000, ini: 8000, valorA: 1000 } },
  { n: 7, t: 'Transferência recebida sem NF', por: 'Est. Inicial 100, A 300, transferência (861) 100, consumo 400. Teórico 100, Real 90. Desfalque 10. Base 500. A 60% = 6, estoque inicial 20% = 2, sem fornecedor 20% = 2.',
    par: pvPar(100, 90, [pvM('101', 300, 1), pvM('861', 100), pvM('201', -400)]), nfs: [pvNf(PV_A, 1, 300)],
    esp: { estado: 'desfalque', desfalque: 10000, A: 6000, ini: 2000, sem: 2000 } },
  { n: 8, t: 'Transferência enviada não entra na base', por: 'Est. Inicial 100, A 300, enviou 100 (862), consumo 200. Teórico 100, Real 80. Desfalque 20. Base 400. A 75% = 15, estoque inicial 25% = 5.',
    par: pvPar(100, 80, [pvM('101', 300, 1), pvM('862', -100), pvM('201', -200)]), nfs: [pvNf(PV_A, 1, 300)],
    esp: { estado: 'desfalque', desfalque: 20000, A: 15000, ini: 5000 } },
  { n: 9, t: 'NF comprada na CEN2 com destino CEN1', por: 'A faturou 200 t na CEN2 com destino CEN1 (861 de 200 na CEN1). Est. Inicial 100, B 100, consumo 300. Teórico 100, Real 80. Desfalque 20. Base 400. A 50% = 10, B 25% = 5, estoque inicial 25% = 5.',
    par: pvPar(100, 80, [pvM('861', 200), pvM('101', 100, 2), pvM('201', -300)]), outros: [pvPar(0, 0, [pvM('101', 200, 7), pvM('862', -200)], { central: 'CEN2' })], nfs: [pvNf(PV_A, 7, 200, { compra: 'CEN2' }), pvNf(PV_B, 2, 100)],
    esp: { estado: 'desfalque', desfalque: 20000, A: 10000, B: 5000, ini: 5000 } },
  { n: 10, t: 'Filiais do mesmo fornecedor somam', por: 'A entrega por duas filiais (raiz igual): 200 + 300 = 500. B 300. Mesmo resultado do caso 1.',
    par: pvPar(200, 360, [pvM('101', 200, 1), pvM('101', 300, 5), pvM('101', 300, 2), pvM('201', -600)]), nfs: [pvNf(PV_A, 1, 200), pvNf({ cnpj: '11111111000291', f: 'Fornecedor A' }, 5, 300), pvNf(PV_B, 2, 300)],
    esp: { estado: 'desfalque', desfalque: 40000, A: 20000, B: 12000, ini: 8000 } },
  { n: 11, t: 'Preço com NF em m³', por: 'A vendeu 100 m³ por R$ 9.800. Fator 1.400 kg/m³ = 140 t, preço R$ 70,00/t. SAP 140 t, Est. Inicial 60, consumo 190. Teórico 10, Real 0. Desfalque 10. Base 200. A 70% = 7 t = R$ 490,00.',
    par: pvPar(60, 0, [pvM('101', 140, 1), pvM('201', -190)]), nfs: [pvNf(PV_A, 1, 100, { um: 'M3', valor: 9800 })],
    esp: { estado: 'desfalque', desfalque: 10000, A: 7000, ini: 3000, valorA: 490 } },
  { n: 12, t: 'Peso do SAP manda, NF só identifica', por: 'NF de A diz 520 t, SAP lançou 500 t. Participação usa 500. Valor da NF R$ 26.000 ÷ 520 = R$ 50/t. Mesmo resultado do caso 1.',
    par: pvPar(200, 360, [pvM('101', 500, 1), pvM('101', 300, 2), pvM('201', -600)]), nfs: [pvNf(PV_A, 1, 520), pvNf(PV_B, 2, 300)],
    esp: { estado: 'desfalque', desfalque: 40000, A: 20000, B: 12000, ini: 8000, valorA: 1000 } },
  { n: 13, repos: ['99'], t: 'NF de reposição vira saldo (já no SAP)', por: 'A repôs 20 t (NF 99, lançada no SAP). Est. Inicial 180, A 400, B 400, reposição 20, consumo 900. Teórico 100, Real 90. Desfalque 10. Base 1.000. A 40% = 4, B 4, estoque inicial 18% = 1,8, reposição 2% = 0,2.',
    par: pvPar(180, 90, [pvM('101', 400, 1), pvM('101', 400, 2), pvM('101', 20, 99), pvM('201', -900)]), nfs: [pvNf(PV_A, 1, 400), pvNf(PV_B, 2, 400), pvNf(PV_A, 99, 20, { valor: 0 })],
    esp: { estado: 'desfalque', desfalque: 10000, A: 4000, B: 4000, ini: 1800, repos: 200 } },
  { n: 14, repos: ['99'], t: 'NF de reposição vinculada e ainda fora do SAP não mexe na conta', por: 'Só vira saldo quando o SAP lança. Sem a entrada: Teórico 180 + 400 + 400 − 900 = 80, Real 75, desfalque 5. Base 980. A e B = 5.000 × 400 ÷ 980 = 2.040,8 → 2.041 cada; estoque inicial 918.',
    par: pvPar(180, 75, [pvM('101', 400, 1), pvM('101', 400, 2), pvM('201', -900)]), nfs: [pvNf(PV_A, 1, 400), pvNf(PV_B, 2, 400), pvNf(PV_A, 99, 20, { valor: 0 })],
    esp: { estado: 'desfalque', desfalque: 5000, A: 2041, B: 2041, ini: 918, repos: 0 } },
  { n: 15, t: 'Sobra não gera cobrança', por: 'Est. Inicial 200, A 500, consumo 600. Teórico 100, Real 130. Sobra de 30, nenhuma cota.',
    par: pvPar(200, 130, [pvM('101', 500, 1), pvM('201', -600)]), nfs: [pvNf(PV_A, 1, 500)], esp: { estado: 'sobra', desfalque: 0, A: 0, ini: 0 } },
  { n: 16, t: 'Est. Final ausente trava', por: 'Sem lançamento no último dia. No Inventário viraria desfalque do estoque inteiro (100 t). Aqui fica não negociável.',
    par: pvPar(200, null, [pvM('101', 500, 1), pvM('201', -600)]), nfs: [pvNf(PV_A, 1, 500)], esp: { estado: 'bloqueado', desfalque: 0 } },
  { n: 17, t: 'Est. Inicial ausente trava', por: 'Sem Custos SAP. Não negociável.', par: pvPar(null, 50, [pvM('101', 500, 1), pvM('201', -400)]), nfs: [pvNf(PV_A, 1, 500)], esp: { estado: 'bloqueado', desfalque: 0 } },
  { n: 18, t: 'Est. Inicial negativo trava', por: 'Livro SAP em −20 t. Não negociável.', par: pvPar(-20, 50, [pvM('101', 500, 1), pvM('201', -400)]), nfs: [pvNf(PV_A, 1, 500)], esp: { estado: 'bloqueado' } },
  { n: 19, t: 'Entrada no SAP sem NF nas Entradas trava', por: 'NF 8 está no SAP e não nas Entradas: não se sabe de quem é.', par: pvPar(200, 360, [pvM('101', 500, 1), pvM('101', 300, 8), pvM('201', -600)]), nfs: [pvNf(PV_A, 1, 500)], esp: { estado: 'bloqueado' } },
  { n: 20, t: 'Mesmo nº de NF em dois fornecedores trava', por: 'NF 1 existe em A e em B na mesma central e material.', par: pvPar(200, 360, [pvM('101', 800, 1), pvM('201', -600)]), nfs: [pvNf(PV_A, 1, 500), pvNf(PV_B, 1, 300)], esp: { estado: 'bloqueado' } },
  { n: 21, t: 'm³ sem fator trava', por: 'NF em m³ e nenhum fator cadastrado.', semFator: true, par: pvPar(60, 0, [pvM('101', 140, 1), pvM('201', -190)]), nfs: [pvNf(PV_A, 1, 100, { um: 'M3', valor: 9800 })], esp: { estado: 'bloqueado' } },
  { n: 22, t: 'NF lançada duas vezes no SAP trava', por: 'NF 1 de 500 t aparece duas vezes: infla o Teórico em 500 e cria desfalque falso.', par: pvPar(200, 360, [pvM('101', 500, 1), pvM('101', 500, 1), pvM('201', -600)]), nfs: [pvNf(PV_A, 1, 500)], esp: { estado: 'bloqueado' } },
  { n: 23, t: 'NF cancelada e duplicada não pesam', por: 'Entradas trazem a NF 1 repetida e uma NF cancelada de C. Preço de A continua R$ 50/t. Mesmo resultado do caso 1.',
    par: pvPar(200, 360, [pvM('101', 500, 1), pvM('101', 300, 2), pvM('201', -600)]), nfs: [pvNf(PV_A, 1, 500, { chave: 'x1' }), pvNf(PV_A, 1, 500, { chave: 'x1' }), pvNf(PV_B, 2, 300), pvNf(PV_C, 3, 400, { fora: true })],
    esp: { estado: 'desfalque', desfalque: 40000, A: 20000, B: 12000, C: 0, ini: 8000, valorA: 1000 } },
  { n: 24, t: 'Y12 no meio do mês também sai da conta', por: 'Igual ao caso 1, com um Y12 de −10 t lançado no dia 15. Se contasse, o desfalque cairia para 30. Fora da conta, continua 40.',
    par: pvPar(200, 360, [pvM('101', 500, 1), pvM('101', 300, 2), pvM('Y12', -10), pvM('201', -600)]), nfs: [pvNf(PV_A, 1, 500), pvNf(PV_B, 2, 300)],
    esp: { estado: 'desfalque', desfalque: 40000, A: 20000, B: 12000, ini: 8000 } },
  { n: 25, t: 'Y11 no meio do mês também sai da conta', por: 'Igual ao caso 1, com um Y11 de +10 t no dia 15. Se contasse, o desfalque subiria para 50 e o Y11 entraria na base. Fora da conta, continua 40.',
    par: pvPar(200, 360, [pvM('101', 500, 1), pvM('101', 300, 2), pvM('Y11', 10), pvM('201', -600)]), nfs: [pvNf(PV_A, 1, 500), pvNf(PV_B, 2, 300)],
    esp: { estado: 'desfalque', desfalque: 40000, A: 20000, B: 12000, ini: 8000, sem: 0 } },
  { n: 26, t: 'Mês anterior sem ajuste trava', por: 'Livro SAP abriu com 200 t e a contagem do fim do mês anterior era 190,6. As 9,4 t são de outro mês. Não negociável.',
    par: pvPar(200, 360, [pvM('101', 500, 1), pvM('201', -300)], { estIniFisKg: 190600 }), nfs: [pvNf(PV_A, 1, 500)], esp: { estado: 'bloqueado' } },
  { n: 27, t: 'Sem contagem no mês anterior trava', por: 'Não há como saber se o livro abriu certo. Não negociável.',
    par: pvPar(200, 360, [pvM('101', 500, 1), pvM('201', -300)], { estIniFisKg: null }), nfs: [pvNf(PV_A, 1, 500)], esp: { estado: 'bloqueado' } },
  { n: 28, t: 'Materiais diferentes não se compensam', por: 'Brita 1: Est. Inicial 100, A 400, consumo 400, Real 75. Desfalque 25, A 80% = 20. Areia: Est. Inicial 100, A 400, consumo 400, Real 110. Sobra 10. A deve 20 (e não 10).',
    par: pvPar(100, 75, [pvM('101', 400, 1), pvM('201', -400)]), soma: [pvPar(100, 110, [pvM('101', 400, 2), pvM('201', -400)], { material: 'AREIA' })], nfs: [pvNf(PV_A, 1, 400), pvNf(PV_A, 2, 400, { material: 'AREIA' })],
    esp: { estado: 'desfalque', desfalque: 25000, A: 20000, ini: 5000 } },
  { n: 29, t: 'Sobra de outro mês não abate', por: 'Mês 1: desfalque 25, A deve 20. Mês 2: sobra 8, A deve 0. No período de dois meses, A deve 20 (e não 12).',
    par: pvPar(100, 75, [pvM('101', 400, 1), pvM('201', -400)]), soma: [pvPar(100, 108, [pvM('101', 400, 1), pvM('201', -400)])], nfs: [pvNf(PV_A, 1, 400)],
    esp: { estado: 'desfalque', desfalque: 25000, A: 20000, ini: 5000 } },
  { n: 30, t: 'Índice do documento chega no mesmo valor', por: 'Caso 1 pelo índice: 40 ÷ 1.000 = 4% de falta. A entregou 500 × 4% = 20. Mesma cota, sem mostrar o volume de B nem o estoque inicial.',
    par: pvPar(200, 360, [pvM('101', 500, 1), pvM('101', 300, 2), pvM('201', -600)]), nfs: [pvNf(PV_A, 1, 500), pvNf(PV_B, 2, 300)], esp: { estado: 'desfalque', A: 20000, indice: 4, docA: 20000 } },
  { n: 31, t: 'Troca de depósito (311) não infla a base', por: 'Caso 1 com 311 de +50 e −50 t na mesma central. Saldo zero: nada muda.',
    par: pvPar(200, 360, [pvM('101', 500, 1), pvM('101', 300, 2), pvM('311', 50), pvM('311', -50), pvM('201', -600)]), nfs: [pvNf(PV_A, 1, 500), pvNf(PV_B, 2, 300)],
    esp: { estado: 'desfalque', desfalque: 40000, A: 20000, B: 12000, ini: 8000, sem: 0 } },
  { n: 32, t: 'NF sem CNPJ do fornecedor trava', por: 'Entradas antigas, importadas antes da coluna do CNPJ.',
    par: pvPar(200, 360, [pvM('101', 800, 1), pvM('201', -600)]), nfs: [pvNf({ cnpj: '', f: 'Fornecedor A' }, 1, 800)], esp: { estado: 'bloqueado' } },
  { n: 33, t: 'Mesmo nº de NF de outro fornecedor, um ano antes, não atrapalha', por: 'Fora da janela de 45 dias da data do SAP. Mesmo resultado do caso 1.',
    par: pvPar(200, 360, [pvM('101', 500, 1), pvM('101', 300, 2), pvM('201', -600)]), nfs: [pvNf(PV_A, 1, 500), pvNf(PV_B, 2, 300), pvNf(PV_C, 1, 400, { ts: new Date(2025, 9, 10).getTime() })],
    esp: { estado: 'desfalque', desfalque: 40000, A: 20000, B: 12000, C: 0, ini: 8000 } },
  { n: 34, t: 'Zeros e dígito do SAP no número da NF', por: 'SAP traz "0000001-7"; a NF é "1". Mesmo resultado do caso 1.',
    par: pvPar(200, 360, [pvM('101', 500, '0000001-7'), pvM('101', 300, '000002-1'), pvM('201', -600)]), nfs: [pvNf(PV_A, 1, 500), pvNf(PV_B, '2/1', 300)],
    esp: { estado: 'desfalque', desfalque: 40000, A: 20000, B: 12000, ini: 8000 } },
];

function repProvaRodar() {
  const alvo = (r, k) => k === 'indice' ? r.indice : k === 'docA' ? Math.round(r.partes.find(p => p.k === '11111111').kg * r.indice / 100) : k === 'estado' ? r.estado : k === 'desfalque' ? r.desfalqueKg
    : k === 'valorA' ? (r.partes.find(p => p.k === '11111111')?.valor ?? 0) : (r.partes.find(p => p.k === ({ A: '11111111', B: '22222222', C: '33333333' }[k] || k))?.cotaKg ?? 0);
  return REP_PROVA.map(c => {
    const nfs = c.nfs.map(n => ({ ...n, kg: n.um === 'TO' ? n.qtd * 1000 : c.semFator ? null : n.qtd * 1400 })), pares = [c.par, ...(c.outros || []), ...(c.soma || [])];
    const ctx = repPreparar(pares, repIndexar(nfs), (raiz, nf) => (c.repos || []).includes(nf));
    const r = repCalcular(c.par, ctx), mais = (c.soma || []).map(p => repCalcular(p, ctx));
    const obt = Object.fromEntries(Object.keys(c.esp).map(k => [k, 'ABC'.includes(k) ? [r, ...mais].reduce((s, x) => s + (x.estado === 'desfalque' ? alvo(x, k) : 0), 0) : alvo(r, k)]));
    const soma = r.partes.reduce((s, p) => s + p.cotaKg, 0);
    return { n: c.n, t: c.t, esp: c.esp, obt, motivos: r.motivos, ok: Object.keys(c.esp).every(k => obt[k] === c.esp[k]) && (soma === r.desfalqueKg || r.baseKg === 0) };
  });
}
