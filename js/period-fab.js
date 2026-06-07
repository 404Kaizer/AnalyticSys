// ═══════════════════════════════════════════════════════════
// PERIOD FAB
// ═══════════════════════════════════════════════════════════
(function() {
  function toISO(d) {
    return localISODate(d);
  }

  // Detect which page is active: 'dashboard' | 'analitico' | null
  function activePage() {
    if (document.getElementById('page-dashboard')?.classList.contains('active')) return 'dashboard';
    if (document.getElementById('page-analitico')?.classList.contains('active')) return 'analitico';
    return null;
  }

  // Return true if content panel is currently visible for the active page
  function contentVisible() {
    const pg = activePage();
    if (pg === 'dashboard') return document.getElementById('dg-content')?.style.display !== 'none';
    if (pg === 'analitico') return document.getElementById('an-content')?.style.display !== 'none';
    return false;
  }

  // Get active period dates from the current page toolbar
  function getActiveDates() {
    const pg = activePage();
    const pfx = pg === 'dashboard' ? 'dg' : 'an';
    return {
      ini: document.getElementById(pfx + '-dt-ini')?.value || '',
      fim: document.getElementById(pfx + '-dt-fim')?.value || '',
    };
  }

  function fmtShort(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return d + '/' + m + '/' + y.slice(2);
  }

  function syncFabLabel() {
    const { ini, fim } = getActiveDates();
    const label = document.getElementById('fab-period-label');
    const trigger = document.getElementById('period-fab-trigger');
    if (label) label.textContent = (ini && fim) ? fmtShort(ini) + ' → ' + fmtShort(fim) : 'Período';
    if (trigger) trigger.classList.toggle('active', !!(ini && fim));
  }

  function syncFabInputs() {
    const { ini, fim } = getActiveDates();
    const fabIni = document.getElementById('fab-dt-ini');
    const fabFim = document.getElementById('fab-dt-fim');
    if (fabIni) fabIni.value = ini;
    if (fabFim) fabFim.value = fim;
  }

  window.updatePeriodFab = function() {
    const fab = document.getElementById('period-fab');
    if (!fab) return;
    const show = contentVisible();
    fab.classList.toggle('visible', show);
    if (show) { syncFabLabel(); syncFabInputs(); }
    else closePeriodFab();
  };

  window.togglePeriodFab = function() {
    const popover = document.getElementById('period-fab-popover');
    const chev = document.getElementById('fab-chev');
    if (!popover) return;
    const opening = !popover.classList.contains('open');
    popover.classList.toggle('open', opening);
    if (chev) chev.style.transform = opening ? 'rotate(180deg)' : '';
    if (opening) syncFabInputs();
  };

  window.closePeriodFab = function() {
    const popover = document.getElementById('period-fab-popover');
    const chev = document.getElementById('fab-chev');
    if (popover) popover.classList.remove('open');
    if (chev) chev.style.transform = '';
  };

  // Push FAB values back to the toolbar and run analysis
  window.fabAnalisar = function() {
    const pg = activePage();
    const pfx = pg === 'dashboard' ? 'dg' : 'an';
    const fabIni = document.getElementById('fab-dt-ini')?.value;
    const fabFim = document.getElementById('fab-dt-fim')?.value;
    const toolIni = document.getElementById(pfx + '-dt-ini');
    const toolFim = document.getElementById(pfx + '-dt-fim');
    if (toolIni && fabIni) toolIni.value = fabIni;
    if (toolFim && fabFim) toolFim.value = fabFim;
    closePeriodFab();
    if (pg === 'dashboard') rodarDashboardGerencial();
    else rodarAnalitico();
    syncFabLabel();
  };

  // Quick period helpers for FAB
  window.fabQuickPeriod = function(days) {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days + 1);
    const ini = document.getElementById('fab-dt-ini');
    const fim = document.getElementById('fab-dt-fim');
    if (ini) ini.value = toISO(start);
    if (fim) fim.value = toISO(end);
    document.querySelectorAll('#fab-qp-btns .qp-btn').forEach(b => b.classList.remove('active'));
    event?.target?.classList.add('active');
  };
  window.fabQuickPeriodHoje = function() {
    const today = new Date();
    const ini = document.getElementById('fab-dt-ini');
    const fim = document.getElementById('fab-dt-fim');
    if (ini) ini.value = toISO(today);
    if (fim) fim.value = toISO(today);
    document.querySelectorAll('#fab-qp-btns .qp-btn').forEach(b => b.classList.remove('active'));
    event?.target?.classList.add('active');
  };
  window.fabQuickPeriodMesAnterior = function() {
    const now = new Date();
    const prevMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
    const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const ini = document.getElementById('fab-dt-ini');
    const fim = document.getElementById('fab-dt-fim');
    if (ini) ini.value = toISO(new Date(prevYear, prevMonth, 1));
    if (fim) fim.value = toISO(new Date(prevYear, prevMonth + 1, 0));
    document.querySelectorAll('#fab-qp-btns .qp-btn').forEach(b => b.classList.remove('active'));
    event?.target?.classList.add('active');
  };
  window.fabQuickPeriodMes = function() {
    const now = new Date();
    const ini = document.getElementById('fab-dt-ini');
    const fim = document.getElementById('fab-dt-fim');
    if (ini) ini.value = toISO(new Date(now.getFullYear(), now.getMonth(), 1));
    if (fim) fim.value = toISO(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    document.querySelectorAll('#fab-qp-btns .qp-btn').forEach(b => b.classList.remove('active'));
    event?.target?.classList.add('active');
  };

  // Close popover when clicking outside
  document.addEventListener('click', function(e) {
    const fab = document.getElementById('period-fab');
    if (fab && !fab.contains(e.target)) closePeriodFab();
  });
})();
