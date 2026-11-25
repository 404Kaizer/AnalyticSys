'use strict';

// ══════════════════════════════════════════════════════════════════════
// REPOSIÇÕES — motor do rateio e coleta dos dados (tela: reposicoes.js).
// Regras: decisões do Hugo de 25/11/2026. Prova: tests/reposicoes.test.mjs.
//
// 1ª parte: conta PURA (nada de state, DOM ou banco). Pesos em gramas
// inteiras (BigInt) e cotas em kg inteiros: a soma das cotas é sempre
// exatamente o desfalque.
//   Desfalque = Teórico − Real, por central × material × mês.
//     Teórico = Est. Inicial (livro SAP) + movimentos SAP do mês, SEM nenhum
//     Y11/Y12 (nem de fechamento, nem do meio do mês).
//   Base = Est. Inicial + entradas. Participação = peso do fornecedor ÷ base.
//   A parte do Est. Inicial, da transferência sem fornecedor e da NF de
//   reposição fica com a central (não é cobrada).
//   Peso = SAP; a NF só diz de quem é. Fornecedor = raiz do CNPJ.
//   Qualquer dado faltando ou suspeito TRAVA o item (fora dos totais).
// ══════════════════════════════════════════════════════════════════════

const _rpG = kg => BigInt(Math.round((Number(kg) || 0) * 1000));
const _rpKg = g => Number(g) / 1000;
// "000642190-1" → "642190" (dígito do SAP sai); "949920/1" → "949920" (série sai).
function repNumNf(v) {
  let s = String(v ?? '').trim().toUpperCase().split('/')[0];
  const i = s.lastIndexOf('-');
  if (i > 0) s = s.slice(0, i);
  return s.replace(/\D/g, '').replace(/^0+/, '') || '0';
}
const repRaiz = c => String(c || '').replace(/\D/g, '').slice(0, 8);
const REP_COMPRA = new Set(['101', '801', '102', '802']);   // compra e o estorno dela
const REP_TRANSF = new Set(['861', '863']);                 // transferência recebida e o estorno
// Consumo e transferência ENVIADA (com os estornos): sempre saída, com qualquer sinal.
const REP_SAIDA = new Set(['201', '202', '862', '864']);
// Os demais são somados por família (código + estorno): 311/312 é troca de depósito
// (+x e −x na mesma central) e não pode inflar a base; só o saldo a mais é entrada.
const REP_FAMILIA = { 302: '301', 304: '303', 306: '305', 310: '309', 312: '311', 552: '551' };
const REP_JANELA = 45 * 86400000;                           // NF × SAP: mesmo número só vale se a data for próxima

// Divide totalKg na proporção dos pesos (g). Maior resto; empate: maior peso, depois a ordem.
function repRatear(totalKg, pesos) {
  const base = pesos.reduce((s, p) => s + p, 0n), T = BigInt(totalKg);
  if (base <= 0n) return pesos.map(() => 0);
  const q = pesos.map((p, i) => ({ i, p, v: T * p / base, r: T * p % base }));
  let falta = Number(T - q.reduce((s, x) => s + x.v, 0n));
  [...q].sort((a, b) => a.r === b.r ? (a.p === b.p ? a.i - b.i : (a.p > b.p ? -1 : 1)) : (a.r > b.r ? -1 : 1))
    .forEach(x => { if (falta > 0) { x.v += 1n; falta--; } });
  return q.map(x => Number(x.v));
}

// Índice das NFs por central × material × número. Cada NF:
//   { cnpj, fornecedor, nf, material, um, qtd, kg (null = sem fator), valor, ts, dt, compra, destino, chave, fora }
// fora = nota mãe, cancelada, devolvida… (não identifica nem forma preço).
function repIndexar(nfs) {
  const porNum = new Map(), vistas = new Set();
  nfs.forEach(n => {
    if (n.fora) return;
    const dup = (n.chave || repRaiz(n.cnpj) + '|' + repNumNf(n.nf) + '|' + n.ts) + '|' + n.material + '|' + n.qtd;
    if (vistas.has(dup)) return;
    vistas.add(dup);
    new Set([n.compra, n.destino]).forEach(c => {
      if (!c) return;
      const k = c + '|' + n.material + '|' + repNumNf(n.nf);
      (porNum.get(k) || porNum.set(k, []).get(k)).push(n);
    });
  });
  return porNum;
}

// Entradas de compra do par, líquidas de estorno, por nº de NF.
function _rpPorNf(par) {
  const o = new Map();
  par.movs.forEach(m => {
    if (!REP_COMPRA.has(m.mov)) return;
    const k = repNumNf(m.ref), x = o.get(k) || o.set(k, { g: 0n, rows: [] }).get(k);
    x.g += _rpG(m.kg); x.rows.push(m);
  });
  return o;
}
function _rpCands(par, num, rows, porNum) {
  const ts = rows.find(m => m.kg > 0)?.ts ?? rows[0].ts;
  return (porNum.get(par.central + '|' + par.material + '|' + num) || []).filter(n => !n.ts || !ts || Math.abs(n.ts - ts) <= REP_JANELA);
}

// Contexto do mês: NFs lançadas na central de compra com destino em OUTRA
// central contam no destino, com o peso do SAP da compra.
//   ehRepos(raiz, num, central, material) → a NF está vinculada a uma negociação como reposição.
function repPreparar(pares, porNum, ehRepos = () => false) {
  const chegam = new Map();
  pares.forEach(par => {
    for (const [num, o] of _rpPorNf(par)) {
      if (o.g <= 0n) continue;
      const c = _rpCands(par, num, o.rows, porNum);
      if (!c.length || !c.every(n => n.destino && n.destino !== par.central) || new Set(c.map(n => n.destino)).size > 1 || new Set(c.map(n => repRaiz(n.cnpj))).size > 1) continue;
      const k = c[0].destino + '|' + par.material;
      (chegam.get(k) || chegam.set(k, []).get(k)).push({ num, g: o.g, cands: c, via: par.central });
    }
  });
  return { porNum, ehRepos, chegam };
}

// par: { central, regional, material, sub, ym, estIniKg, estIniFisKg, estFimKg, custoSap (R$/t), outroCod, movs }
//   movs: [{ mov (normMov), kg, ref, dt, ts }] — movimentos SAP do mês.
// Resultado só com números e textos (vai para o JSON publicado); não guarda movs.
function repCalcular(par, ctx) {
  const motivos = [], avisos = [];
  const trava = (c, t) => motivos.push({ c, t });
  const semIni = par.estIniKg == null, semFim = par.estFimKg == null;
  if (semIni) trava('ini', 'Est. Inicial ausente (sem Custos SAP ou sem Cód SAP)');
  else {
    if (par.estIniKg < 0) trava('ini_neg', 'Est. Inicial negativo no SAP');
    if (par.estIniFisKg == null) trava('sem_cont_ant', 'Sem contagem no fim do mês anterior: não dá para conferir o Est. Inicial');
    else {
      const d = par.estIniKg - par.estIniFisKg;
      if (Math.abs(d) >= 1) trava('mes_ant', `Mês anterior sem ajuste: o livro SAP abriu ${(Math.abs(d) / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} t ${d > 0 ? 'acima' : 'abaixo'} da contagem`);
    }
  }
  if (semFim) trava('fim', `Est. Final ausente: falta o lançamento${par.fimEsperado ? ' de ' + par.fimEsperado : ' do último dia do mês'}`);
  if (par.outroCod) trava('cod', `Material com outro Cód SAP com saldo nesta central (${par.outroCod})`);

  // 1. Movimentos que valem: tudo, menos Y11/Y12.
  const ehAju = m => m.mov === 'Y11' || m.mov === 'Y12', movs = par.movs.filter(m => !ehAju(m));
  const fechG = par.movs.filter(ehAju).reduce((s, m) => s + _rpG(m.kg), 0n);
  const ini = semIni ? 0n : _rpG(par.estIniKg);

  // 2. Separa as entradas por NF e por fornecedor.
  let transfG = 0n, outrasG = 0n, saidasG = 0n;
  const fam = new Map();
  movs.forEach(m => {
    const g = _rpG(m.kg);
    if (REP_COMPRA.has(m.mov)) return;
    if (REP_TRANSF.has(m.mov)) transfG += g;
    else if (REP_SAIDA.has(m.mov)) saidasG += g;
    else { const k = REP_FAMILIA[m.mov] || m.mov; fam.set(k, (fam.get(k) || 0n) + g); }
  });
  fam.forEach(g => { if (g > 0n) outrasG += g; else saidasG += g; });
  const forn = new Map(), doForn = n => { const k = repRaiz(n.cnpj); return forn.get(k) || forn.set(k, { tipo: 'forn', k, nome: n.fornecedor, g: 0n, nfs: [] }).get(k); };
  const soma = (a, f) => a.reduce((s, n) => s + (f(n) || 0), 0);
  let reposG = 0n, passagemG = 0n;
  const nfsRepos = [];
  for (const [num, o] of _rpPorNf(par)) {
    if (o.g === 0n) continue;                                                  // NF estornada inteira
    if (num === '0') { trava('sem_nf', 'Entrada no SAP sem número de NF'); continue; }
    const cands = _rpCands(par, num, o.rows, ctx.porNum);
    if (!cands.length) { trava('sem_forn', `NF ${num} está no SAP e não foi achada nas Entradas`); motivos[motivos.length - 1].nf = num; continue; }
    const raizes = new Set(cands.map(n => repRaiz(n.cnpj)));
    if ([...raizes].some(x => x.length !== 8)) { trava('sem_cnpj', `NF ${num} está nas Entradas sem CNPJ do fornecedor (reimporte as Entradas)`); continue; }
    if (raizes.size > 1) { trava('dois_forn', `NF ${num} existe em dois fornecedores: não dá para saber de quem é`); continue; }
    if (o.g < 0n) { trava('neg', `NF ${num} com saldo negativo no SAP (estorno maior que a entrada)`); continue; }
    if (cands.some(n => n.kg == null)) trava('fator', `NF ${num} em ${cands.find(n => n.kg == null).um || 'unidade vazia'} sem fator de conversão nas Configurações`);
    const pesoNf = cands.some(n => n.kg == null) ? null : soma(cands, n => n.kg), pos = o.rows.filter(m => m.kg > 0);
    if (pesoNf && pos.length > 1 && new Set(pos.map(m => m.kg)).size === 1 && _rpKg(o.g) > pesoNf * 1.5) trava('dup', `NF ${num} parece lançada ${pos.length} vezes no SAP`);
    const reg = { nf: num, dt: pos[0]?.dt || '', kg: _rpKg(o.g), pesoNf, um: cands[0].um, qtd: soma(cands, n => n.qtd), valor: soma(cands, n => n.valor) };
    if (o.rows.some(m => m.kg < 0)) reg.est = 1;
    if (ctx.ehRepos([...raizes][0], num, par.central, par.material)) { reposG += o.g; nfsRepos.push(reg); continue; }   // reposição = saldo
    const fora = cands.filter(n => n.destino && n.destino !== par.central), dests = new Set(fora.map(n => n.destino));
    if (fora.length === cands.length && dests.size === 1) { passagemG += o.g; continue; }                               // só passa por aqui
    if (fora.length) { trava('dois_dest', `NF ${num} com dois destinos diferentes`); continue; }
    const f = doForn(cands[0]);
    f.g += o.g; f.nfs.push(reg);
  }
  // NF lançada em outra central com destino aqui: chega como 861.
  let chegouG = 0n;
  (ctx.chegam.get(par.central + '|' + par.material) || []).forEach(x => {
    const raiz = repRaiz(x.cands[0].cnpj);
    if (raiz.length !== 8) { trava('sem_cnpj', `NF ${x.num} está nas Entradas sem CNPJ do fornecedor (reimporte as Entradas)`); return; }
    chegouG += x.g;
    const semF = x.cands.some(n => n.kg == null);
    if (semF) trava('fator', `NF ${x.num} em ${x.cands[0].um} sem fator de conversão nas Configurações`);
    const reg = { nf: x.num, dt: x.cands[0].dt || '', kg: _rpKg(x.g), pesoNf: semF ? null : soma(x.cands, n => n.kg), um: x.cands[0].um, qtd: soma(x.cands, n => n.qtd), valor: soma(x.cands, n => n.valor), via: x.via };
    if (ctx.ehRepos(raiz, x.num, par.central, par.material)) { reposG += x.g; nfsRepos.push(reg); return; }
    const f = doForn(x.cands[0]);
    f.g += x.g; f.nfs.push(reg);
  });
  if (chegouG > transfG) trava('transf', 'NF com destino nesta central sem a transferência (861) completa no SAP');
  const semFornG = (transfG > chegouG ? transfG - chegouG : 0n) + outrasG;

  // 3. Desfalque = Teórico − Real (só quando falta material).
  const teo = ini + movs.reduce((s, m) => s + _rpG(m.kg), 0n), real = semFim ? 0n : _rpG(par.estFimKg), dif = teo - real;
  const arred = g => Number((g + 500n) / 1000n);
  let desfalqueKg = 0, sobraKg = 0;
  if (!semIni && !semFim) { if (dif > 0n) desfalqueKg = arred(dif); else sobraKg = arred(-dif); }

  // 4. Base = Est. Inicial + entradas. 5. Participação. 6. Cota em kg.
  const lista = [...forn.values()].filter(f => f.g > 0n).sort((a, b) => a.g === b.g ? (a.k < b.k ? -1 : 1) : (a.g > b.g ? -1 : 1));
  const partes = [{ tipo: 'ini', k: 'ini', nome: 'Estoque inicial', g: ini > 0n ? ini : 0n, nfs: [] }, ...lista];
  if (reposG > 0n) partes.push({ tipo: 'repos', k: 'repos', nome: 'Saldo de reposição', g: reposG, nfs: nfsRepos });
  if (semFornG > 0n) partes.push({ tipo: 'sem', k: 'sem', nome: 'Sem fornecedor', g: semFornG, nfs: [] });
  const base = partes.reduce((s, p) => s + p.g, 0n);
  if (desfalqueKg > 0 && base <= 0n) trava('base', 'Sem estoque inicial e sem entradas para ratear');
  const cotas = repRatear(desfalqueKg, partes.map(p => p.g));
  const out = partes.map((p, i) => {
    const x = { tipo: p.tipo, k: p.k, nome: p.nome, kg: _rpKg(p.g), pct: base > 0n ? Number(p.g * 1000000000n / base) / 1e7 : 0, cotaKg: cotas[i], nfs: p.nfs };
    if (p.tipo !== 'forn') return x;
    // 7. Preço médio das NFs do próprio fornecedor (R$/t), com a NF convertida.
    const tn = soma(p.nfs, n => n.pesoNf), vl = soma(p.nfs, n => n.valor);
    x.preco = tn > 0 && vl > 0 ? vl / tn * 1000 : null;
    x.precoRef = par.custoSap || null;
    x.valor = Math.round(x.cotaKg * (x.preco ?? x.precoRef ?? 0) / 10) / 100;
    if (x.preco === null) avisos.push(`${p.nome} sem preço nas NFs do mês: ${x.precoRef ? 'usado o Custos SAP' : 'valor zerado (também não há Custos SAP)'}.`);
    else if (x.precoRef && (x.preco > x.precoRef * 2 || x.preco < x.precoRef / 2)) avisos.push(`Preço de ${p.nome} (R$ ${x.preco.toFixed(2)}/t) muito diferente do Custos SAP (R$ ${x.precoRef.toFixed(2)}/t): confira a unidade e o fator das NFs.`);
    if (tn > 0 && Math.abs(x.kg / tn - 1) > 0.1) avisos.push(`${p.nome}: o peso do SAP está ${((x.kg / tn - 1) * 100).toFixed(1).replace('.', ',')}% diferente do peso das NFs convertidas.`);
    return x;
  });
  const { movs: _m, ...parLimpo } = par;
  return {
    par: parLimpo, motivos, avisos, partes: out, desfalqueKg, sobraKg,
    iniKg: _rpKg(ini), teoKg: _rpKg(teo), realKg: _rpKg(real), saidasKg: _rpKg(saidasG), passagemKg: _rpKg(passagemG), reposKg: _rpKg(reposG),
    fechKg: _rpKg(fechG), baseKg: _rpKg(base),
    indice: base > 0n ? desfalqueKg * 1000 / Number(base) * 100 : 0,   // kg a repor por 100 kg entregues: igual para todos, não revela o volume de ninguém
    estado: motivos.length ? 'bloqueado' : desfalqueKg > 0 ? 'desfalque' : sobraKg > 0 ? 'sobra' : 'zero',
  };
}

// ══════════════════════════════════════════════════════════════════════
// COLETA — do state para os pares do motor (só no navegador do ADM).
// Um índice compacto por central × material (movimentos por mês) refeito só
// quando a base muda; cada mês sai dele sem reler o SAP inteiro.
// ══════════════════════════════════════════════════════════════════════
const _RPB = { chave: '', pares: null, nfs: null, porNum: null, meses: null, custos: null, matCods: null };

const _rpYm = s => { s = String(s || ''); return s.length === 10 ? (s[2] === '/' ? s.slice(6) + '-' + s.slice(3, 5) : s[4] === '-' ? s.slice(0, 7) : '') : ''; };
const _rpYmMais = (ym, n) => { const [a, m] = ym.split('-').map(Number), d = new Date(a, m - 1 + n, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };

function repBaseChave() {
  const t = a => (a || []).length + ':' + (a?.[0]?.id || '') + ':' + (a?.[a.length - 1]?.id || '');
  return [t(state.sap), t(state.entradas), t(state.lancamentos), t(state.custosSap), t(state.materiais), t(state.filiais),
    typeof _materialLookupVersion === 'undefined' ? '' : _materialLookupVersion, typeof _filialLookupVersion === 'undefined' ? '' : _filialLookupVersion,
    (state.fatoresConversao || []).map(f => [f.grupo, f.fornecedor, f.umOrigem, f.fator].join(':')).join(',')].join('|');
}
function repBaseDescartar() { _RPB.chave = ''; _RPB.pares = null; }

// foraChaves: chaves de acesso (44) e 'cnpj|número' de nota mãe, cancelada, devolvida…
async function repBaseMontar(foraChaves, progresso = () => {}) {
  const chave = repBaseChave() + '|' + foraChaves.size;
  if (_RPB.pares && _RPB.chave === chave && _RPB.sapRef === state.sap && _RPB.entRef === state.entradas) return _RPB;
  let pausa = performance.now();
  const cede = async txt => { if (performance.now() - pausa > 50) { progresso(txt); await yieldToUI(); pausa = performance.now(); } };
  const catMat = new Map(), ehAgr = m => { let v = catMat.get(m); if (v === undefined) catMat.set(m, v = getCatKeyDoCadastro(m) === 'agregado'); return v; };
  const catOrig = new Map(), temCad = m => { let v = catOrig.get(m); if (v === undefined) catOrig.set(m, v = !!getCatKeyDoCadastro(m)); return v; };
  const filIdx = getFilialLookupIndex(), pares = new Map(), meses = new Set();
  const novo = (central, material) => ({
    central, material, regional: (filIdx.exact.get(normalizeText(central))?.regional || '').trim() || 'Sem regional',
    sub: /MI[UÚ]DO/i.test(getCategoriaPorGrupo(material)) ? 'Miúdo' : 'Graúdo', codSap: getCodSapPorGrupo(material),
    movs: new Map(), somaG: new Map(),
  });
  let n = 0;
  for (const [central, mats] of getSapIndex().byCentralMat) {
    if (!central || central === '—') continue;
    for (const [mat, arr] of mats) {
      if (!ehAgr(mat)) continue;
      const p = novo(central, mat);
      pares.set(central + '|' + mat, p);
      for (const r of arr) {
        const ym = _rpYm(r.dtLanc);
        if (!ym) continue;
        const kg = num(r.peso);
        if (!kg) continue;
        p.somaG.set(ym, (p.somaG.get(ym) || 0) + Math.round(kg * 1000));      // Est. Inicial: TODOS os movimentos (inclusive Y11/Y12)
        if (!temCad(r.materialOriginal)) continue;                           // mesmo corte do Inventário
        (p.movs.get(ym) || p.movs.set(ym, []).get(ym)).push(r);
        meses.add(ym);
      }
      if ((++n & 15) === 0) await cede('Lendo o SAP…');
    }
  }
  for (const [central, mats] of getLancIndex().byCentralMat) {
    if (!central || central === '—') continue;
    for (const mat of mats.keys()) if (ehAgr(mat) && !pares.has(central + '|' + mat)) pares.set(central + '|' + mat, novo(central, mat));
  }
  // NFs (Entradas) de agregado.
  const ents = state.entradas || [], nfs = [], fatorUn = new Map();
  for (let i = 0; i < ents.length; i++) {
    if ((i & 0x1fff) === 0) await cede(`Lendo as Entradas… ${Math.round(i / ents.length * 100)}%`);
    const r = ents[i];
    if (!r.nf || r.nf === '—' || !ehAgr(r.material)) continue;
    const qtd = Math.abs(num(r.peso));
    if (!qtd) continue;
    const ck = (r.um || '') + '|' + r.material + '|' + (r.fornecedor || '');
    let f = fatorUn.get(ck);
    if (f === undefined) {
      const canon = _normalizarUM(r.um);
      f = canon === 'KG' ? 1 : canon === 'TO' ? 1000 : canon ? (_nfNeedsConversionWarning(r.um, r.material, r.fornecedor) ? null : _convertNfPesoToKg(1, r.um, r.material, r.fornecedor)) : null;
      fatorUn.set(ck, f);
    }
    const cnpj = r.cnpjFornecedor || '', dt = (r.dtDescarga && r.dtDescarga !== '—') ? r.dtDescarga : r.dtEmissao;
    nfs.push({
      cnpj, fornecedor: r.fornecedor || '—', nf: r.nf, material: r.material, um: r.um || '', qtd, kg: f == null ? null : qtd * f,
      valor: Math.abs(num(r.valorTotal)) || qtd * Math.abs(num(r.custo)), ts: parseDateTs(dt), dt, chave: r.chave || '',
      compra: r.centralCompra && r.centralCompra !== '—' ? r.centralCompra : '', destino: r.centralDestino && r.centralDestino !== '—' ? r.centralDestino : '',
      fora: (r.chave && foraChaves.has(r.chave)) || (cnpj && foraChaves.has(cnpj + '|' + _baseNumNf(r.nf))),
    });
  }
  // Códigos SAP de cada material (mais de um pode esconder parte do Est. Inicial).
  const matCods = new Map();
  (state.materiais || []).forEach(m => { const c = normalizarCodSap(m.codSap); if (m.alias && c) (matCods.get(m.alias) || matCods.set(m.alias, new Set()).get(m.alias)).add(c); });
  Object.assign(_RPB, { chave, pares, nfs, porNum: repIndexar(nfs), meses: [...meses].sort(), custos: buildCustosSapIndex(), matCods, sapRef: state.sap, entRef: state.entradas });
  return _RPB;
}

// Est. Inicial de 1º de ym: âncora do Custos SAP (mês anterior, com cascata) +
// movimentos SAP até a véspera. Mesma conta de _anGetSapTheoreticalStock
// (Inventário/Visão Micro), só que pelas somas mensais já prontas.
function repEstIni(p, ym, custos) {
  if (!p.codSap) return null;
  const ant = _rpYmMais(ym, -1), [a, m] = ant.split('-').map(Number);
  const anc = getEstoqueSapCustosSap(p.central, p.codSap, a, m, custos);
  if (!anc) return null;
  let g = Math.round(anc.valor * 1000);
  const de = anc.ano + '-' + String(anc.mes).padStart(2, '0');
  for (const [k, v] of p.somaG) if (k > de && k < ym) g += v;
  return { kg: g / 1000, ancora: String(anc.mes).padStart(2, '0') + '/' + anc.ano };
}

// Pares do mês prontos para o motor. Mês ainda correndo (prévia): cada par vai
// até a última contagem dele no mês, e só os movimentos até esse dia contam.
function repParesDoMes(B, ym, hoje = new Date()) {
  const [a, m] = ym.split('-').map(Number), dtIni = new Date(a, m - 1, 1), dtFim = new Date(a, m, 0), antFim = new Date(a, m - 1, 0), antIni = new Date(a, m - 2, 1);
  const correndo = dtFim >= new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()), out = [];
  for (const p of B.pares.values()) {
    const recs = p.movs.get(ym) || [], lancs = getLancIndex().byCentralMat.get(p.central)?.get(p.material) || [];
    let fim, corte = null;
    if (correndo) {
      const doMes = lancs.filter(r => _rpYm(r.dtLanc) === ym && parseDateTs(r.dtLanc) <= hoje.getTime());
      if (doMes.length) {
        corte = Math.max(...doMes.map(r => parseDateTs(r.dtLanc)));
        fim = { value: doMes.filter(r => parseDateTs(r.dtLanc) === corte).reduce((s, r) => s + num(r.peso), 0), dtLabel: fmtPtDate(new Date(corte)) };
      }
    } else { const x = getLastPeriodLaunchStockWithFallback({ central: p.central, material: p.material, dtIni, dtFim }); fim = x && !x.missing ? x : { falta: x?.expectedLabel }; }
    if (!recs.length && (!fim || fim.value == null)) continue;                      // sem movimento e sem contagem: não há o que analisar
    const ini = repEstIni(p, ym, B.custos), ant = getLastPeriodLaunchStockWithFallback({ central: p.central, material: p.material, dtIni: antIni, dtFim: antFim });
    const custo = p.codSap ? getCustoMedioCustosSap(p.central, p.codSap, a, m, B.custos) : null;
    const outros = [...(B.matCods.get(p.material) || [])].filter(c => c !== normalizarCodSap(p.codSap))
      .filter(c => { const e = getEstoqueSapCustosSap(p.central, c, antFim.getFullYear(), antFim.getMonth() + 1, B.custos); return e && Math.abs(e.valor) >= 1; });
    const movs = [];
    recs.forEach(r => { const ts = parseDateTs(r.dtLanc); if (corte == null || ts <= corte) movs.push({ mov: normMov(r.movimento), kg: num(r.peso), ref: r.ref || '', dt: r.dtLanc, ts }); });
    out.push({
      central: p.central, regional: p.regional, material: p.material, sub: p.sub, ym, estIniKg: ini ? ini.kg : null, ancora: ini?.ancora || '',
      estIniFisKg: ant && !ant.missing ? ant.value : null, antEsperado: ant?.expectedLabel || '', estFimKg: fim?.value ?? null, fimData: fim?.dtLabel || '', fimEsperado: fim?.falta || '',
      custoSap: custo ? custo.valor * 1000 : null, outroCod: outros.join(', '), movs,
    });
  }
  return out;
}

// Por que a NF do SAP não foi achada: olha as Entradas inteiras pelo número.
function repExplicarSemForn(res) {
  const alvo = new Map();
  res.forEach(r => r.motivos.forEach(x => { if (x.c === 'sem_forn') (alvo.get(x.nf) || alvo.set(x.nf, []).get(x.nf)).push({ r, x }); }));
  if (!alvo.size) return;
  const achou = new Map();
  for (const e of state.entradas || []) {
    const n = repNumNf(e.nf);
    if (alvo.has(n)) (achou.get(n) || achou.set(n, []).get(n)).push(e);
  }
  alvo.forEach((lista, n) => lista.forEach(({ r, x }) => {
    const perto = (achou.get(n) || []).filter(e => { const t = parseDateTs(e.dtDescarga && e.dtDescarga !== '—' ? e.dtDescarga : e.dtEmissao), [a, m] = r.par.ym.split('-').map(Number); return t && Math.abs(t - new Date(a, m - 1, 15).getTime()) <= REP_JANELA + 15 * 86400000; });
    const aqui = perto.filter(e => e.centralCompra === r.par.central || e.centralDestino === r.par.central);
    if (aqui.length) { x.c = 'outro_mat'; x.t = `NF ${n} está nas Entradas com outro material: ${[...new Set(aqui.map(e => e.material))].slice(0, 2).join(', ')}`; }
    else if (perto.some(e => e.material === r.par.material)) { x.c = 'outra_cen'; x.t = `NF ${n} está nas Entradas em outra central: ${[...new Set(perto.filter(e => e.material === r.par.material).map(e => e.centralDestino || e.centralCompra))].slice(0, 2).join(', ')}`; }
  }));
}

// Mês inteiro: pares → motor. ehRepos vem das negociações.
function repCalcularMes(B, ym, ehRepos) {
  const pares = repParesDoMes(B, ym), ctx = repPreparar(pares, B.porNum, ehRepos);
  const res = pares.map(p => repCalcular(p, ctx));
  repExplicarSemForn(res);
  return res;
}
