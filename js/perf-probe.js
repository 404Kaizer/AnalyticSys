'use strict';
// ── perf-probe.js — sonda TEMPORÁRIA de performance (auditoria set/2026) ──
// NÃO está no index.html. Dois modos de uso:
//
//  A) Pós-boot (console, F12 → Console):
//       var s=document.createElement('script');s.src='js/perf-probe.js?'+Date.now();document.head.appendChild(s);
//     Mede tudo a partir daqui. Do boot só recupera o que o browser bufferizou
//     (long tasks, navigation/resource timing) — sem a quebra por etapa.
//
//  B) Boot completo (temporário): coloque como PRIMEIRA linha de <script> no
//     <head> do index.html, SEM defer:  <script src="js/perf-probe.js"></script>
//     A sonda registra o listener de DOMContentLoaded antes de analitico.js
//     (init), então envolve as funções de boot antes de elas rodarem.
//     Remova a linha quando terminar.
//
//  Em ambos: rode os cenários, depois  __perf.report()  e cole a saída.
//  __perf.reset() zera os acumuladores entre cenários.
//
// ponytail: teto = instrumentação por monkey-patch de globais; caminho de
// upgrade = nenhum, o arquivo é descartado ao fim da auditoria.
(function () {
  if (window.__perf) { console.warn('[perf] já carregado'); return; }

  const P = window.__perf = {
    longtasks: [],   // { start, dur, attribution }
    measures: {},    // name → { n, total, max, last }
    events: [],      // { name, dur, start } (INP candidates, >16ms)
    marks: [],       // marcos manuais: __perf.mark('cenario X')
    t0: performance.timeOrigin,
  };

  // ── Observers ─────────────────────────────────────────────────────────
  const obs = (type, cb, extra) => {
    try {
      new PerformanceObserver(l => l.getEntries().forEach(cb))
        .observe(Object.assign({ type, buffered: true }, extra || {}));
    } catch (e) { console.warn('[perf] observer indisponível:', type, e.message); }
  };
  obs('longtask', e => P.longtasks.push({
    start: Math.round(e.startTime), dur: Math.round(e.duration),
    attribution: e.attribution?.[0]?.containerType || e.name,
  }));
  obs('measure', e => {
    const m = P.measures[e.name] || (P.measures[e.name] = { n: 0, total: 0, max: 0, last: 0 });
    m.n++; m.total += e.duration; m.max = Math.max(m.max, e.duration); m.last = e.duration;
    performance.clearMeasures(e.name); // já agregado — não deixa o buffer crescer
  });
  obs('event', e => P.events.push({
    name: e.name, dur: Math.round(e.duration), start: Math.round(e.startTime),
    target: e.target?.id || e.target?.className?.toString().slice(0, 40) || '',
  }), { durationThreshold: 16 });

  // ── Wrapper mark/measure (sync e async) ───────────────────────────────
  function wrap(name, group) {
    const orig = window[name];
    if (typeof orig !== 'function' || orig.__perfWrapped) return false;
    const label = `${group}:${name}`;
    const w = function () {
      const s = performance.now();
      const done = () => performance.measure(label, { start: s, end: performance.now() });
      let r;
      try { r = orig.apply(this, arguments); }
      catch (err) { done(); throw err; }
      if (r && typeof r.then === 'function') return r.finally(done);
      done();
      return r;
    };
    w.__perfWrapped = true;
    Object.defineProperty(w, 'name', { value: name });
    window[name] = w;
    return true;
  }

  // Funções-chave por fluxo (só envolve as que existem; MISSING é normal
  // para módulos ainda não carregados).
  const TARGETS = {
    boot: ['restoreAndRender', 'loadState', 'applySavedState', 'loadSapChunks',
      'reaplicarPadronizacaoMateriais', 'migrarCategoriaLegadaMateriais',
      '_buildSapIndex', '_buildLancIndex', '_buildSaidasIndex',
      'notifSilentHealthCheck', 'restaurarBackupCondensadoSeNecessario',
      'renderFiliais', 'renderMateriais', 'initResizable'],
    import: ['handleImport', 'sanitizeWorksheet', '_parseCsvToRows',
      'processImportedRows', '_detectConflicts', '_mergeWithConflictCheck',
      '_mergeDedup', 'detectSapHeaderRow', 'buildSapColumnMap'],
    nav: ['navigate', 'renderPage', 'renderAll', 'updateDashboard',
      'buildDashboardGerencialResults', 'renderDgGiro', '_ausComputar',
      'renderEntradas', 'renderSaidas', 'renderLancamentos', 'renderSAP',
      'renderCustosSap', 'renderImports', 'renderOcorrenciasPage',
      'renderAdminPage', 'anSwitchView', 'rodarAnalitico', '_rodarAnaliticoCore',
      'renderAnaliticoMicro', 'buildCentralCard', '_agrCompute', '_dgResizeCharts'],
    filter: ['getFilteredData', '_getModuleTextFilteredData', '_applyModuleSort',
      'applyColFilter', 'filterRecords', '_getOrBuildIndex', 'getListFilteredData'],
    // NÃO envolver funções chamadas por registro (recordPassesColFilters,
    // parseDate, normalizeText…): 1 measure por linha × 1M = a sonda vira o gargalo.
    persist: ['persist', 'persistStateNow', 'buildStateSnapshot',
      'compactSapRecords', 'saveSapChunks', 'idbPut', '_emergencySave',
      '_cbUploadModulo', '_cbGzipString', '_cbSha256Hex', 'exportarDados'],
  };
  function wrapAll() {
    const out = {};
    for (const g in TARGETS) out[g] = TARGETS[g].filter(n => wrap(n, g));
    // XLSX é objeto, não global solto — envolve os dois métodos que importam.
    if (window.XLSX && !XLSX.__perfWrapped) {
      const rd = XLSX.read, sj = XLSX.utils.sheet_to_json;
      XLSX.read = function () { const s = performance.now(); try { return rd.apply(this, arguments); } finally { performance.measure('import:XLSX.read', { start: s, end: performance.now() }); } };
      XLSX.utils.sheet_to_json = function () { const s = performance.now(); try { return sj.apply(this, arguments); } finally { performance.measure('import:XLSX.sheet_to_json', { start: s, end: performance.now() }); } };
      XLSX.__perfWrapped = true;
      (out.import || (out.import = [])).push('XLSX.read', 'XLSX.sheet_to_json');
    }
    // FileReader: do onload até o fim é tudo síncrono em handleImport; mede a leitura.
    if (!FileReader.prototype.__perfWrapped) {
      for (const m of ['readAsArrayBuffer', 'readAsText']) {
        const o = FileReader.prototype[m];
        FileReader.prototype[m] = function () {
          const s = performance.now();
          this.addEventListener('loadend', () => performance.measure('import:FileReader.' + m, { start: s, end: performance.now() }), { once: true });
          return o.apply(this, arguments);
        };
      }
      FileReader.prototype.__perfWrapped = true;
    }
    P.wrapped = out;
    console.info('[perf] funções envolvidas:', out);
  }

  // Modo B (carregado antes dos defer): espera o DOM; o listener foi
  // registrado antes do init() de analitico.js, então roda primeiro.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wrapAll);
    P.mode = 'boot';
  } else {
    wrapAll();
    P.mode = 'pos-boot';
  }

  // ── Coletores ─────────────────────────────────────────────────────────
  const kb = n => (n / 1024).toFixed(0) + ' KB';
  const mb = n => (n / 1048576).toFixed(1) + ' MB';

  function memory() {
    const m = performance.memory;
    return m ? { usedJSHeap: mb(m.usedJSHeapSize), totalJSHeap: mb(m.totalJSHeapSize), limit: mb(m.jsHeapSizeLimit) }
             : { info: 'performance.memory indisponível (só Chrome/Edge)' };
  }
  function localStorageSizes() {
    const rows = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i); const v = localStorage.getItem(k) || '';
        rows.push({ chave: k, bytes: v.length * 2, tamanho: kb(v.length * 2) }); // UTF-16
      }
    } catch (e) { rows.push({ chave: 'erro', tamanho: e.message }); }
    return rows.sort((a, b) => b.bytes - a.bytes);
  }
  function idbSizes() {
    return new Promise(res => {
      const rows = [];
      setTimeout(() => res([{ chave: 'timeout', tamanho: 'varredura >20 s — IDB ocupado ou indisponível' }]), 20000);
      let req; try { req = indexedDB.open('central_analise_db_v1'); } catch (e) { return res([{ chave: 'erro', tamanho: e.message }]); }
      req.onerror = () => res([{ chave: 'erro', tamanho: 'não abriu' }]);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) { db.close(); return res(rows); }
        const st = db.transaction('kv', 'readonly').objectStore('kv');
        const cur = st.openCursor();
        const s = performance.now();
        cur.onsuccess = ev => {
          const c = ev.target.result;
          if (!c) {
            db.close();
            performance.measure('probe:idb-scan', { start: s, end: performance.now() });
            const sap = rows.filter(r => r.chave.startsWith('sap_chunk_'));
            const outros = rows.filter(r => !r.chave.startsWith('sap_chunk_'));
            if (sap.length) outros.push({ chave: `sap_chunk_* (${sap.length} chunks)`, bytes: sap.reduce((a, r) => a + r.bytes, 0), registros: sap.reduce((a, r) => a + (r.registros || 0), 0) });
            return res(outros.map(r => ({ ...r, tamanho: mb(r.bytes) })).sort((a, b) => b.bytes - a.bytes));
          }
          const v = c.value?.value ?? c.value;
          // tamanho aproximado: JSON — é o que domina o custo de structured clone
          let bytes = 0; try { bytes = JSON.stringify(v).length; } catch (e) { bytes = -1; }
          rows.push({ chave: String(c.key), bytes, registros: Array.isArray(v) ? v.length : undefined });
          c.continue();
        };
      };
    });
  }
  function stateCounts() {
    const s = window.state || {}; const out = {};
    for (const k of Object.keys(s)) if (Array.isArray(s[k]) && s[k].length) out[k] = s[k].length;
    return out;
  }
  function scriptTiming() {
    return performance.getEntriesByType('resource')
      .filter(r => /\.js(\?|$)/.test(r.name))
      .map(r => ({ script: r.name.replace(/^.*\/(js\/)?/, ''), transfer: kb(r.transferSize || 0), decoded: kb(r.decodedBodySize || 0), ms: Math.round(r.duration) }))
      .sort((a, b) => b.ms - a.ms);
  }
  function navTiming() {
    const n = performance.getEntriesByType('navigation')[0];
    if (!n) return {};
    return { ttfb: Math.round(n.responseStart), domInteractive: Math.round(n.domInteractive),
             DOMContentLoaded: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd),
             transfer: kb(n.transferSize), decoded: kb(n.decodedBodySize) };
  }

  // ── API pública ───────────────────────────────────────────────────────
  P.mark = label => { P.marks.push({ t: Math.round(performance.now()), label }); performance.mark('probe:' + label); };
  P.reset = () => { P.longtasks.length = 0; P.events.length = 0; P.marks.length = 0; for (const k in P.measures) delete P.measures[k]; console.info('[perf] zerado'); };
  P.snapshot = async () => ({ memory: memory(), state: stateCounts(), localStorage: localStorageSizes(), indexedDB: await idbSizes() });

  P.report = async function (titulo) {
    const lt = P.longtasks;
    const ltTotal = lt.reduce((a, t) => a + t.dur, 0);
    const worst = [...lt].sort((a, b) => b.dur - a.dur).slice(0, 10);
    const inp = [...P.events].sort((a, b) => b.dur - a.dur);
    const meas = Object.entries(P.measures).map(([name, m]) => ({
      medida: name, n: m.n, total_ms: Math.round(m.total), max_ms: Math.round(m.max), media_ms: Math.round(m.total / m.n),
    })).sort((a, b) => b.total_ms - a.total_ms);

    const snap = await P.snapshot();
    const out = [];
    const H = s => out.push('\n### ' + s);
    const T = rows => { if (!rows.length) return out.push('(vazio)'); const cols = Object.keys(rows[0]); out.push('| ' + cols.join(' | ') + ' |', '|' + cols.map(() => '---').join('|') + '|'); rows.forEach(r => out.push('| ' + cols.map(c => r[c] ?? '').join(' | ') + ' |')); };

    out.push(`## perf-probe — ${titulo || 'relatório'} — modo ${P.mode} — ${new Date().toLocaleString('pt-BR')}`);
    out.push(`UA: ${navigator.userAgent.split(') ').pop()} · CPU lógicas: ${navigator.hardwareConcurrency} · RAM aprox.: ${navigator.deviceMemory || '?'} GB · aba visível: ${document.visibilityState}`);
    H('Long tasks (>50 ms)'); out.push(`total: ${lt.length} · soma: ${ltTotal} ms · pior: ${worst[0]?.dur || 0} ms`); T(worst);
    H('Eventos lentos / INP (pior interação = INP aproximado)'); out.push(`INP ≈ ${inp[0]?.dur || 0} ms · interações >200 ms: ${inp.filter(e => e.dur > 200).length}`); T(inp.slice(0, 10));
    H('Medidas por função (ms)'); T(meas);
    H('Marcos manuais'); T(P.marks);
    H('Memória'); T([snap.memory]);
    H('Registros no state'); T([snap.state]);
    H('localStorage'); T(snap.localStorage);
    H('IndexedDB (central_analise_db_v1/kv)'); T(snap.indexedDB);
    H('Navigation timing (ms desde o início)'); T([navTiming()]);
    H('Scripts (download+decode, ordenado por tempo)'); T(scriptTiming().slice(0, 15));

    const txt = out.join('\n');
    console.log(txt);
    try { await navigator.clipboard.writeText(txt); console.info('[perf] ✓ copiado para a área de transferência'); } catch (e) {}
    return txt;
  };

  console.info(`[perf] sonda ativa (modo ${P.mode}). Use __perf.mark('rótulo'), __perf.reset(), __perf.report('cenário').`);
})();
