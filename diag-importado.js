// Diagnóstico do Dashboard Gerencial — modo IMPORTADO (temporário, apagar depois).
// Uso: abra o Gerencial no mês com problema, modo Importado, clique em
// Atualizar, abra o console (F12) e cole este arquivo inteiro.
(() => {
  const ano = _dgMonthState.selectedYear, mes = _dgMonthState.selectedMonth + 1;
  const d = window._dgVgLastData;
  if (!d || !d.pares) return console.warn('Rode o Gerencial antes (Atualizar).');
  const fmt = v => Math.round(v).toLocaleString('pt-BR');
  const idx = buildCustosSapIndex();
  const chave = (c, cod) => String(c || '').trim() + '|||' + normalizarCodSap(cod) + '|||' + ano + '|||' + mes;

  // ── 1. Est. Final Total: Gerencial × Custos SAP do mês ──
  const usados = new Map();
  let somaGer = 0, semCod = 0, deOutroMes = 0;
  const paresOutroMes = [];
  d.pares.forEach(p => {
    somaGer += p.estoqueFim || 0;
    const cod = getCodSapPorGrupo(p.mat);
    if (!cod) { semCod += p.estoqueFim || 0; return; }
    const k = chave(p.central, cod);
    if (idx.has(k)) usados.set(k, [...(usados.get(k) || []), p.mat]);
    else { deOutroMes += p.estoqueFim || 0; paresOutroMes.push({ central: p.central, material: p.mat, kg: fmt(p.estoqueFim || 0) }); }
  });
  let somaCs = 0;
  const fora = [];
  (state.custosSap || []).filter(r => +r.ano === ano && +r.mes === mes).forEach(r => {
    const v = num(r.estoqueTotal);
    somaCs += v;
    const k = chave(r.central, r.material);
    let motivo = null;
    if (idx.get(k) !== r) motivo = 'registro DUPLICADO (mesma central+código+mês) — só o 1º conta';
    else if (!usados.has(k)) {
      const orig = r.materialOriginal || r.material;
      const cad = getCatKeyDoCadastro(orig);
      const codGrupo = getCodSapPorGrupo(orig);
      motivo = !cad ? 'código SEM cadastro/categoria em Materiais'
        : (codGrupo && normalizarCodSap(codGrupo) !== normalizarCodSap(r.material)) ? `grupo do código aponta pra OUTRO Cód SAP (${codGrupo})`
        : 'material nunca lançado nessa central (fora do escopo do Gerencial)';
    }
    if (motivo) fora.push({ motivo, central: r.central, codigo: r.material, grupo: normalizarMaterial(r.materialOriginal || r.material), kg: v });
  });
  const dobrados = [...usados].filter(([, m]) => m.length > 1)
    .map(([k, m]) => ({ chave: k, materiais: m.join(' + '), kgContadoVezes: m.length, kg: fmt(num(idx.get(k).estoqueTotal)) }));

  console.log('%c1) EST. FINAL TOTAL', 'font-weight:bold;font-size:14px');
  console.table({
    'Custos SAP do mês (soma)': fmt(somaCs),
    'Gerencial (Est. Final Total)': fmt(somaGer),
    'Diferença': fmt(somaCs - somaGer),
    'Registros do Custos SAP que o Gerencial NÃO usou': fmt(fora.reduce((s, x) => s + x.kg, 0)),
    'Pares do Gerencial vindos de OUTRO mês (cascata)': fmt(deOutroMes),
    'Pares do Gerencial sem Cód SAP': fmt(semCod)
  });
  const porMotivo = {};
  fora.forEach(x => { porMotivo[x.motivo] = (porMotivo[x.motivo] || 0) + x.kg; });
  console.table(Object.entries(porMotivo).map(([motivo, kg]) => ({ motivo, kg: fmt(kg) })));
  console.table(fora.sort((a, b) => Math.abs(b.kg) - Math.abs(a.kg)).slice(0, 40).map(x => ({ ...x, kg: fmt(x.kg) })));
  if (dobrados.length) { console.log('Mesmo registro contado em mais de um material:'); console.table(dobrados); }
  if (paresOutroMes.length) { console.log('Pares sem registro neste mês (Est. Final veio de mês anterior):'); console.table(paresOutroMes.slice(0, 40)); }

  // ── 2. Custo Var.: maiores contribuições por par ──
  const custoTotal = d.pares.reduce((s, p) => s + (p.custoImplicado || 0), 0);
  console.log('%c2) CUSTO VAR. = ' + money(custoTotal), 'font-weight:bold;font-size:14px');
  console.table([...d.pares].sort((a, b) => Math.abs(b.custoImplicado) - Math.abs(a.custoImplicado)).slice(0, 30).map(p => ({
    central: p.central, material: p.mat,
    estIni: fmt(p.estoqueIni), ent: fmt(p.entKg), sai: fmt(p.saiKg), aju: fmt(p.ajuKg),
    estFim: fmt(p.estoqueFim), variacao: fmt(p.diff), custoMed: p.custoMed, custoVar: money(p.custoImplicado)
  })));
})();
