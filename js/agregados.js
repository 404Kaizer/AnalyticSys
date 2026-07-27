// ═══════════════════════════════════════════════════════════
// CONTROLE DE CORTE DE AGREGADOS
// Regra: agregados (categoria contém "AGREGADO") só podem ser
// pedidos até o último dia útil antes da última semana do mês.
// ═══════════════════════════════════════════════════════════

// ── Helpers de data ─────────────────────────────────────
function _agrIsWeekend(d) { const dw = d.getDay(); return dw === 0 || dw === 6; }

function _agrLastDayOfMonth(year, month) {
  return new Date(year, month + 1, 0);
}

function _agrFirstWeekdayOfMonth(year, month) {
  const d = new Date(year, month, 1);
  while (_agrIsWeekend(d)) d.setDate(d.getDate() + 1);
  return new Date(d);
}

// Last weekday before the last calendar week of the month.
// "Last week" = the 7-day block ending on the last day of the month.
function _agrCutoffDate(year, month) {
  const lastDay = _agrLastDayOfMonth(year, month);
  // Find Monday of the last week
  const dow = lastDay.getDay(); // 0=Sun … 6=Sat
  const daysToMon = dow === 0 ? 6 : dow - 1;
  const lastMon = new Date(lastDay);
  lastMon.setDate(lastDay.getDate() - daysToMon);

  // Cutoff = last weekday strictly before lastMon
  const cutoff = new Date(lastMon);
  cutoff.setDate(cutoff.getDate() - 1);
  while (_agrIsWeekend(cutoff)) cutoff.setDate(cutoff.getDate() - 1);
  return cutoff;
}

function _agrFmtDate(d) {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function _agrDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function _agrParseEntradaDate(e) {
  // prefer dtDescarga, fallback dtEmissao
  const raw = e.dtDescarga || e.dtEmissao || '';
  return parseDate(raw);
}

// ── Category check ───────────────────────────────────────
function _isAgregado(entrada) {
  return (entrada.categoria || '').toUpperCase().includes('AGREGADO');
}

// ── UM normalization ────────────────────────────────────
function _agrNormUM(um) {
  const u = (um || '').toUpperCase().trim();
  if (u === 'TON' || u === 'T' || u === 'TONELADA' || u === 'TONELADAS') return 'TON';
  if (u === 'M3' || u === 'M³' || u === 'M ³' || u === 'METRO CUBICO' || u === 'METROS CUBICOS') return 'M3';
  if (u === 'KG' || u === 'QUILOGRAMA' || u === 'KGS') return 'KG';
  return u || 'TON'; // default for entradas
}

// Smart decimal: show up to 3 decimals only if non-zero fractional part
function _agrSmartFmt(val) {
  if (!Number.isFinite(val)) return '—';
  // Check how many decimals are needed (max 3)
  const dec = val % 1 === 0 ? 0 : String(Math.round(val * 1000) / 1000).replace(/.*\./, '').replace(/0+$/, '').length;
  const d = Math.min(3, Math.max(1, dec));
  return val.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
}

// Format a weight+UM for display
function _agrFmtWeight(val, um) {
  if (val == null || !Number.isFinite(val)) return '—';
  if (um === 'M3')  return _agrSmartFmt(val) + ' m³';
  if (um === 'TON') return _agrSmartFmt(val) + ' t';
  if (um === 'KG')  return _agrSmartFmt(val) + ' kg';
  return _agrSmartFmt(val) + ' ' + um;
}

// Format lançamento stock: KG → TON
function _agrFmtStock(kg) {
  if (kg == null) return '—';
  return _agrSmartFmt(kg / 1000) + ' t';
}

// ── Main compute ─────────────────────────────────────────
function _agrCompute(dtIni, dtFim) {
  const year  = dtIni.getFullYear();
  const month = dtIni.getMonth();

  const firstDay  = _agrFirstWeekdayOfMonth(year, month);
  const lastDay   = _agrLastDayOfMonth(year, month);

  // Data de corte: o analista pode sobrepor manualmente o cálculo automático
  // (window._agrManualCutoffISO, controlado pelo input #agr-corte-manual-input em
  // index.html). Só é aceita se cair dentro do mês computado — fora disso, ou se
  // não houver valor definido, cai no cálculo automático de sempre.
  let cutoff = _agrCutoffDate(year, month);
  let cutoffManual = false;
  if (window._agrManualCutoffISO) {
    const [my, mm, md] = window._agrManualCutoffISO.split('-').map(Number);
    const manualDate = new Date(my, (mm || 1) - 1, md || 1);
    if (!isNaN(manualDate) && manualDate >= firstDay && manualDate <= lastDay) {
      cutoff = manualDate;
      cutoffManual = true;
    }
  }

  // Filter entradas: agregados in this month
  const entradas = (state.entradas || []).filter(e => {
    if (!_isAgregado(e)) return false;
    const d = _agrParseEntradaDate(e);
    if (!d) return false;
    return d >= firstDay && d <= lastDay;
  });

  // Group by centralDestino → material
  const byCentral = new Map();
  entradas.forEach(e => {
    const central  = e.centralDestino || e.centralCompra || '—';
    const material = e.material || '—';
    // Use normalizeText for grouping key so it matches the index keys
    const cKey = normalizeText(central);
    const mKey = normalizeText(material);
    if (!byCentral.has(cKey)) byCentral.set(cKey, { label: central, byMat: new Map() });
    const byMat = byCentral.get(cKey).byMat;
    if (!byMat.has(mKey)) byMat.set(mKey, { label: material, pre: [], pos: [] });
    const d = _agrParseEntradaDate(e);
    if (d <= cutoff) byMat.get(mKey).pre.push(e);
    else             byMat.get(mKey).pos.push(e);
  });

  // ── Pré-indexação: evita varredura linear O(n) por central+material ──
  // Usa normalizeText() para garantir que acentos, espaços e capitalização não causem mismatch
  const _nk = (c, m) => normalizeText(c) + '|' + normalizeText(m);

  // Índice de lançamentos: Map<"CENTRAL|MATERIAL", [{rec, dateKey}]> ordenado por data desc
  const _lancIdx = new Map();
  for (const l of (state.lancamentos || [])) {
    const d = parseDate(l.dtLanc);
    if (!d) continue;
    const k = _nk(l.central || '', l.material || '');
    if (!_lancIdx.has(k)) _lancIdx.set(k, []);
    _lancIdx.get(k).push({ rec: l, dateKey: _agrDateKey(d) });
  }
  for (const arr of _lancIdx.values()) arr.sort((a, b) => b.dateKey.localeCompare(a.dateKey));

  // Índice de saídas: Map<"CENTRAL|MATERIAL", [{dateKey, peso}]>
  const _saiIdx = new Map();
  for (const s of (state.saidas || [])) {
    const d = parseDate(s.dtEmissao) || parseDate(s.dtDescarga) || parseDate(s.dtLanc);
    if (!d) continue;
    const dk   = _agrDateKey(d);
    const peso = num(s.peso);
    const mat  = s.material || '';
    // Index under every central variant the record may carry
    const centrals = new Set([s.central, s.centralCompra, s.centralDestino].filter(Boolean));
    for (const c of centrals) {
      const k = _nk(c, mat);
      if (!_saiIdx.has(k)) _saiIdx.set(k, []);
      _saiIdx.get(k).push({ dateKey: dk, peso });
    }
  }

  // Last lançamento on or before a date
  function _lastStock(central, material, beforeDate) {
    const arr = _lancIdx.get(_nk(central, material));
    if (!arr) return null;
    const key = _agrDateKey(beforeDate);
    const found = arr.find(e => e.dateKey <= key);
    return found ? found.rec : null;
  }

  // Consumo in date range
  function _consumo(central, material, fromDate, toDate) {
    const arr = _saiIdx.get(_nk(central, material));
    if (!arr) return { totalKg: 0, count: 0 };
    const fromKey = _agrDateKey(fromDate);
    const toKey   = _agrDateKey(toDate);
    let totalKg = 0, count = 0;
    for (const e of arr) {
      if (e.dateKey >= fromKey && e.dateKey <= toKey) { totalKg += e.peso; count++; }
    }
    return { totalKg, count };
  }

  // Average truck weight — unchanged (already O(n) on small per-material array)
  function _avgTruckWeight(central, material, allPre, allPos) {
    const all = [...allPre, ...allPos];
    if (!all.length) return null;
    return all.reduce((s, e) => s + (num(e.peso) || 0), 0) / all.length;
  }

  // Build result per central
  const centrais = [];
  for (const [cKey, { label: central, byMat }] of byCentral) {
    const mats = [];
    let centralPreKg = 0, centralPosKg = 0;

    for (const [mKey, { label: material, pre, pos }] of byMat) {
      // Group by UM (TON / M3 separately)
      const umGroups = {}; // { 'TON': { pre: [], pos: [] }, 'M3': { ... } }
      [...pre.map(e => ({ e, period: 'pre' })), ...pos.map(e => ({ e, period: 'pos' }))].forEach(({ e, period }) => {
        const um = _agrNormUM(e.um);
        if (!umGroups[um]) umGroups[um] = { pre: [], pos: [] };
        umGroups[um][period].push(e);
      });

      // For % and carreta calc: use TON as base unit (convert M3 is not meaningful,
      // so we track each UM independently and sum TON-equivalent for central totals)
      // Central totals use raw peso regardless of UM (both represent "quantity ordered")
      const preRaw = pre.reduce((s, e) => s + num(e.peso), 0);
      const posRaw = pos.reduce((s, e) => s + num(e.peso), 0);
      const pctPos = preRaw > 0 ? (posRaw / preRaw) * 100 : (posRaw > 0 ? Infinity : 0);

      // Avg truck weight per UM group
      const avgTruckByUM = {};
      Object.entries(umGroups).forEach(([um, { pre: p, pos: ps }]) => {
        const all = [...p, ...ps];
        avgTruckByUM[um] = all.length ? all.reduce((s, e) => s + num(e.peso), 0) / all.length : null;
      });

      // Build UM-grouped display data
      const umRows = Object.entries(umGroups).map(([um, { pre: p, pos: ps }]) => {
        const preVal = p.reduce((s, e) => s + num(e.peso), 0);
        const posVal = ps.reduce((s, e) => s + num(e.peso), 0);
        const avg    = avgTruckByUM[um];
        return {
          um,
          preVal, posVal,
          preCarretas: avg ? preVal / avg : null,
          posCarretas: avg ? posVal / avg : null,
          preCount: p.length, posCount: ps.length,
        };
      });

      // Stocks (from lançamentos, always KG → display as TON)
      const stockPreLanc = _lastStock(central, material, cutoff);
      const stockPosLanc = _lastStock(central, material, lastDay);

      // Consumo (from saídas, KG → display as TON)
      // Use 1st of month (not firstDay/first weekday) — saídas can happen any day
      const monthStart = new Date(year, month, 1);
      const nextDay    = new Date(cutoff.getTime() + 86400000);
      const consumoPre = _consumo(central, material, monthStart, cutoff);
      const consumoPos = _consumo(central, material, nextDay, lastDay);

      // Central totals: accumulate raw peso for sorting/% purposes
      centralPreKg += preRaw;
      centralPosKg += posRaw;

      mats.push({
        material, preRaw, posRaw, pctPos, umRows,
        stockPreKg:   stockPreLanc ? num(stockPreLanc.peso) : null,
        stockPreDate: stockPreLanc ? stockPreLanc.dtLanc    : null,
        stockPosKg:   stockPosLanc ? num(stockPosLanc.peso) : null,
        stockPosDate: stockPosLanc ? stockPosLanc.dtLanc    : null,
        consumoPreKg: consumoPre.totalKg, consumoPreCount: consumoPre.count,
        consumoPosKg: consumoPos.totalKg, consumoPosCount: consumoPos.count,
        preCount: pre.length, posCount: pos.length,
      });
    }

    mats.sort((a, b) => b.posRaw - a.posRaw);
    const pctPosCentral   = centralPreKg > 0 ? (centralPosKg / centralPreKg) * 100 : (centralPosKg > 0 ? Infinity : 0);
    const totalConsumoPosKg = mats.reduce((s, m) => s + (m.consumoPosKg || 0), 0);
    const matsComPos      = mats.filter(m => m.posRaw > 0);
    const injustificados  = matsComPos.filter(m => m.consumoPosKg <= 0).length;
    const parciais        = matsComPos.filter(m => m.consumoPosKg > 0 && (m.consumoPosKg / 1000) < m.posRaw * 0.95).length;
    const justificados    = matsComPos.filter(m => m.consumoPosKg > 0 && (m.consumoPosKg / 1000) >= m.posRaw * 0.95).length;

    centrais.push({ central, mats, centralPreKg, centralPosKg, pctPosCentral, totalConsumoPosKg, injustificados, parciais, justificados });
  }

  // ── Score ponderado de criticidade ───────────────────────────────
  // Injustificado        = 3 pts  (pediu, não usou nada)
  // Parcial < 50%        = 2 pts  (usou menos da metade)
  // Parcial 50–94%       = 1 pt   (usou bastante mas não tudo)
  // Justificado / sem pedido pós = 0 pts
  //
  // Faixas: score ≥ 6 → CRÍTICO | 1–5 → ATENÇÃO | 0 → OK
  function _agrScore(c) {
    if (c.centralPosKg === 0) return 0;
    return c.mats.reduce((total, m) => {
      if (m.posRaw <= 0) return total;
      const consumoTon = m.consumoPosKg / 1000;
      if (consumoTon <= 0)            return total + 3; // injustificado
      const aproveit = consumoTon / m.posRaw;
      if (aproveit < 0.50)            return total + 2; // parcial ruim
      if (aproveit < 0.95)            return total + 1; // parcial ok
      return total;                                      // justificado
    }, 0);
  }

  function _agrCriticidade(score) {
    if (score >= 6) return 'critico';
    if (score >= 1) return 'atencao';
    return 'ok';
  }

  centrais.forEach(c => {
    c.score       = _agrScore(c);
    c.criticidade = _agrCriticidade(c.score);
  });

  centrais.sort((a, b) => {
    // Ordena por score desc (maior gravidade primeiro)
    if (b.score !== a.score) return b.score - a.score;
    return b.centralPosKg - a.centralPosKg;
  });

  return { centrais, cutoff, firstDay, lastDay, cutoffManual, entradasFiltradas: entradas };
}

// ═══════════════════════════════════════════════════════════
// RESUMO POR REGIONAL — Média/dia Pré × Pós, por usina e consolidado
// Reaproveita a mesma lista de entradas (categoria AGREGADO, já filtrada
// por período em _agrCompute) e a mesma data de corte — só reagrupa por
// dia e por central/regional, sem tocar em lançamentos/saídas (isso só é
// necessário pro drill-down por material, que continua em _agrCompute).
// ═══════════════════════════════════════════════════════════

// Mapa central(normalizado) → regional, a partir de state.filiais.
// Mesmo padrão já usado em relatorio.js (centralParaRegional).
function _agrRegionalMap() {
  const map = new Map();
  (state.filiais || []).forEach(f => {
    const alias = (f.alias || f.origem || '').trim();
    if (!alias) return;
    map.set(normalizeText(alias), (f.regional || '').trim() || 'Sem Regional');
  });
  return map;
}

function _agrRegionalDaCentral(central, map) {
  return map.get(normalizeText(central || '')) || 'Sem Regional';
}

// Conta dias úteis (seg-sex) entre duas datas, inclusive.
function _agrDiasUteis(dtIni, dtFim) {
  let n = 0;
  const cur = new Date(dtIni); cur.setHours(0, 0, 0, 0);
  const fim = new Date(dtFim); fim.setHours(0, 0, 0, 0);
  while (cur <= fim) {
    if (!_agrIsWeekend(cur)) n++;
    cur.setDate(cur.getDate() + 1);
  }
  return n;
}

function _agrSituacao(variacao) {
  if (variacao > 0) return 'aumentou';
  if (variacao < 0) return 'reduziu';
  return 'estavel';
}

// Agrupa as entradas de agregado por central e por dia. Métrica principal:
// quantidade de PEDIDOS (NFs distintas registradas) — não soma de peso.
// Peso é mantido como informação complementar, convertido pra KG com a
// mesma regra de conversão por densidade de material já usada em NFs
// Pendentes (_convertNfPesoToKg, ver ui.js), em vez de somar peso bruto
// misturando toneladas e m³ sem converter.
function _agrBuildResumo(entradasFiltradas, cutoff, firstDay, lastDay) {
  const regionalMap = _agrRegionalMap();
  const diasPre = _agrDiasUteis(firstDay, cutoff);
  const nextDay = new Date(cutoff.getTime() + 86400000);
  const diasPos = _agrDiasUteis(nextDay, lastDay);

  // central(sigla) → { label, nfPreSet, nfPosSet, pesoPreKg, pesoPosKg, porDiaNF: Map<dateKey, Set<nf>> }
  const porCentral = new Map();
  entradasFiltradas.forEach(e => {
    const central  = e.centralDestino || e.centralCompra || '—';
    const original = e.centralDestinoOriginal || e.centralCompraOriginal || central;
    const d = _agrParseEntradaDate(e);
    if (!d) return;
    const dk = _agrDateKey(d);
    // NF distinta — várias linhas de material na mesma nota não contam
    // como pedidos separados.
    const nf = String(e.nf || '—').trim() || '—';
    const pesoKg = typeof _convertNfPesoToKg === 'function'
      ? _convertNfPesoToKg(e.peso, e.um, e.material)
      : num(e.peso); // fallback defensivo, não deveria disparar (ui.js sempre carregado antes)

    if (!porCentral.has(central)) {
      porCentral.set(central, {
        label: original, nfPreSet: new Set(), nfPosSet: new Set(),
        pesoPreKg: 0, pesoPosKg: 0, porDiaNF: new Map(),
      });
    }
    const c = porCentral.get(central);
    if (d <= cutoff) { c.nfPreSet.add(nf); c.pesoPreKg += pesoKg; }
    else             { c.nfPosSet.add(nf); c.pesoPosKg += pesoKg; }

    if (!c.porDiaNF.has(dk)) c.porDiaNF.set(dk, new Set());
    c.porDiaNF.get(dk).add(nf);
  });

  const usinas = [...porCentral.entries()].map(([central, v]) => {
    const regional = _agrRegionalDaCentral(central, regionalMap);
    const countPre = v.nfPreSet.size;
    const countPos = v.nfPosSet.size;
    const mediaPedidosPre = diasPre > 0 ? countPre / diasPre : 0;
    const mediaPedidosPos = diasPos > 0 ? countPos / diasPos : 0;
    const variacao = mediaPedidosPre > 0
      ? ((mediaPedidosPos - mediaPedidosPre) / mediaPedidosPre) * 100
      : (mediaPedidosPos > 0 ? Infinity : 0);

    // Contagem de NFs distintas por dia (pro gráfico).
    const porDia = new Map();
    v.porDiaNF.forEach((set, dk) => porDia.set(dk, set.size));

    return {
      central, label: v.label, regional,
      countPre, countPos, mediaPedidosPre, mediaPedidosPos,
      pesoPreKg: v.pesoPreKg, pesoPosKg: v.pesoPosKg,
      mediaPesoPreKg: diasPre > 0 ? v.pesoPreKg / diasPre : 0,
      mediaPesoPosKg: diasPos > 0 ? v.pesoPosKg / diasPos : 0,
      variacao, situacao: _agrSituacao(variacao),
      porDia,
    };
  });

  const regionais = [...new Set(usinas.map(u => u.regional))].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  return { usinas, regionais, diasPre, diasPos };
}

// ── Render ───────────────────────────────────────────────
function rodarControleAgregados() {
  if (_agrSelectedYear === null || _agrSelectedMonth === null) {
    toast('Selecione um mês', 'error'); return;
  }

  // Show loading state immediately
  const el = document.getElementById('agr-results');
  if (el) el.innerHTML = '<div class="agr-empty"><i class="ti ti-loader" style="animation:spin 1s linear infinite"></i><span>Calculando...</span></div>';
  document.getElementById('agr-info-bar').style.display = 'none';

  // Defer heavy compute to next frame so loading state renders first
  requestAnimationFrame(() => setTimeout(() => {
  const dtIni = new Date(_agrSelectedYear, _agrSelectedMonth, 1);
  const dtFim = new Date(_agrSelectedYear, _agrSelectedMonth + 1, 0);
  _agrRunForMonth(dtIni, dtFim);
  }, 0));
}

/**
 * Chamado pelo Dashboard Gerencial com o período selecionado no cabeçalho unificado.
 * Deriva todos os meses cobertos pelo período e roda o Controle de Corte para cada um,
 * exibindo-os em sequência na mesma view.
 */
function rodarControleAgregadosPorPeriodo(dtIni, dtFim) {
  if (!dtIni || !dtFim) return;

  const el = document.getElementById('agr-results');
  if (el) el.innerHTML = '<div class="agr-empty"><i class="ti ti-loader" style="animation:spin 1s linear infinite"></i><span>Calculando...</span></div>';
  document.getElementById('agr-info-bar').style.display = 'none';

  // Deriva todos os meses cobertos pelo período
  const meses = [];
  const cur = new Date(dtIni.getFullYear(), dtIni.getMonth(), 1);
  const fimMes = new Date(dtFim.getFullYear(), dtFim.getMonth(), 1);
  while (cur <= fimMes) {
    meses.push({ year: cur.getFullYear(), month: cur.getMonth() });
    cur.setMonth(cur.getMonth() + 1);
  }

  requestAnimationFrame(() => setTimeout(() => {
    if (meses.length === 1) {
      // Um único mês: comportamento normal
      const m = meses[0];
      const ini = new Date(m.year, m.month, 1);
      const fim = new Date(m.year, m.month + 1, 0);
      _agrRunForMonth(ini, fim);
    } else {
      // Múltiplos meses: renderiza cada um em sequência
      const _mNome = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                      'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
      if (el) el.innerHTML = '';
      meses.forEach(m => {
        const ini = new Date(m.year, m.month, 1);
        const fim = new Date(m.year, m.month + 1, 0);
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'margin-bottom:28px';
        const header = document.createElement('div');
        header.style.cssText = 'font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);font-family:var(--mono);padding:0 2px 8px;border-bottom:1px solid var(--border);margin-bottom:12px';
        header.textContent = `${_mNome[m.month]} ${m.year}`;
        const results = document.createElement('div');
        wrapper.appendChild(header);
        wrapper.appendChild(results);
        if (el) el.appendChild(wrapper);
        _agrRunForMonth(ini, fim, results);
      });
    }
  }, 0));
}

// ── Lógica interna: executa o cálculo e renderiza para um mês específico ──
// containerEl: elemento DOM onde renderizar (default: #agr-results)
function _agrRunForMonth(dtIni, dtFim, containerEl) {
  const el = containerEl || document.getElementById('agr-results');

  // Muda de mês → descarta corte manual do mês anterior (evita reaplicar sem querer
  // um dia que só fazia sentido no mês computado antes).
  if (!containerEl) {
    const monthKey = `${dtIni.getFullYear()}-${dtIni.getMonth()}`;
    if (window._agrLastComputedMonthKey && window._agrLastComputedMonthKey !== monthKey) {
      window._agrManualCutoffISO = null;
    }
    window._agrLastComputedMonthKey = monthKey;
    // Recompute sempre recolhe o drill-down de volta pro resumo consolidado.
    const ddCard = document.getElementById('agregados-card');
    if (ddCard) ddCard.style.display = 'none';
  }

  const { centrais, cutoff, firstDay, lastDay, cutoffManual, entradasFiltradas } = _agrCompute(dtIni, dtFim);

  // Info bar — só atualiza quando não está em modo multi-mês (containerEl é null)
  if (!containerEl) {
    document.getElementById('agr-info-bar').style.display = 'flex';
    document.getElementById('agr-pre-range').textContent  = `${_agrFmtDate(firstDay)} → ${_agrFmtDate(cutoff)}`;
    document.getElementById('agr-pos-range').textContent  = `${_agrFmtDate(new Date(cutoff.getTime() + 86400000))} → ${_agrFmtDate(lastDay)}`;
    document.getElementById('agr-limit-date').textContent = _agrFmtDate(cutoff) + (cutoffManual ? ' · manual' : ' · automático');
    const criticas    = centrais.filter(c => c.criticidade === 'critico').length;
    const atencao     = centrais.filter(c => c.criticidade === 'atencao').length;
    const injustTotal = centrais.reduce((s, c) => s + c.injustificados, 0);
    const violEl = document.getElementById('agr-total-violacoes');
    if (violEl) {
      violEl.textContent = criticas > 0
        ? `${criticas} crítica(s) · ${injustTotal} mat. injustificado(s)`
        : atencao > 0 ? `${atencao} em atenção` : 'Nenhuma';
      violEl.style.color = criticas > 0 ? 'var(--red)' : atencao > 0 ? 'var(--amber)' : 'var(--green)';
    }

    // ── Resumo por Regional (novo) ──
    window._agrResumoRaw = { entradasFiltradas, cutoff, firstDay, lastDay, cutoffManual };
    _agrSyncCorteManualInput(cutoff, cutoffManual, firstDay, lastDay);
    _agrRenderResumoRegional();
  }

  if (!centrais.length) {
    if (el) el.innerHTML = `<div class="agr-empty"><i class="ti ti-package"></i><span>Nenhuma entrada de agregado encontrada no período.</span></div>`;
    return;
  }

  // Store for filtering then render via agrApplyFilters
  // Em modo multi-mês, renderiza diretamente sem usar o estado global de filtros
  if (!containerEl) {
    window._agrCentraisData = centrais;
    const fb = document.getElementById('agr-filter-bar');
    if (fb) fb.style.display = '';
    agrClearFilters(true);
    _agrPopulateOptions('central');
    _agrPopulateOptions('material');
    agrApplyFilters();
  } else {
    // Multi-mês: renderiza no containerEl substituindo temporariamente #agr-results
    window._agrCentraisData = centrais;
    const realEl = document.getElementById('agr-results');
    if (realEl && el !== realEl) {
      realEl.id = '__agr-results-tmp';
      el.id = 'agr-results';
      agrApplyFilters();
      el.id = '__agr-results-bkp';
      realEl.id = 'agr-results';
    } else {
      if (el) el.innerHTML = '';
      agrApplyFilters();
    }
  }
}

// ── dummy placeholder to preserve reference (real render is via agrApplyFilters) ──
function _agrRenderFull_UNUSED(centrais) { return centrais.map((c, ci) => {
    const pctClass = c.pctPosCentral === 0 ? 'ok' : c.pctPosCentral < 30 ? 'warn' : 'alert';
    const statusLabel = c.criticidade === 'ok' ? 'OK' : c.criticidade === 'atencao' ? 'ATENÇÃO' : 'CRÍTICO';
    const statusClass = c.criticidade === 'ok' ? 'agr-status-ok' : c.criticidade === 'atencao' ? 'agr-status-alerta' : 'agr-status-critico';

    const matsHtml = _agrRenderMatsTable(c.mats);

    return `
      <div class="agr-central-block">
        <div class="agr-central-header" onclick="_agrToggle(${ci})" id="agr-hdr-${ci}">
          <i class="ti ti-chevron-right agr-chevron" id="agr-chev-${ci}"></i>
          <div class="agr-central-name">
            <i class="ti ti-building-warehouse"></i>
            ${escapeHtml(c.central)}
          </div>
          <div class="agr-central-summary">
            <span style="color:var(--text2)"><i class="ti ti-arrow-down-right" style="font-size:11px;opacity:.6"></i> Pré: <strong style="color:var(--text)">${_agrSmartFmt(c.centralPreKg)}</strong></span>
            <span style="color:${pctClass === 'alert' ? 'var(--red)' : pctClass === 'warn' ? 'var(--amber)' : 'var(--text2)'}"><i class="ti ti-arrow-up-right" style="font-size:11px"></i> Pós: <strong>${_agrSmartFmt(c.centralPosKg)}</strong> <span style="opacity:.7">(${isFinite(c.pctPosCentral) ? c.pctPosCentral.toFixed(1)+'%' : '∞'})</span></span>
            ${c.totalConsumoPosKg > 0 ? `<span style="color:var(--text3)"><i class="ti ti-forklift" style="font-size:11px"></i> Consumo pós: <strong style="color:var(--text)">${_agrSmartFmt(c.totalConsumoPosKg / 1000)} t</strong></span>` : ''}
            <span class="agr-justif ${c.justificados > 0 ? 'agr-justif-ok' : 'agr-justif-zero'}" style="font-size:10px"><i class="ti ti-check"></i> ${c.justificados} just.</span>
            <span class="agr-justif ${c.parciais > 0 ? 'agr-justif-parcial' : 'agr-justif-zero'}" style="font-size:10px"><i class="ti ti-alert-triangle"></i> ${c.parciais} parc.</span>
            <span class="agr-justif ${c.injustificados > 0 ? 'agr-justif-nao' : 'agr-justif-zero'}" style="font-size:10px"><i class="ti ti-x"></i> ${c.injustificados} injust.</span>
            <div class="agr-prop-bar" style="min-width:60px;flex:1;max-width:120px"><div class="agr-prop-bar-pre" style="flex:${c.centralPreKg}"></div><div class="agr-prop-bar-pos" style="flex:${c.centralPosKg}"></div></div>
          </div>
          <span class="agr-status-badge ${statusClass}">${statusLabel}</span>
          ${c.centralPosKg > 0 ? `<span class="agr-score-badge">Score: ${c.score}</span>` : ''}
        </div>
        <div class="agr-mat-table-wrap" id="agr-mat-${ci}">
          <table class="agr-mat-table">
            <thead>
              <tr>
                <th>Material</th>
                <th>Peso Pré-limite</th>
                <th>Peso Pós-limite</th>
                <th>% Pós/Pré</th>
                <th>Carretas Pré</th>
                <th>Carretas Pós</th>
                <th>Consumo Pré</th>
                <th>Consumo Pós</th>
                <th>Justificativa</th>
                <th>Estoque no Limite</th>
                <th>Estoque Fim do Mês</th>
              </tr>
            </thead>
            <tbody>${matsHtml}</tbody>
          </table>
        </div>
      </div>`;
  }).join('');
} // end _agrRenderFull_UNUSED

// ═══════════════════════════════════════════════════════════
// RENDER — Resumo por Regional
// ═══════════════════════════════════════════════════════════

// Sincroniza o input de data manual: define min/max pro mês computado e só
// sobrescreve o valor exibido quando NÃO há corte manual ativo (pra não
// apagar o que o analista acabou de digitar no meio de um recompute).
function _agrSyncCorteManualInput(cutoff, cutoffManual, firstDay, lastDay) {
  const input = document.getElementById('agr-corte-manual-input');
  if (!input) return;
  input.min = toISODate(firstDay);
  input.max = toISODate(lastDay);
  if (!cutoffManual) input.value = toISODate(cutoff);
}

// Disparado pelo input de data — recalcula tudo (o corte manual afeta também
// o drill-down por material, não só o resumo).
function agrSetManualCutoff(dateStr) {
  window._agrManualCutoffISO = dateStr || null;
  const iniStr = document.getElementById('dg-dt-ini')?.value;
  const fimStr = document.getElementById('dg-dt-fim')?.value;
  if (!iniStr || !fimStr || typeof rodarControleAgregadosPorPeriodo !== 'function') return;
  const dtIni = new Date(iniStr + 'T00:00:00');
  const dtFim = new Date(fimStr + 'T23:59:59');
  if (!isNaN(dtIni) && !isNaN(dtFim)) rodarControleAgregadosPorPeriodo(dtIni, dtFim);
}

function _agrPopulateRegionalSelect(regionais) {
  const sel = document.getElementById('agr-regional-select');
  if (!sel) return;
  const atual = sel.value || 'todos';
  sel.innerHTML = `<option value="todos">Todos os Regionais</option>` +
    regionais.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('');
  if ([...sel.options].some(o => o.value === atual)) sel.value = atual;
}

// Disparado pelo <select> de regional — re-render rápido, sem recomputar
// _agrCompute (só reagrega window._agrResumoData, que já está pronto).
function agrSetRegionalSelecionado() {
  _agrRenderResumoRegional();
}

function _agrResumoKpiStripHtml(mediaPedidosPre, mediaPedidosPos, mediaPesoPreKg, mediaPesoPosKg, variacao, situacao, nUsinas) {
  const varClass = situacao === 'aumentou' ? 'aumentou' : situacao === 'reduziu' ? 'reduziu' : '';
  const varLabel = !isFinite(variacao) ? '—' : `${variacao > 0 ? '+' : ''}${variacao.toFixed(1)}%`;
  const varSit   = situacao === 'aumentou' ? 'Aumentou pedidos' : situacao === 'reduziu' ? 'Reduziu pedidos' : 'Estável';
  const pesoSub  = kg => `${_agrSmartFmt(kg / 1000)} t/dia`;
  return `
    <div class="agr-resumo-kpi-card">
      <span class="agr-resumo-kpi-label">Pedidos/dia · Pré</span>
      <span class="agr-resumo-kpi-val">${_agrSmartFmt(mediaPedidosPre)}</span>
      <span class="agr-resumo-kpi-sub">${pesoSub(mediaPesoPreKg)}</span>
    </div>
    <div class="agr-resumo-kpi-card">
      <span class="agr-resumo-kpi-label">Pedidos/dia · Pós</span>
      <span class="agr-resumo-kpi-val">${_agrSmartFmt(mediaPedidosPos)}</span>
      <span class="agr-resumo-kpi-sub">${pesoSub(mediaPesoPosKg)}</span>
    </div>
    <div class="agr-resumo-kpi-card">
      <span class="agr-resumo-kpi-label">Variação de pedidos</span>
      <span class="agr-resumo-kpi-val ${varClass}">${varLabel}</span>
      <span style="font-size:10px;color:var(--text3)">${varSit}</span>
    </div>
    <div class="agr-resumo-kpi-card">
      <span class="agr-resumo-kpi-label">Usinas nessa seleção</span>
      <span class="agr-resumo-kpi-val">${nUsinas}</span>
    </div>`;
}

function _agrResumoTableHtml(usinas) {
  if (!usinas.length) {
    return `<div class="agr-empty"><i class="ti ti-truck-off"></i><span>Nenhuma usina com entrada de agregado nesse recorte.</span></div>`;
  }
  const rows = usinas.map(u => {
    const badgeClass = u.situacao === 'aumentou' ? 'agr-status-critico' : u.situacao === 'reduziu' ? 'agr-status-ok' : 'agr-status-alerta';
    const badgeLabel = u.situacao === 'aumentou' ? 'Aumentou' : u.situacao === 'reduziu' ? 'Reduziu' : 'Estável';
    const varLabel = !isFinite(u.variacao) ? '—' : `${u.variacao > 0 ? '+' : ''}${u.variacao.toFixed(1)}%`;
    const centralAttr = escapeHtml(u.central).replace(/'/g, '&#39;');
    const pesoSub = kg => `<div class="td-muted" style="font-size:9.5px;font-weight:400">${_agrSmartFmt(kg / 1000)} t/dia</div>`;
    return `
      <tr class="agr-resumo-row" onclick="_agrResumoRowClick('${centralAttr}')">
        <td class="td-mono">
          ${escapeHtml(u.label)}
          <div style="font-size:9.5px;color:var(--text3);font-weight:400">${escapeHtml(u.regional)}</div>
        </td>
        <td class="td-mono">${_agrSmartFmt(u.mediaPedidosPre)}${pesoSub(u.mediaPesoPreKg)}</td>
        <td class="td-mono">${_agrSmartFmt(u.mediaPedidosPos)}${pesoSub(u.mediaPesoPosKg)}</td>
        <td class="td-mono">${varLabel}</td>
        <td><span class="agr-status-badge ${badgeClass}">${badgeLabel}</span></td>
      </tr>`;
  }).join('');
  return `
    <table class="agr-resumo-table">
      <thead><tr>
        <th>Usina (nome original)</th><th>Pedidos/dia · Pré</th><th>Pedidos/dia · Pós</th><th>Variação</th><th>Situação</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

let _agrResumoChartInstance = null;

function _agrRenderResumoChart(usinasFiltradas, cutoff, firstDay, lastDay, mediaPedidosPreGlobal) {
  const canvas = document.getElementById('agr-resumo-chart');
  if (!canvas || typeof Chart === 'undefined') return;

  // Dias úteis (seg-sex) do período, na ordem — fins de semana não entram
  // no eixo (agregados não são comprados aos fins de semana).
  const dias = [];
  const cur = new Date(firstDay); cur.setHours(0, 0, 0, 0);
  const fim = new Date(lastDay);  fim.setHours(0, 0, 0, 0);
  while (cur <= fim) {
    if (!_agrIsWeekend(cur)) dias.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }

  // Contagem de pedidos (NFs distintas) por dia, somada entre as usinas
  // filtradas.
  const totalPorDia = new Map();
  usinasFiltradas.forEach(u => {
    u.porDia.forEach((v, dk) => totalPorDia.set(dk, (totalPorDia.get(dk) || 0) + v));
  });

  const cutoffKey = _agrDateKey(cutoff);
  const labels  = dias.map(d => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }));
  const valores = dias.map(d => totalPorDia.get(_agrDateKey(d)) || 0);
  const cores   = dias.map(d => _agrDateKey(d) <= cutoffKey ? 'rgba(52,168,120,0.55)' : 'rgba(217,119,87,0.6)');

  if (_agrResumoChartInstance) { _agrResumoChartInstance.destroy(); _agrResumoChartInstance = null; }
  if (!dias.length) return;

  const rootStyle = getComputedStyle(document.documentElement);
  const gridCol = rootStyle.getPropertyValue('--border').trim() || '#334155';
  const textCol = rootStyle.getPropertyValue('--text3').trim() || '#94a3b8';

  _agrResumoChartInstance = new Chart(canvas, {
    data: {
      labels,
      datasets: [
        {
          type: 'bar',
          label: 'Pedidos/dia',
          data: valores,
          backgroundColor: cores,
          borderRadius: 3,
          borderSkipped: false,
          order: 2,
        },
        {
          type: 'line',
          label: 'Média de pedidos (Pré)',
          data: dias.map(() => mediaPedidosPreGlobal),
          borderColor: textCol,
          borderDash: [5, 5],
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ctx.dataset.type === 'line'
              ? `Média de pedidos/dia (Pré): ${_agrSmartFmt(ctx.raw)}`
              : `${_agrSmartFmt(ctx.raw)} pedido(s)`,
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: textCol, font: { size: 9.5 } } },
        y: { grid: { color: gridCol }, ticks: { color: textCol, font: { size: 9.5 }, precision: 0 }, beginAtZero: true },
      },
    },
  });
}

// Entrada principal: reagrega window._agrResumoData considerando o regional
// selecionado e (re)renderiza KPIs + gráfico + tabela. Não recomputa
// _agrCompute — é chamada tanto após um recompute completo (mês/corte manual)
// quanto isoladamente ao trocar o regional no seletor.
function _agrRenderResumoRegional() {
  const raw     = window._agrResumoRaw;
  const kpisEl  = document.getElementById('agr-resumo-kpis');
  const tableEl = document.getElementById('agr-resumo-table-wrap');
  const selectEl = document.getElementById('agr-regional-select');
  if (!raw || !kpisEl || !tableEl) return;

  const resumo = _agrBuildResumo(raw.entradasFiltradas, raw.cutoff, raw.firstDay, raw.lastDay);
  window._agrResumoData = resumo;

  _agrPopulateRegionalSelect(resumo.regionais);

  const regionalSel = selectEl ? selectEl.value : 'todos';
  const usinasFiltradas = regionalSel === 'todos'
    ? resumo.usinas
    : resumo.usinas.filter(u => u.regional === regionalSel);

  const countPreTotal = usinasFiltradas.reduce((s, u) => s + u.countPre, 0);
  const countPosTotal = usinasFiltradas.reduce((s, u) => s + u.countPos, 0);
  const pesoPreTotal  = usinasFiltradas.reduce((s, u) => s + u.pesoPreKg, 0);
  const pesoPosTotal  = usinasFiltradas.reduce((s, u) => s + u.pesoPosKg, 0);

  const mediaPedidosPre = resumo.diasPre > 0 ? countPreTotal / resumo.diasPre : 0;
  const mediaPedidosPos = resumo.diasPos > 0 ? countPosTotal / resumo.diasPos : 0;
  const mediaPesoPreKg  = resumo.diasPre > 0 ? pesoPreTotal / resumo.diasPre : 0;
  const mediaPesoPosKg  = resumo.diasPos > 0 ? pesoPosTotal / resumo.diasPos : 0;
  const variacao = mediaPedidosPre > 0
    ? ((mediaPedidosPos - mediaPedidosPre) / mediaPedidosPre) * 100
    : (mediaPedidosPos > 0 ? Infinity : 0);
  const situacao = _agrSituacao(variacao);

  kpisEl.innerHTML = _agrResumoKpiStripHtml(mediaPedidosPre, mediaPedidosPos, mediaPesoPreKg, mediaPesoPosKg, variacao, situacao, usinasFiltradas.length);

  const ordenadas = [...usinasFiltradas].sort((a, b) => {
    const av = isFinite(a.variacao) ? a.variacao : 1e12;
    const bv = isFinite(b.variacao) ? b.variacao : 1e12;
    return bv - av;
  });
  tableEl.innerHTML = _agrResumoTableHtml(ordenadas);

  _agrRenderResumoChart(usinasFiltradas, raw.cutoff, raw.firstDay, raw.lastDay, mediaPedidosPre);
}

// Clique numa linha da tabela de resumo → abre o card de drill-down
// (detalhamento por material que já existia) filtrado só naquela usina.
function _agrResumoRowClick(central) {
  const card = document.getElementById('agregados-card');
  if (!card) return;
  card.style.display = '';
  _agrPopulateOptions('central');
  const opts = document.getElementById('agr-mfo-central');
  if (opts) opts.querySelectorAll('input[type=checkbox]').forEach(cb => { cb.checked = (cb.value === central); });
  agrApplyFilters();
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setTimeout(() => { document.querySelector('#agr-results .agr-central-header')?.click(); }, 150);
}

// Botão "Voltar ao resumo" no card de drill-down.
function agrVoltarResumo() {
  const card = document.getElementById('agregados-card');
  if (card) card.style.display = 'none';
  agrClearDropdown('central');
  document.getElementById('agr-resumo-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function _agrToggle(idx) {
  const hdr = document.getElementById(`agr-hdr-${idx}`);
  const mat = document.getElementById(`agr-mat-${idx}`);
  if (!hdr || !mat) return;
  const open = mat.classList.contains('open');
  mat.classList.toggle('open', !open);
  hdr.classList.toggle('expanded', !open);
}

// Hook cal-picker to enable button
function _agrOnPeriodSet() {
  const btn = document.getElementById('agr-run-btn');
  if (btn) btn.disabled = false;
}

// ── Indicador de justificativa ──────────────────────────
function _agrJustifBadge(posRaw, consumoPosKg) {
  // Sem pedido pós-limite → não se aplica
  if (!posRaw || posRaw <= 0) return '<span class="td-muted">—</span>';

  // posRaw está em TON/M3 (unidade das entradas)
  // consumoPosKg está em KG → converter para TON para comparar
  const consumoPosTon = consumoPosKg / 1000;

  if (consumoPosTon <= 0) {
    return '<span class="agr-justif agr-justif-nao"><i class="ti ti-x"></i> Injustificado</span>';
  }
  // Tolerância de 5% para considerar "justificado" (consumo ≥ 95% do pedido)
  if (consumoPosTon >= posRaw * 0.95) {
    return '<span class="agr-justif agr-justif-ok"><i class="ti ti-check"></i> Justificado</span>';
  }
  // Consumo parcial
  const pct = Math.round((consumoPosTon / posRaw) * 100);
  return `<span class="agr-justif agr-justif-parcial"><i class="ti ti-alert-triangle"></i> Parcial (${pct}%)</span>`;
}

// ── Month picker ────────────────────────────────────────
const _MESES_BR = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const _MESES_FULL = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
let _agrPickerYear = new Date().getFullYear();
let _agrSelectedYear = null;
let _agrSelectedMonth = null; // 0-based

function agrToggleMonthPicker() {
  const picker = document.getElementById('agr-month-picker');
  const trigger = document.getElementById('agr-month-trigger');
  const chev = document.getElementById('agr-month-chev');
  if (!picker) return;
  const open = picker.classList.contains('open');
  picker.classList.toggle('open', !open);
  trigger?.classList.toggle('open', !open);
  if (chev) chev.style.transform = open ? '' : 'rotate(180deg)';
  if (!open) _agrRenderMonthGrid();
}

function _agrRenderMonthGrid() {
  const grid = document.getElementById('agr-month-grid');
  const yearEl = document.getElementById('agr-nav-year');
  if (!grid) return;
  if (yearEl) yearEl.textContent = _agrPickerYear;
  grid.innerHTML = _MESES_BR.map((m, i) => {
    const active = _agrSelectedYear === _agrPickerYear && _agrSelectedMonth === i ? ' active' : '';
    return `<button class="agr-month-btn${active}" onclick="_agrSelectMonth(${_agrPickerYear}, ${i})">${m}</button>`;
  }).join('');
}

function agrMonthNavYear(dir) {
  _agrPickerYear += dir;
  _agrRenderMonthGrid();
}

function _agrSelectMonth(year, month) {
  _agrSelectedYear  = year;
  _agrSelectedMonth = month;
  // Update label
  const label = document.getElementById('agr-month-label');
  if (label) label.textContent = `${_MESES_FULL[month]} ${year}`;
  // Enable button
  document.getElementById('agr-run-btn').disabled = false;
  // Deactivate chips
  document.getElementById('agr-chip-atual')?.classList.remove('active');
  document.getElementById('agr-chip-anterior')?.classList.remove('active');
  // Close picker
  agrToggleMonthPicker();
}

function agrQuickMesAtual() {
  const now = new Date();
  _agrPickerYear = now.getFullYear();
  _agrSelectMonth(now.getFullYear(), now.getMonth());
  document.getElementById('agr-chip-atual')?.classList.add('active');
  document.getElementById('agr-chip-anterior')?.classList.remove('active');
}

function agrQuickMesAnterior() {
  const now  = new Date();
  const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const mon  = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
  _agrPickerYear = year;
  _agrSelectMonth(year, mon);
  document.getElementById('agr-chip-anterior')?.classList.add('active');
  document.getElementById('agr-chip-atual')?.classList.remove('active');
}

// Close on outside click
document.addEventListener('click', e => {
  const wrap = document.getElementById('agr-month-wrap');
  const picker = document.getElementById('agr-month-picker');
  if (picker?.classList.contains('open') && wrap && !wrap.contains(e.target)) {
    picker.classList.remove('open');
    document.getElementById('agr-month-trigger')?.classList.remove('open');
    const chev = document.getElementById('agr-month-chev');
    if (chev) chev.style.transform = '';
  }
});

// ── Filtros (micro-filter dropdown style) ───────────────

// Get checked values from a dropdown options list
function _agrGetChecked(optionsId) {
  return Array.from(document.querySelectorAll(`#${optionsId} input[type=checkbox]:checked`))
    .map(cb => cb.value);
}

// Toggle dropdown open/close
function agrToggleDropdown(key) {
  // Populate dynamic options for central/material
  if (key === 'central' || key === 'material') _agrPopulateOptions(key);
  const dd    = document.getElementById(`agr-mfd-${key}`);
  const chev  = document.getElementById(`agr-mfc-${key}`);
  const btn   = document.getElementById(`agr-mft-${key}`);
  if (!dd) return;
  const open = dd.classList.contains('open');
  // Close all first
  document.querySelectorAll('#agr-filter-bar .micro-filter-dropdown.open').forEach(el => {
    el.classList.remove('open');
  });
  document.querySelectorAll('#agr-filter-bar .micro-filter-chev').forEach(el => {
    el.style.transform = '';
  });
  document.querySelectorAll('#agr-filter-bar .micro-filter-trigger').forEach(el => {
    el.classList.remove('open');
  });
  if (!open) {
    dd.classList.add('open');
    if (chev) chev.style.transform = 'rotate(180deg)';
    if (btn)  btn.classList.add('open');
  }
}

function agrCloseDropdown(key) {
  const dd   = document.getElementById(`agr-mfd-${key}`);
  const chev = document.getElementById(`agr-mfc-${key}`);
  const btn  = document.getElementById(`agr-mft-${key}`);
  if (dd)   dd.classList.remove('open');
  if (chev) chev.style.transform = '';
  if (btn)  btn.classList.remove('open');
  // Apply filters when user clicks Aplicar
  agrApplyFilters();
}

function agrClearDropdown(key) {
  const opts = document.getElementById(`agr-mfo-${key}`);
  if (opts) opts.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false);
  const lbl = document.getElementById(`agr-mft-${key}-label`);
  if (lbl) lbl.textContent = key === 'status' ? 'Status' : key === 'justif' ? 'Justificativa' : key === 'central' ? 'Central' : 'Material';
  const btn = document.getElementById(`agr-mft-${key}`);
  if (btn) btn.classList.remove('active');
  agrApplyFilters();
}

function agrFilterDropdownSearch(key, q) {
  const opts = document.getElementById(`agr-mfo-${key}`);
  if (!opts) return;
  opts.querySelectorAll('.micro-filter-option').forEach(opt => {
    const text = opt.textContent.toLowerCase();
    opt.style.display = text.includes(q.toLowerCase()) ? '' : 'none';
  });
}

// Update trigger label with selected count
function _agrUpdateTriggerLabel(key, selectedVals) {
  const lbl = document.getElementById(`agr-mft-${key}-label`);
  const btn = document.getElementById(`agr-mft-${key}`);
  const defaults = { status: 'Status', justif: 'Justificativa', central: 'Central', material: 'Material' };
  if (!lbl) return;
  if (selectedVals.length === 0) {
    lbl.textContent = defaults[key];
    btn?.classList.remove('active');
  } else {
    lbl.textContent = `${defaults[key]} (${selectedVals.length})`;
    btn?.classList.add('active');
  }
}

// Populate dynamic options (central and material lists), considerando os
// demais filtros JÁ APLICADOS (Status/Justificativa/Central/Material,
// exceto o da própria chave) — estilo Excel: se já filtrei por Central,
// o dropdown de Material só mostra materiais daquela(s) central(is).
function _agrPopulateOptions(key) {
  const data = window._agrCentraisData || [];
  const opts = document.getElementById(`agr-mfo-${key}`);
  if (!opts) return;
  // Get current checked values to preserve selection
  const checked = new Set(_agrGetChecked(`agr-mfo-${key}`));

  const selStatus   = key === 'status'   ? [] : _agrGetChecked('agr-mfo-status');
  const selJustif   = key === 'justif'   ? [] : _agrGetChecked('agr-mfo-justif');
  const selCentral  = key === 'central'  ? [] : _agrGetChecked('agr-mfo-central');
  const selMaterial = key === 'material' ? [] : _agrGetChecked('agr-mfo-material');

  const filteredData = data.filter(c => {
    if (selStatus.length   && !selStatus.includes(c.criticidade)) return false;
    if (selCentral.length  && !selCentral.includes(c.central))    return false;
    if (selJustif.length) {
      const hasMatch = c.mats.some(m => selJustif.includes(_agrMatJustifType(m)));
      if (!hasMatch) return false;
    }
    if (selMaterial.length) {
      const hasMatch = c.mats.some(m => selMaterial.includes(m.material));
      if (!hasMatch) return false;
    }
    return true;
  });

  let values = [];
  if (key === 'central') {
    values = [...new Set(filteredData.map(c => c.central))].sort();
  } else if (key === 'material') {
    values = [...new Set(filteredData.flatMap(c => c.mats
      .filter(m => !selJustif.length || selJustif.includes(_agrMatJustifType(m)))
      .map(m => m.material)))].sort();
  }
  opts.innerHTML = values.map(v => {
    const escaped   = escapeHtml(v);
    const isChecked = checked.has(v) ? 'checked' : '';
    return `<label class="micro-filter-option">
      <input type="checkbox" value="${escaped}" ${isChecked}>
      <span class="micro-filter-option-label">${escaped}</span>
    </label>`;
  }).join('');
}

// Hook toggleDropdown to populate dynamic options
const _agrOrigToggle = agrToggleDropdown;

function agrApplyFilters() {
  const data = window._agrCentraisData || [];
  const el   = document.getElementById('agr-results');
  if (!el) return;

  const selStatus   = _agrGetChecked('agr-mfo-status');
  const selJustif   = _agrGetChecked('agr-mfo-justif');
  const selCentral  = _agrGetChecked('agr-mfo-central');
  const selMaterial = _agrGetChecked('agr-mfo-material');

  _agrUpdateTriggerLabel('status',   selStatus);
  _agrUpdateTriggerLabel('justif',   selJustif);
  _agrUpdateTriggerLabel('central',  selCentral);
  _agrUpdateTriggerLabel('material', selMaterial);

  const hasFilter = selStatus.length || selJustif.length || selCentral.length || selMaterial.length;
  const clearBtn  = document.getElementById('agr-filter-clear');
  if (clearBtn) clearBtn.style.display = hasFilter ? '' : 'none';

  const filtered = data.filter(c => {
    if (selStatus.length   && !selStatus.includes(c.criticidade)) return false;
    if (selCentral.length  && !selCentral.includes(c.central))    return false;
    if (selJustif.length) {
      const hasMatch = c.mats.some(m => selJustif.includes(_agrMatJustifType(m)));
      if (!hasMatch) return false;
    }
    if (selMaterial.length) {
      const hasMatch = c.mats.some(m => selMaterial.includes(m.material));
      if (!hasMatch) return false;
    }
    return true;
  });

  if (!filtered.length) {
    el.innerHTML = `<div class="agr-empty"><i class="ti ti-filter-off"></i><span>Nenhum resultado para os filtros aplicados.</span></div>`;
    return;
  }

  // Re-render filtered results keeping original indices for toggle
  el.innerHTML = filtered.map((c) => {
    const origIdx = data.indexOf(c);
    const pctClass    = c.pctPosCentral === 0 ? 'ok' : c.pctPosCentral < 30 ? 'warn' : 'alert';
    const statusLabel = c.criticidade === 'ok' ? 'OK' : c.criticidade === 'atencao' ? 'ATENÇÃO' : 'CRÍTICO';
    const statusClass = c.criticidade === 'ok' ? 'agr-status-ok' : c.criticidade === 'atencao' ? 'agr-status-alerta' : 'agr-status-critico';

    // Filter materials by justif and/or material selection
    const visibleMats = c.mats.filter(m => {
      if (selJustif.length   && !selJustif.includes(_agrMatJustifType(m)))  return false;
      if (selMaterial.length && !selMaterial.includes(m.material))           return false;
      return true;
    });

    const matsHtml = _agrRenderMatsTable(visibleMats);

    return `
      <div class="agr-central-block">
        <div class="agr-central-header" onclick="_agrToggle('f${origIdx}')" id="agr-hdr-f${origIdx}">
          <i class="ti ti-chevron-right agr-chevron" id="agr-chev-f${origIdx}"></i>
          <div class="agr-central-name">
            <i class="ti ti-building-warehouse"></i>
            ${escapeHtml(c.central)}
          </div>
          <div class="agr-central-summary">
            <span style="color:var(--text2)"><i class="ti ti-arrow-down-right" style="font-size:11px;opacity:.6"></i> Pré: <strong style="color:var(--text)">${_agrSmartFmt(c.centralPreKg)}</strong></span>
            <span style="color:${pctClass === 'alert' ? 'var(--red)' : pctClass === 'warn' ? 'var(--amber)' : 'var(--text2)'}"><i class="ti ti-arrow-up-right" style="font-size:11px"></i> Pós: <strong>${_agrSmartFmt(c.centralPosKg)}</strong> <span style="opacity:.7">(${isFinite(c.pctPosCentral) ? c.pctPosCentral.toFixed(1)+'%' : '∞'})</span></span>
            ${c.totalConsumoPosKg > 0 ? `<span style="color:var(--text3)"><i class="ti ti-forklift" style="font-size:11px"></i> Consumo pós: <strong style="color:var(--text)">${_agrSmartFmt(c.totalConsumoPosKg / 1000)} t</strong></span>` : ''}
            <span class="agr-justif ${c.justificados > 0 ? 'agr-justif-ok' : 'agr-justif-zero'}" style="font-size:10px"><i class="ti ti-check"></i> ${c.justificados} just.</span>
            <span class="agr-justif ${c.parciais > 0 ? 'agr-justif-parcial' : 'agr-justif-zero'}" style="font-size:10px"><i class="ti ti-alert-triangle"></i> ${c.parciais} parc.</span>
            <span class="agr-justif ${c.injustificados > 0 ? 'agr-justif-nao' : 'agr-justif-zero'}" style="font-size:10px"><i class="ti ti-x"></i> ${c.injustificados} injust.</span>
            <div class="agr-prop-bar" style="min-width:60px;flex:1;max-width:120px"><div class="agr-prop-bar-pre" style="flex:${c.centralPreKg}"></div><div class="agr-prop-bar-pos" style="flex:${c.centralPosKg}"></div></div>
          </div>
          <span class="agr-status-badge ${statusClass}">${statusLabel}</span>
          ${c.centralPosKg > 0 ? `<span class="agr-score-badge">Score: ${c.score}</span>` : ''}
        </div>
        <div class="agr-mat-table-wrap" id="agr-mat-f${origIdx}">
          <table class="agr-mat-table"><thead><tr>
            <th>Material</th><th>Peso Pré-limite</th><th>Peso Pós-limite</th><th>% Pós/Pré</th>
            <th>Carretas Pré</th><th>Carretas Pós</th><th>Consumo Pré</th><th>Consumo Pós</th>
            <th>Justificativa</th><th>Estoque no Limite</th><th>Estoque Fim do Mês</th>
          </tr></thead><tbody>${matsHtml}</tbody></table>
        </div>
      </div>`;
  }).join('');
}

function _agrMatJustifType(m) {
  if (m.posRaw <= 0) return 'justificado';
  const consumoTon = m.consumoPosKg / 1000;
  if (consumoTon <= 0)           return 'injustificado';
  if (consumoTon >= m.posRaw * 0.95) return 'justificado';
  return 'parcial';
}

function agrClearFilters(silent = false) {
  ['status','justif','central','material'].forEach(k => {
    const opts = document.getElementById(`agr-mfo-${k}`);
    if (opts) opts.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false);
    _agrUpdateTriggerLabel(k, []);
  });
  const clearBtn = document.getElementById('agr-filter-clear');
  if (clearBtn) clearBtn.style.display = 'none';
  if (!silent) agrApplyFilters();
}

// Close agr dropdowns on outside click
document.addEventListener('click', e => {
  const bar = document.getElementById('agr-filter-bar');
  if (bar && !bar.contains(e.target)) {
    bar.querySelectorAll('.micro-filter-dropdown.open').forEach(dd => dd.classList.remove('open'));
    bar.querySelectorAll('.micro-filter-chev').forEach(el => el.style.transform = '');
    bar.querySelectorAll('.micro-filter-trigger').forEach(el => el.classList.remove('open'));
  }
});

function agrToggleLegend() {
  const panel = document.getElementById('agr-legend-panel');
  if (panel) panel.style.display = panel.style.display === 'none' ? '' : 'none';
}

// Extract mat table render for reuse by filter
function _agrRenderMatsTable(mats) {
  return mats.map(m => {
    const pctColor  = m.pctPos === 0 ? 'var(--green)' : m.pctPos < 30 ? 'var(--amber)' : 'var(--red)';
    const pctFill   = Math.min(100, isFinite(m.pctPos) ? m.pctPos : 100);
    const pctLabel  = isFinite(m.pctPos) ? m.pctPos.toFixed(1) + '%' : '∞';
    const pctClass2 = m.pctPos === 0 ? 'td-ok' : m.pctPos < 30 ? 'td-warn' : 'td-alert';
    const fmtCar    = v => v == null ? '—' : v.toFixed(1) + ' carr.';
    const fmtUMCol  = (period) => m.umRows.map(r => {
      const val = period === 'pre' ? r.preVal : r.posVal;
      const cnt = period === 'pre' ? r.preCount : r.posCount;
      return `<span>${_agrFmtWeight(val, r.um)} <span class="td-muted">(${cnt} NFs)</span></span>`;
    }).join('<br>');
    const fmtCarCol = (period) => m.umRows.map(r => {
      const val = period === 'pre' ? r.preCarretas : r.posCarretas;
      return `<span>${fmtCar(val)}<span class="td-muted"> ${r.um}</span></span>`;
    }).join('<br>');
    const hasPosEntrada = m.umRows.some(r => r.posVal > 0);
    const posCellClass  = hasPosEntrada ? (m.pctPos < 30 ? 'td-warn' : 'td-alert') : '';
    const stockPre = m.stockPreKg != null ? `${_agrFmtStock(m.stockPreKg)}<br><span class="td-muted" style="font-size:9.5px">${m.stockPreDate||''}</span>` : '—';
    const stockPos = m.stockPosKg != null ? `${_agrFmtStock(m.stockPosKg)}<br><span class="td-muted" style="font-size:9.5px">${m.stockPosDate||''}</span>` : '—';
    return `
      <tr>
        <td class="td-mono">${escapeHtml(m.material)}</td>
        <td class="td-mono agr-td-multi">${fmtUMCol('pre')}</td>
        <td class="td-mono agr-td-multi ${posCellClass}">${fmtUMCol('pos')}</td>
        <td><div class="agr-pct-bar-wrap"><div class="agr-pct-bar-track"><div class="agr-pct-bar-fill" style="width:${pctFill}%;background:${pctColor}"></div></div><span class="agr-pct-label ${pctClass2}">${pctLabel}</span></div></td>
        <td class="td-mono agr-td-multi td-muted">${fmtCarCol('pre')}</td>
        <td class="td-mono agr-td-multi">${fmtCarCol('pos')}</td>
        <td class="td-mono ${m.consumoPreKg > 0 ? '' : 'td-muted'}">${m.consumoPreKg > 0 ? _agrSmartFmt(m.consumoPreKg / 1000) + ' t' + (m.consumoPreCount ? '<br><span class=\"td-muted\" style=\"font-size:9.5px\">' + m.consumoPreCount + ' OS</span>' : '') : '—'}</td>
        <td class="td-mono ${m.consumoPosKg > 0 ? 'td-warn' : 'td-muted'}">${m.consumoPosKg > 0 ? _agrSmartFmt(m.consumoPosKg / 1000) + ' t' + (m.consumoPosCount ? '<br><span class=\"td-muted\" style=\"font-size:9.5px\">' + m.consumoPosCount + ' OS</span>' : '') : '—'}</td>
        <td>${_agrJustifBadge(m.posRaw, m.consumoPosKg)}</td>
        <td class="td-mono">${stockPre}</td>
        <td class="td-mono">${stockPos}</td>
      </tr>`;
  }).join('');
}

Object.assign(window, { rodarControleAgregados, rodarControleAgregadosPorPeriodo, _agrToggle, agrToggleMonthPicker, agrMonthNavYear, _agrSelectMonth, agrQuickMesAtual, agrQuickMesAnterior, agrToggleLegend, agrApplyFilters, agrClearFilters, agrToggleDropdown, agrCloseDropdown, agrClearDropdown, agrFilterDropdownSearch, agrSetManualCutoff, agrSetRegionalSelecionado, _agrResumoRowClick, agrVoltarResumo });
