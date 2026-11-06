// Diagnóstico do Est. Final do Dashboard Gerencial (temporário, apagar depois).
// Uso: abra o Gerencial no mês com problema, clique em Atualizar, abra o
// console (F12), cole este arquivo inteiro e tecle Enter. O relatório vai
// pra área de transferência — é só colar (Ctrl+V) no chat.
(() => {
  const ano = _dgMonthState.selectedYear, mes = _dgMonthState.selectedMonth + 1;
  const d = window._dgVgLastData;
  if (!d || !d.pares) return console.warn('Rode o Gerencial antes (Atualizar).');
  const fmt = v => Math.round(v).toLocaleString('pt-BR');
  const idx = buildCustosSapIndex();
  const chave = (c, cod) => String(c || '').trim() + '|||' + normalizarCodSap(cod) + '|||' + ano + '|||' + mes;

  const usados = new Map();
  let somaGer = 0, semCod = 0, semCodN = 0, deOutroMes = 0;
  d.pares.forEach(p => {
    somaGer += p.estoqueFim || 0;
    const cod = getCodSapPorGrupo(p.mat);
    if (!cod) { semCod += p.estoqueFim || 0; semCodN++; return; }
    const k = chave(p.central, cod);
    if (idx.has(k)) usados.set(k, [...(usados.get(k) || []), p]);
    else deOutroMes += p.estoqueFim || 0;
  });

  let somaCs = 0, somaUsados = 0;
  const fora = [];
  (state.custosSap || []).filter(r => +r.ano === ano && +r.mes === mes).forEach(r => {
    const v = num(r.estoqueTotal);
    somaCs += v;
    const k = chave(r.central, r.material);
    let motivo = null;
    if (idx.get(k) !== r) motivo = 'DUPLICADO (mesma central+codigo+mes, so o 1o conta)';
    else if (!usados.has(k)) {
      const orig = r.materialOriginal || r.material;
      const codGrupo = getCodSapPorGrupo(orig);
      motivo = !getCatKeyDoCadastro(orig) ? 'codigo SEM cadastro/categoria em Materiais'
        : (codGrupo && normalizarCodSap(codGrupo) !== normalizarCodSap(r.material)) ? 'grupo aponta pra OUTRO Cod SAP (' + codGrupo + ')'
        : 'material nunca lancado nessa central (fora do escopo)';
    } else somaUsados += v;
    if (motivo) fora.push({ motivo, central: r.central, codigo: r.material, grupo: normalizarMaterial(r.materialOriginal || r.material), kg: v });
  });

  // Registro usado por mais de um par (dois grupos com o mesmo Cód SAP na mesma central) — conta dobrado.
  let dobradoKg = 0;
  const dobrados = [...usados].filter(([, ps]) => ps.length > 1).map(([k, ps]) => {
    const v = num(idx.get(k).estoqueTotal);
    dobradoKg += v * (ps.length - 1);
    return k.split('|||').slice(0, 2).join(' / ') + ' -> ' + ps.map(p => p.mat).join(' + ') + ' (' + fmt(v) + ' kg cada)';
  });

  const out = [];
  out.push('DIAGNOSTICO EST. FINAL — ' + String(mes).padStart(2, '0') + '/' + ano + ' — modo ' + (_dgEstIniMode === 'lanc' ? 'CALCULADO' : 'IMPORTADO'));
  out.push('Custos SAP do mes (soma): ' + fmt(somaCs));
  out.push('Gerencial Est. Final Total: ' + fmt(somaGer));
  out.push('Diferenca: ' + fmt(somaCs - somaGer));
  out.push('  registros do Custos SAP usados pelo Gerencial: ' + fmt(somaUsados));
  out.push('  registros do Custos SAP NAO usados: ' + fmt(fora.reduce((s, x) => s + x.kg, 0)) + ' (' + fora.length + ')');
  out.push('  contado dobrado (mesmo codigo em 2+ materiais): ' + fmt(dobradoKg));
  out.push('  pares vindos de outro mes: ' + fmt(deOutroMes));
  out.push('  pares sem Cod SAP: ' + fmt(semCod) + ' (' + semCodN + ' pares)');
  out.push('');
  out.push('NAO USADOS POR MOTIVO:');
  const porMotivo = {};
  fora.forEach(x => { porMotivo[x.motivo] = (porMotivo[x.motivo] || [0, 0]); porMotivo[x.motivo][0] += x.kg; porMotivo[x.motivo][1]++; });
  Object.entries(porMotivo).forEach(([m, [kg, n]]) => out.push('  ' + m + ': ' + fmt(kg) + ' kg (' + n + ')'));
  out.push('');
  out.push('NAO USADOS POR CODIGO (codigo | grupo | n centrais | kg | motivo):');
  const porCod = new Map();
  fora.forEach(x => {
    const c = porCod.get(x.codigo) || { grupo: x.grupo, motivo: x.motivo, n: 0, kg: 0, centrais: [] };
    c.n++; c.kg += x.kg; c.centrais.push(x.central + '=' + fmt(x.kg));
    porCod.set(x.codigo, c);
  });
  [...porCod].sort((a, b) => Math.abs(b[1].kg) - Math.abs(a[1].kg)).forEach(([cod, c]) =>
    out.push('  ' + cod + ' | ' + c.grupo + ' | ' + c.n + ' | ' + fmt(c.kg) + ' | ' + c.motivo + (cod !== '13' && c.n <= 15 ? '\n      ' + c.centrais.join(', ') : '')));
  const sem13 = fora.filter(x => normalizarCodSap(x.codigo) !== '13');
  out.push('');
  out.push('Custos SAP do mes SEM o codigo 13: ' + fmt(somaCs - fora.filter(x => normalizarCodSap(x.codigo) === '13').reduce((s, x) => s + x.kg, 0)));
  out.push('Nao usados SEM o codigo 13: ' + fmt(sem13.reduce((s, x) => s + x.kg, 0)) + ' (' + sem13.length + ' registros)');
  if (dobrados.length) { out.push(''); out.push('CONTADOS DOBRADO:'); dobrados.forEach(t => out.push('  ' + t)); }

  const texto = out.join('\n');
  console.log(texto);
  try { copy(texto); console.log('%cRelatorio copiado — cole no chat com Ctrl+V.', 'font-weight:bold;color:green'); }
  catch (e) { console.log('Nao consegui copiar sozinho: selecione o texto acima e copie.'); }
})();
