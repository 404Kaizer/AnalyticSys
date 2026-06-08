(function() {
  'use strict';

  // ── State per picker ──────────────────────────────────────────
  const pickers = {};

  function getPicker(pfx) {
    if (!pickers[pfx]) {
      pickers[pfx] = {
        pfx,
        viewMode: 'days', // 'days' | 'months' | 'years'
        viewYear: new Date().getFullYear(),
        viewMonth: new Date().getMonth(), // 0-based
        startDate: null,  // Date | null
        endDate: null,    // Date | null
        selecting: 'start', // 'start' | 'end'
        hoverDate: null,  // Date | null
        decadeStart: Math.floor(new Date().getFullYear() / 10) * 10,
      };
    }
    return pickers[pfx];
  }

  function toISO(d) {
    if (!d) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  function fmtDisplay(d) {
    if (!d) return null;
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  }

  function sameDay(a, b) {
    return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function stripTime(d) {
    if (!d) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  // ── Sync hidden inputs ────────────────────────────────────────
  function syncInputs(pfx) {
    const p = getPicker(pfx);
    const iniEl = document.getElementById(pfx + '-dt-ini');
    const fimEl = document.getElementById(pfx + '-dt-fim');
    if (iniEl) iniEl.value = p.startDate ? toISO(p.startDate) : '';
    if (fimEl) fimEl.value = p.endDate ? toISO(p.endDate) : '';
  }

  // ── Update trigger button label ───────────────────────────────
  function updateTriggerLabel(pfx) {
    const p = getPicker(pfx);
    const label = document.getElementById(pfx + '-cal-label');
    const trigger = document.getElementById(pfx + '-cal-trigger');
    if (!label || !trigger) return;
    if (p.startDate && p.endDate) {
      label.textContent = fmtDisplay(p.startDate) + ' → ' + fmtDisplay(p.endDate);
      trigger.classList.add('has-value');
    } else if (p.startDate) {
      label.textContent = fmtDisplay(p.startDate) + ' → …';
      trigger.classList.add('has-value');
    } else {
      label.textContent = 'Selecionar período';
      trigger.classList.remove('has-value');
    }
    // Update FAB if present
    if (window.updatePeriodFab) updatePeriodFab();
  }

  // ── MESES names ────────────────────────────────────────────────
  const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const DIAS_SEMANA = ['D','S','T','Q','Q','S','S'];

  // ── Render calendar ───────────────────────────────────────────
  function renderCal(pfx) {
    const p = getPicker(pfx);
    const container = document.getElementById(pfx + '-cal-inner');
    if (!container) return;

    if (p.viewMode === 'months') {
      renderMonthGrid(pfx, container);
    } else if (p.viewMode === 'years') {
      renderYearGrid(pfx, container);
    } else {
      renderDaysView(pfx, container);
    }
  }

  function renderDaysView(pfx, container) {
    const p = getPicker(pfx);
    const today = stripTime(new Date());
    const year = p.viewYear;
    const month = p.viewMonth;

    // Range info
    const startDisp = p.startDate ? `<span class="cal-range-date">${fmtDisplay(p.startDate)}</span>` : `<span class="cal-range-date empty">início</span>`;
    const endDisp = p.endDate ? `<span class="cal-range-date">${fmtDisplay(p.endDate)}</span>` : `<span class="cal-range-date empty">fim</span>`;

    // Build days grid
    const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrev = new Date(year, month, 0).getDate();

    let daysHtml = DIAS_SEMANA.map(d => `<div class="cal-weekday">${d}</div>`).join('');

    // Previous month filler
    for (let i = firstDay - 1; i >= 0; i--) {
      const dayNum = daysInPrev - i;
      daysHtml += `<button class="cal-day cal-day-other" data-pfx="${pfx}" data-y="${month === 0 ? year-1 : year}" data-m="${month === 0 ? 11 : month-1}" data-d="${dayNum}" onclick="calDayClick(this)">${dayNum}</button>`;
    }

    // Current month
    for (let d = 1; d <= daysInMonth; d++) {
      const thisDate = new Date(year, month, d);
      const isToday = sameDay(thisDate, today);
      const isStart = p.startDate && sameDay(thisDate, p.startDate);
      const isEnd = p.endDate && sameDay(thisDate, p.endDate);

      let rangeFrom = p.startDate;
      let rangeTo = p.endDate;
      if (!rangeTo && p.hoverDate) rangeTo = p.hoverDate;
      if (rangeFrom && rangeTo && rangeFrom > rangeTo) { [rangeFrom, rangeTo] = [rangeTo, rangeFrom]; }

      const inRange = rangeFrom && rangeTo && thisDate > rangeFrom && thisDate < rangeTo;
      const isRangeStart = rangeFrom && sameDay(thisDate, rangeFrom) && rangeTo && !sameDay(rangeFrom, rangeTo);
      const isRangeEnd = rangeTo && sameDay(thisDate, rangeTo) && rangeFrom && !sameDay(rangeFrom, rangeTo);

      let cls = 'cal-day';
      if (isToday) cls += ' cal-day-today';
      if (isStart || isEnd) cls += ' cal-day-selected';
      if (inRange) cls += ' cal-day-in-range';
      if (isRangeStart) cls += ' cal-day-range-start';
      if (isRangeEnd) cls += ' cal-day-range-end';

      daysHtml += `<button class="${cls}" data-pfx="${pfx}" data-y="${year}" data-m="${month}" data-d="${d}" onclick="calDayClick(this)" onmouseenter="calDayHover(this)" onmouseleave="calDayLeave(this)">${d}</button>`;
    }

    // Next month filler
    const totalCells = firstDay + daysInMonth;
    const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let d = 1; d <= remaining; d++) {
      daysHtml += `<button class="cal-day cal-day-other" data-pfx="${pfx}" data-y="${month === 11 ? year+1 : year}" data-m="${month === 11 ? 0 : month+1}" data-d="${d}" onclick="calDayClick(this)">${d}</button>`;
    }

    container.innerHTML = `
      <div class="cal-range-info">
        ${startDisp}
        <span class="cal-range-dash">→</span>
        ${endDisp}
      </div>
      <div class="cal-header">
        <button class="cal-nav-btn" onclick="calNavMonth('${pfx}', -1)" type="button"><i class="ti ti-chevron-left"></i></button>
        <button class="cal-header-center" onclick="calSwitchView('${pfx}', 'months')" type="button">${MESES[month].toUpperCase()} ${year}</button>
        <button class="cal-nav-btn" onclick="calNavMonth('${pfx}', 1)" type="button"><i class="ti ti-chevron-right"></i></button>
      </div>
      <div class="cal-weekdays">${daysHtml.slice(0, DIAS_SEMANA.length * 30)}</div>
      <div class="cal-days">${daysHtml.slice(DIAS_SEMANA.length * 30)}</div>
      `;

    // Re-render weekday labels and days properly
    container.innerHTML = `
      <div class="cal-range-info">
        ${startDisp}
        <span class="cal-range-dash">→</span>
        ${endDisp}
      </div>
      <div class="cal-header">
        <button class="cal-nav-btn" onclick="calNavMonth('${pfx}', -1)" type="button"><i class="ti ti-chevron-left"></i></button>
        <button class="cal-header-center" onclick="calSwitchView('${pfx}', 'months')" type="button">${MESES[month].toUpperCase()} ${year}</button>
        <button class="cal-nav-btn" onclick="calNavMonth('${pfx}', 1)" type="button"><i class="ti ti-chevron-right"></i></button>
      </div>
      <div class="cal-weekdays">
        ${DIAS_SEMANA.map(d => `<div class="cal-weekday">${d}</div>`).join('')}
      </div>
      <div class="cal-days" id="${pfx}-cal-days-grid"></div>
      `;

    // Build day cells
    const grid = document.getElementById(pfx + '-cal-days-grid');
    if (!grid) return;

    // Previous month filler
    const fillerPrev = [];
    for (let i = firstDay - 1; i >= 0; i--) {
      const dayNum = daysInPrev - i;
      const prevM = month === 0 ? 11 : month - 1;
      const prevY = month === 0 ? year - 1 : year;
      const btn = document.createElement('button');
      btn.className = 'cal-day cal-day-other';
      btn.type = 'button';
      btn.textContent = dayNum;
      btn.dataset.pfx = pfx;
      btn.dataset.y = prevY;
      btn.dataset.m = prevM;
      btn.dataset.d = dayNum;
      btn.addEventListener('click', () => { btn.dataset.pfx = pfx; calDayClick(btn); });
      grid.appendChild(btn);
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
      const thisDate = new Date(year, month, d);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = d;
      btn.dataset.pfx = pfx;
      btn.dataset.y = year;
      btn.dataset.m = month;
      btn.dataset.d = d;

      const isToday = sameDay(thisDate, today);
      let cls = 'cal-day';
      if (isToday) cls += ' cal-day-today';

      btn.className = cls;
      applyRangeClass(btn, thisDate, p);

      btn.addEventListener('click', () => calDayClick(btn));
      btn.addEventListener('mouseenter', () => calDayHover(btn));
      btn.addEventListener('mouseleave', () => calDayLeave(btn));
      grid.appendChild(btn);
    }

    // Next month filler
    const totalCells2 = firstDay + daysInMonth;
    const rem2 = totalCells2 % 7 === 0 ? 0 : 7 - (totalCells2 % 7);
    for (let d = 1; d <= rem2; d++) {
      const nextM = month === 11 ? 0 : month + 1;
      const nextY = month === 11 ? year + 1 : year;
      const btn = document.createElement('button');
      btn.className = 'cal-day cal-day-other';
      btn.type = 'button';
      btn.textContent = d;
      btn.dataset.pfx = pfx;
      btn.dataset.y = nextY;
      btn.dataset.m = nextM;
      btn.dataset.d = d;
      btn.addEventListener('click', () => calDayClick(btn));
      grid.appendChild(btn);
    }
  }

  function applyRangeClass(btn, thisDate, p) {
    let rangeFrom = p.startDate ? stripTime(p.startDate) : null;
    let rangeTo = p.endDate ? stripTime(p.endDate) : (p.hoverDate ? stripTime(p.hoverDate) : null);
    if (rangeFrom && rangeTo && rangeFrom > rangeTo) { [rangeFrom, rangeTo] = [rangeTo, rangeFrom]; }

    const isStart = rangeFrom && sameDay(thisDate, rangeFrom);
    const isEnd = rangeTo && sameDay(thisDate, rangeTo);
    const inRange = rangeFrom && rangeTo && thisDate > rangeFrom && thisDate < rangeTo;
    const isSingle = rangeFrom && rangeTo && sameDay(rangeFrom, rangeTo);

    btn.classList.remove('cal-day-selected', 'cal-day-in-range', 'cal-day-range-start', 'cal-day-range-end');

    if (isStart && isEnd) { btn.classList.add('cal-day-selected'); }
    else if (isStart) { btn.classList.add('cal-day-range-start'); }
    else if (isEnd) { btn.classList.add('cal-day-range-end'); }
    else if (inRange) { btn.classList.add('cal-day-in-range'); }
  }

  function renderMonthGrid(pfx, container) {
    const p = getPicker(pfx);
    const year = p.viewYear;
    const curMonth = new Date().getMonth();
    const curYear = new Date().getFullYear();

    const items = MESES.map((name, i) => {
      const active = i === p.viewMonth && year === p.viewYear ? ' active' : '';
      const shortName = name.slice(0, 3);
      return `<button class="cal-grid-item${active}" onclick="calSelectMonth('${pfx}', ${i})" type="button">${shortName}</button>`;
    }).join('');

    container.innerHTML = `
      <div class="cal-header">
        <button class="cal-nav-btn" onclick="calNavYear('${pfx}', -1)" type="button"><i class="ti ti-chevron-left"></i></button>
        <button class="cal-header-center" onclick="calSwitchView('${pfx}', 'years')" type="button">${year}</button>
        <button class="cal-nav-btn" onclick="calNavYear('${pfx}', 1)" type="button"><i class="ti ti-chevron-right"></i></button>
      </div>
      <div class="cal-month-grid">${items}</div>`;
  }

  function renderYearGrid(pfx, container) {
    const p = getPicker(pfx);
    const start = p.decadeStart;
    const years = Array.from({length: 12}, (_, i) => start + i);

    const items = years.map(y => {
      const active = y === p.viewYear ? ' active' : '';
      return `<button class="cal-grid-item${active}" onclick="calSelectYear('${pfx}', ${y})" type="button">${y}</button>`;
    }).join('');

    container.innerHTML = `
      <div class="cal-year-header">
        <button class="cal-nav-btn" onclick="calNavDecade('${pfx}', -1)" type="button"><i class="ti ti-chevron-left"></i></button>
        <span class="cal-year-range">${start} – ${start + 11}</span>
        <button class="cal-nav-btn" onclick="calNavDecade('${pfx}', 1)" type="button"><i class="ti ti-chevron-right"></i></button>
      </div>
      <div class="cal-year-grid">${items}</div>`;
  }

  // ── Navigation ─────────────────────────────────────────────────
  window.calNavMonth = function(pfx, dir) {
    const p = getPicker(pfx);
    p.viewMonth += dir;
    if (p.viewMonth > 11) { p.viewMonth = 0; p.viewYear++; }
    if (p.viewMonth < 0)  { p.viewMonth = 11; p.viewYear--; }
    renderCal(pfx);
  };

  window.calNavYear = function(pfx, dir) {
    const p = getPicker(pfx);
    p.viewYear += dir;
    renderCal(pfx);
  };

  window.calNavDecade = function(pfx, dir) {
    const p = getPicker(pfx);
    p.decadeStart += dir * 12;
    renderCal(pfx);
  };

  window.calSwitchView = function(pfx, mode) {
    const p = getPicker(pfx);
    p.viewMode = mode;
    if (mode === 'years') {
      p.decadeStart = Math.floor(p.viewYear / 12) * 12;
    }
    renderCal(pfx);
  };

  window.calSelectMonth = function(pfx, month) {
    const p = getPicker(pfx);
    p.viewMonth = month;
    p.viewMode = 'days';
    renderCal(pfx);
  };

  window.calSelectYear = function(pfx, year) {
    const p = getPicker(pfx);
    p.viewYear = year;
    p.viewMode = 'months';
    renderCal(pfx);
  };

  // ── Day selection ──────────────────────────────────────────────
  window.calDayClick = function(btn) {
    const pfx = btn.dataset.pfx;
    const p = getPicker(pfx);
    const clicked = new Date(Number(btn.dataset.y), Number(btn.dataset.m), Number(btn.dataset.d));

    // If cross-month click, navigate to that month
    const clickedMonth = Number(btn.dataset.m);
    const clickedYear = Number(btn.dataset.y);
    if (clickedMonth !== p.viewMonth || clickedYear !== p.viewYear) {
      p.viewMonth = clickedMonth;
      p.viewYear = clickedYear;
    }

    if (!p.startDate || p.selecting === 'start' || (p.startDate && p.endDate)) {
      // Start fresh selection
      p.startDate = clicked;
      p.endDate = null;
      p.selecting = 'end';
    } else {
      // Second click = end
      if (clicked < p.startDate) {
        p.endDate = p.startDate;
        p.startDate = clicked;
      } else {
        p.endDate = clicked;
      }
      p.selecting = 'start';
    }

    p.hoverDate = null;
    syncInputs(pfx);
    updateTriggerLabel(pfx);
    renderCal(pfx);

    // Callback: disparar renderAusencias quando range estiver completo
    if (pfx === 'aus' && p.startDate && p.endDate && typeof renderAusencias === 'function') {
      renderAusencias();
    }


  };

  window.calDayHover = function(btn) {
    const pfx = btn.dataset.pfx;
    const p = getPicker(pfx);
    if (p.startDate && !p.endDate) {
      p.hoverDate = new Date(Number(btn.dataset.y), Number(btn.dataset.m), Number(btn.dataset.d));
      // Re-apply range classes to all day cells
      const grid = document.getElementById(pfx + '-cal-days-grid');
      if (grid) {
        grid.querySelectorAll('.cal-day:not(.cal-day-other)').forEach(b => {
          const d = new Date(Number(b.dataset.y), Number(b.dataset.m), Number(b.dataset.d));
          applyRangeClass(b, d, p);
        });
      }
    }
  };

  window.calDayLeave = function(btn) {
    const pfx = btn.dataset.pfx;
    const p = getPicker(pfx);
    if (p.hoverDate) {
      p.hoverDate = null;
      const grid = document.getElementById(pfx + '-cal-days-grid');
      if (grid) {
        grid.querySelectorAll('.cal-day:not(.cal-day-other)').forEach(b => {
          const d = new Date(Number(b.dataset.y), Number(b.dataset.m), Number(b.dataset.d));
          applyRangeClass(b, d, p);
        });
      }
    }
  };

  // ── Quick period setters ───────────────────────────────────────
  function setRange(pfx, startDate, endDate) {
    const p = getPicker(pfx);
    p.startDate = startDate;
    p.endDate = endDate;
    p.selecting = 'start';
    p.hoverDate = null;
    p.viewYear = startDate.getFullYear();
    p.viewMonth = startDate.getMonth();
    syncInputs(pfx);
    updateTriggerLabel(pfx);
    renderCal(pfx);
    // Clear active state on chips
    const wrap = document.getElementById(pfx + '-cal-wrap');
    if (wrap) wrap.querySelectorAll('.cal-footer-chip').forEach(b => b.classList.remove('active'));
  }

  // Outside chips
  // Expose setRange publicly for external use
  window.calSetRange = function(pfx, iniISO, fimISO) {
    const start = new Date(iniISO + 'T00:00:00');
    const end   = new Date(fimISO + 'T23:59:59');
    if (isNaN(start) || isNaN(end)) return;
    setRange(pfx, start, end);
  };

  window.calQuickHoje = function(pfx) {
    const d = new Date();
    const today = stripTime(d);
    setRange(pfx, today, today);
    markOutsideChip(pfx, 0);
  };
  window.calQuickMesAtual = function(pfx) {
    const now = new Date();
    setRange(pfx, new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 0));
    markOutsideChip(pfx, 1);
  };
  window.calQuickMesAnterior = function(pfx) {
    const now = new Date();
    const prevMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
    const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    setRange(pfx, new Date(prevYear, prevMonth, 1), new Date(prevYear, prevMonth + 1, 0));
    markOutsideChip(pfx, 2);
  };

  // Footer chips inside calendar

  function markOutsideChip(pfx, idx) {
    const chips = document.querySelectorAll(`[onclick^="calQuick"][onclick*="'${pfx}'"]`);
    chips.forEach((c, i) => c.classList.toggle('active', i === idx));
  }

  // ── Toggle dropdown ───────────────────────────────────────────
  window.toggleCalPicker = function(pfx) {
    const dropdown = document.getElementById(pfx + '-cal-dropdown');
    const trigger = document.getElementById(pfx + '-cal-trigger');
    if (!dropdown) return;
    const isOpen = dropdown.classList.contains('open');
    // Close all other pickers first
    document.querySelectorAll('.cal-picker-dropdown.open').forEach(el => {
      if (el !== dropdown) {
        el.classList.remove('open');
        const t = document.getElementById(el.id.replace('-cal-dropdown', '-cal-trigger'));
        if (t) t.classList.remove('open');
      }
    });
    if (isOpen) {
      dropdown.classList.remove('open');
      if (trigger) trigger.classList.remove('open');
    } else {
      dropdown.classList.add('open');
      if (trigger) trigger.classList.add('open');
      renderCal(pfx);
    }
  };

  // Prevent clicks INSIDE the dropdown from bubbling to document
  document.addEventListener('DOMContentLoaded', function() {
    ['dg-cal-dropdown', 'an-cal-dropdown', 'inv-cal-dropdown', 'aus-cal-dropdown'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('click', function(e) { e.stopPropagation(); });
    });
  });

  // Close aus filter dropdowns when clicking outside
  document.addEventListener('click', function(e) {
    ['aus-fd-central', 'aus-fd-mat'].forEach(function(id) {
      const dd = document.getElementById(id);
      const key = id.replace('aus-fd-', '');
      const trigger = document.getElementById('aus-ft-' + key);
      if (dd && dd.classList.contains('open') && !dd.contains(e.target) && !trigger?.contains(e.target)) {
        dd.classList.remove('open');
        document.getElementById('aus-fc-' + key)?.classList.remove('open');
        if (window._ausFilter) _ausFilter.pending[key] = new Set(_ausFilter.applied[key]);
      }
    });
  });

  // Close when clicking outside (original)
  document.addEventListener('click', function(e) {
    document.querySelectorAll('.cal-picker-dropdown.open').forEach(function(el) {
      var wrap = el.closest('.cal-picker-wrap');
      if (wrap && !wrap.contains(e.target)) {
        el.classList.remove('open');
        var pfx = el.id.replace('-cal-dropdown', '');
        var t = document.getElementById(pfx + '-cal-trigger');
        if (t) t.classList.remove('open');
      }
    });
  });

  // ── limparAnalitico patch: also reset picker ──────────────────
  const _origLimparAn = window.limparAnalitico;
  window.limparAnalitico = function() {
    const p = getPicker('an');
    p.startDate = null;
    p.endDate = null;
    p.selecting = 'start';
    p.hoverDate = null;
    syncInputs('an');
    updateTriggerLabel('an');
    // Clear chip active states
    document.querySelectorAll('[onclick^="calQuick"][onclick*="\'an\'"]').forEach(b => b.classList.remove('active'));
    if (_origLimparAn) _origLimparAn();
  };

  const _origLimparDg = window.limparDashboardGerencial;
  window.limparDashboardGerencial = function() {
    const p = getPicker('dg');
    p.startDate = null;
    p.endDate = null;
    p.selecting = 'start';
    p.hoverDate = null;
    syncInputs('dg');
    updateTriggerLabel('dg');
    document.querySelectorAll('[onclick^="calQuick"][onclick*="\'dg\'"]').forEach(b => b.classList.remove('active'));
    if (_origLimparDg) _origLimparDg();
  };

})();
