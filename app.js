/* Rasenpflege — Vanilla JS PWA, alles lokal in localStorage */

const STORAGE_KEY = 'rasenpflege-data';
const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MONTHS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];

let state = loadState();
let currentView = 'lawns';
let calYear, calMonth, calSelectedDate = null;
let statsYear;

const today = new Date();
calYear = today.getFullYear();
calMonth = today.getMonth();
statsYear = today.getFullYear();

/* ---------- Persistence ---------- */

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore corrupt data */ }
  return { lawns: [], fertilizers: [], applications: [] };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ---------- Helpers ---------- */

function fmtNum(n, digits = 1) {
  return n.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function isoDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function fmtDateDe(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

function lawnById(id) { return state.lawns.find(l => l.id === id); }
function fertilizerById(id) { return state.fertilizers.find(f => f.id === id); }

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 2200);
}

/* g Produkt pro m² für eine Anwendung */
function productGPerM2(app) {
  const lawn = lawnById(app.lawnId);
  if (!lawn || !lawn.sizeM2) return 0;
  return (app.amountKg * 1000) / lawn.sizeM2;
}

/* aggregierte Nährstoffe (g/m²) für einen Rasen in einem Jahr: { N: x, P: y, ... } */
function nutrientTotalsForLawnYear(lawnId, year) {
  const totals = {};
  state.applications
    .filter(a => a.lawnId === lawnId && new Date(a.date + 'T00:00:00').getFullYear() === year)
    .forEach(a => {
      const fert = fertilizerById(a.fertilizerId);
      if (!fert) return;
      const gm2 = productGPerM2(a);
      Object.entries(fert.nutrients || {}).forEach(([key, pct]) => {
        totals[key] = (totals[key] || 0) + gm2 * (pct / 100);
      });
    });
  return totals;
}

/* ---------- Modal ---------- */

function openModal(html) {
  document.getElementById('modal-content').innerHTML = html;
  document.getElementById('modal-backdrop').classList.remove('hidden');
}
function closeModal() {
  document.getElementById('modal-backdrop').classList.add('hidden');
  document.getElementById('modal-content').innerHTML = '';
}
document.getElementById('modal-backdrop').addEventListener('click', (e) => {
  if (e.target.id === 'modal-backdrop') closeModal();
});

/* ---------- Tab navigation ---------- */

const viewTitles = { lawns: 'Rasenflächen', fertilizers: 'Dünger', calendar: 'Kalender', stats: 'Statistik' };

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

function switchView(view) {
  currentView = view;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.getElementById('header-title').textContent = viewTitles[view];
  render();
}

function render() {
  const root = document.getElementById('view-root');
  if (currentView === 'lawns') root.innerHTML = renderLawnsView();
  else if (currentView === 'fertilizers') root.innerHTML = renderFertilizersView();
  else if (currentView === 'calendar') root.innerHTML = renderCalendarView();
  else if (currentView === 'stats') root.innerHTML = renderStatsView();
  bindViewEvents();
}

/* ================= LAWNS ================= */

function renderLawnsView() {
  const rows = state.lawns.map(l => {
    const appCount = state.applications.filter(a => a.lawnId === l.id).length;
    const targetChips = Object.entries(l.targets || {}).map(([k, v]) => `<span class="chip">Ziel ${escapeHtml(k)} ${fmtNum(v, 1)} g/m²/J</span>`).join('');
    return `
      <div class="card">
        <div class="card-row">
          <div>
            <p class="card-title">${escapeHtml(l.name)}</p>
            <p class="card-sub">${fmtNum(l.sizeM2, 0)} m² · ${appCount} Düngung${appCount === 1 ? '' : 'en'}</p>
            ${targetChips ? `<div style="margin-top:6px;">${targetChips}</div>` : ''}
          </div>
          <div class="card-row" style="gap:8px;">
            <button class="btn btn-secondary" data-edit-lawn="${l.id}">Bearbeiten</button>
          </div>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="fab-row">
      <button class="btn btn-primary" id="add-lawn-btn">+ Rasenfläche hinzufügen</button>
    </div>
    ${state.lawns.length ? rows : emptyState('🌱', 'Noch keine Rasenfläche angelegt.')}
  `;
}

function lawnFormHtml(lawn) {
  const isEdit = !!lawn;
  const targets = isEdit ? { ...(lawn.targets || {}) } : {};
  const extraTargetKeys = Object.keys(targets).filter(k => !['N', 'P', 'K'].includes(k));
  const extraTargetRows = extraTargetKeys.map(k => targetNutrientRowHtml(k, targets[k])).join('');

  return `
    <div class="modal-header">
      <h2>${isEdit ? 'Rasenfläche bearbeiten' : 'Neue Rasenfläche'}</h2>
      <button class="modal-close" id="modal-close-btn">✕</button>
    </div>
    <form id="lawn-form">
      <div class="form-group">
        <label>Name</label>
        <input type="text" id="lawn-name" required value="${isEdit ? escapeAttr(lawn.name) : ''}" placeholder="z. B. Vorgarten">
      </div>
      <div class="form-group">
        <label>Größe (m²)</label>
        <input type="number" id="lawn-size" required min="1" step="0.1" value="${isEdit ? lawn.sizeM2 : ''}" placeholder="z. B. 120">
      </div>
      <div class="form-group">
        <label>Jahresziel je Nährstoff (g/m² pro Jahr, optional)</label>
        <div class="nutrient-grid">
          <div class="form-group">
            <label>N</label>
            <input type="number" step="0.1" min="0" id="target-N" value="${targets.N !== undefined ? targets.N : ''}">
          </div>
          <div class="form-group">
            <label>P</label>
            <input type="number" step="0.1" min="0" id="target-P" value="${targets.P !== undefined ? targets.P : ''}">
          </div>
          <div class="form-group">
            <label>K</label>
            <input type="number" step="0.1" min="0" id="target-K" value="${targets.K !== undefined ? targets.K : ''}">
          </div>
        </div>
      </div>
      <div id="target-extra-nutrients">${extraTargetRows}</div>
      <button type="button" class="btn btn-secondary" id="add-target-nutrient-btn" style="width:100%;margin-bottom:16px;">+ Weiteres Nährstoffziel hinzufügen</button>
      <button type="submit" class="btn btn-primary">Speichern</button>
      ${isEdit ? `<button type="button" class="btn btn-danger" id="delete-lawn-btn" style="width:100%;margin-top:10px;">Löschen</button>` : ''}
    </form>
  `;
}

function targetNutrientRowHtml(key = '', val = '') {
  const rowId = uid();
  return `
    <div class="extra-nutrient-row" data-row-id="${rowId}">
      <div class="form-group">
        <label>Nährstoff</label>
        <input type="text" class="target-extra-key" placeholder="z. B. Mg" value="${escapeAttr(key)}">
      </div>
      <div class="form-group">
        <label>g/m²/Jahr</label>
        <input type="number" step="0.1" min="0" class="target-extra-val" value="${val}">
      </div>
      <button type="button" class="remove-nutrient-btn" data-remove-row="${rowId}">✕</button>
    </div>`;
}

function bindLawnsEvents() {
  const addBtn = document.getElementById('add-lawn-btn');
  if (addBtn) addBtn.addEventListener('click', () => {
    openModal(lawnFormHtml(null));
    bindLawnFormEvents(null);
  });
  document.querySelectorAll('[data-edit-lawn]').forEach(btn => {
    btn.addEventListener('click', () => {
      const lawn = lawnById(btn.dataset.editLawn);
      openModal(lawnFormHtml(lawn));
      bindLawnFormEvents(lawn);
    });
  });
}

function bindLawnFormEvents(lawn) {
  document.getElementById('modal-close-btn').addEventListener('click', closeModal);

  const bindRemoveButtons = () => {
    document.querySelectorAll('[data-remove-row]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelector(`[data-row-id="${btn.dataset.removeRow}"]`).remove();
      });
    });
  };
  bindRemoveButtons();

  document.getElementById('add-target-nutrient-btn').addEventListener('click', () => {
    document.getElementById('target-extra-nutrients').insertAdjacentHTML('beforeend', targetNutrientRowHtml());
    bindRemoveButtons();
  });

  document.getElementById('lawn-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('lawn-name').value.trim();
    const sizeM2 = parseFloat(document.getElementById('lawn-size').value);
    if (!name || !sizeM2 || sizeM2 <= 0) return;

    const targets = {};
    ['N', 'P', 'K'].forEach(k => {
      const raw = document.getElementById(`target-${k}`).value;
      if (raw !== '') targets[k] = parseFloat(raw) || 0;
    });
    document.querySelectorAll('#target-extra-nutrients .extra-nutrient-row').forEach(row => {
      const key = row.querySelector('.target-extra-key').value.trim();
      const val = row.querySelector('.target-extra-val').value;
      if (key && val !== '') targets[key] = parseFloat(val) || 0;
    });

    if (lawn) {
      lawn.name = name;
      lawn.sizeM2 = sizeM2;
      lawn.targets = targets;
    } else {
      state.lawns.push({ id: uid(), name, sizeM2, targets });
    }
    saveState();
    closeModal();
    toast('Gespeichert');
    render();
  });
  const delBtn = document.getElementById('delete-lawn-btn');
  if (delBtn) delBtn.addEventListener('click', () => {
    if (!confirm(`"${lawn.name}" wirklich löschen? Zugehörige Düngungen werden ebenfalls entfernt.`)) return;
    state.applications = state.applications.filter(a => a.lawnId !== lawn.id);
    state.lawns = state.lawns.filter(l => l.id !== lawn.id);
    saveState();
    closeModal();
    toast('Gelöscht');
    render();
  });
}

/* ================= FERTILIZERS ================= */

function renderFertilizersView() {
  const rows = state.fertilizers.map(f => {
    const chips = Object.entries(f.nutrients || {}).map(([k, v]) => `<span class="chip">${escapeHtml(k)} ${fmtNum(v, 1)}%</span>`).join('');
    return `
      <div class="card">
        <div class="card-row">
          <div>
            <p class="card-title">${escapeHtml(f.name)}</p>
            <div>${chips}</div>
          </div>
          <button class="btn btn-secondary" data-edit-fert="${f.id}">Bearbeiten</button>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="fab-row">
      <button class="btn btn-primary" id="add-fert-btn">+ Dünger hinzufügen</button>
    </div>
    ${state.fertilizers.length ? rows : emptyState('🧪', 'Noch kein Dünger angelegt.')}
  `;
}

function fertilizerFormHtml(fert) {
  const isEdit = !!fert;
  const nutrients = isEdit ? { ...fert.nutrients } : { N: '', P: '', K: '' };
  const extraKeys = Object.keys(nutrients).filter(k => !['N', 'P', 'K'].includes(k));

  const extraRows = extraKeys.map(k => extraNutrientRowHtml(k, nutrients[k])).join('');

  return `
    <div class="modal-header">
      <h2>${isEdit ? 'Dünger bearbeiten' : 'Neuer Dünger'}</h2>
      <button class="modal-close" id="modal-close-btn">✕</button>
    </div>
    <form id="fert-form">
      <div class="form-group">
        <label>Name</label>
        <input type="text" id="fert-name" required value="${isEdit ? escapeAttr(fert.name) : ''}" placeholder="z. B. Cuxin NPK 12-4-6">
      </div>
      <div class="form-group">
        <label>Nährstoffanteile (% je kg Produkt)</label>
        <div class="nutrient-grid">
          <div class="form-group">
            <label>N</label>
            <input type="number" step="0.1" min="0" max="100" id="nutrient-N" value="${nutrients.N !== undefined ? nutrients.N : ''}">
          </div>
          <div class="form-group">
            <label>P</label>
            <input type="number" step="0.1" min="0" max="100" id="nutrient-P" value="${nutrients.P !== undefined ? nutrients.P : ''}">
          </div>
          <div class="form-group">
            <label>K</label>
            <input type="number" step="0.1" min="0" max="100" id="nutrient-K" value="${nutrients.K !== undefined ? nutrients.K : ''}">
          </div>
        </div>
      </div>
      <div id="extra-nutrients">${extraRows}</div>
      <button type="button" class="btn btn-secondary" id="add-nutrient-btn" style="width:100%;margin-bottom:16px;">+ Weiteren Nährstoff hinzufügen</button>
      <button type="submit" class="btn btn-primary">Speichern</button>
      ${isEdit ? `<button type="button" class="btn btn-danger" id="delete-fert-btn" style="width:100%;margin-top:10px;">Löschen</button>` : ''}
    </form>
  `;
}

function extraNutrientRowHtml(key = '', val = '') {
  const rowId = uid();
  return `
    <div class="extra-nutrient-row" data-row-id="${rowId}">
      <div class="form-group">
        <label>Nährstoff</label>
        <input type="text" class="extra-key" placeholder="z. B. Mg" value="${escapeAttr(key)}">
      </div>
      <div class="form-group">
        <label>%</label>
        <input type="number" step="0.1" min="0" max="100" class="extra-val" value="${val}">
      </div>
      <button type="button" class="remove-nutrient-btn" data-remove-row="${rowId}">✕</button>
    </div>`;
}

function bindFertilizersEvents() {
  const addBtn = document.getElementById('add-fert-btn');
  if (addBtn) addBtn.addEventListener('click', () => {
    openModal(fertilizerFormHtml(null));
    bindFertFormEvents(null);
  });
  document.querySelectorAll('[data-edit-fert]').forEach(btn => {
    btn.addEventListener('click', () => {
      const fert = fertilizerById(btn.dataset.editFert);
      openModal(fertilizerFormHtml(fert));
      bindFertFormEvents(fert);
    });
  });
}

function bindFertFormEvents(fert) {
  document.getElementById('modal-close-btn').addEventListener('click', closeModal);

  const bindRemoveButtons = () => {
    document.querySelectorAll('[data-remove-row]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelector(`[data-row-id="${btn.dataset.removeRow}"]`).remove();
      });
    });
  };
  bindRemoveButtons();

  document.getElementById('add-nutrient-btn').addEventListener('click', () => {
    document.getElementById('extra-nutrients').insertAdjacentHTML('beforeend', extraNutrientRowHtml());
    bindRemoveButtons();
  });

  document.getElementById('fert-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('fert-name').value.trim();
    if (!name) return;
    const nutrients = {};
    ['N', 'P', 'K'].forEach(k => {
      const raw = document.getElementById(`nutrient-${k}`).value;
      if (raw !== '') nutrients[k] = parseFloat(raw) || 0;
    });
    document.querySelectorAll('.extra-nutrient-row').forEach(row => {
      const key = row.querySelector('.extra-key').value.trim();
      const val = row.querySelector('.extra-val').value;
      if (key && val !== '') nutrients[key] = parseFloat(val) || 0;
    });

    if (fert) {
      fert.name = name;
      fert.nutrients = nutrients;
    } else {
      state.fertilizers.push({ id: uid(), name, nutrients });
    }
    saveState();
    closeModal();
    toast('Gespeichert');
    render();
  });

  const delBtn = document.getElementById('delete-fert-btn');
  if (delBtn) delBtn.addEventListener('click', () => {
    if (!confirm(`"${fert.name}" wirklich löschen? Zugehörige Düngungen werden ebenfalls entfernt.`)) return;
    state.applications = state.applications.filter(a => a.fertilizerId !== fert.id);
    state.fertilizers = state.fertilizers.filter(f => f.id !== fert.id);
    saveState();
    closeModal();
    toast('Gelöscht');
    render();
  });
}

/* ================= CALENDAR ================= */

function renderCalendarView() {
  const first = new Date(calYear, calMonth, 1);
  const startWeekday = (first.getDay() + 6) % 7; // Montag = 0
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(calYear, calMonth, 0).getDate();

  const appsByDate = {};
  state.applications.forEach(a => {
    (appsByDate[a.date] = appsByDate[a.date] || []).push(a);
  });

  const cells = [];
  for (let i = 0; i < startWeekday; i++) {
    const d = daysInPrevMonth - startWeekday + 1 + i;
    cells.push({ day: d, otherMonth: true, iso: null });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(calYear, calMonth, d);
    cells.push({ day: d, otherMonth: false, iso: isoDate(dt) });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ day: cells.length - startWeekday - daysInMonth + 1, otherMonth: true, iso: null });
  }

  const todayIso = isoDate(today);

  const weekdayHeader = WEEKDAYS.map(w => `<div class="cal-weekday">${w}</div>`).join('');
  const dayCells = cells.map(c => {
    if (c.otherMonth) return `<div class="cal-day other-month">${c.day}</div>`;
    const hasEntry = appsByDate[c.iso] && appsByDate[c.iso].length > 0;
    const isToday = c.iso === todayIso;
    return `<div class="cal-day${hasEntry ? ' has-entry' : ''}${isToday ? ' today' : ''}" data-date="${c.iso}">
      ${c.day}${hasEntry ? '<span class="dot"></span>' : ''}
    </div>`;
  }).join('');

  return `
    <div class="cal-nav">
      <button id="cal-prev">‹</button>
      <h2>${MONTHS[calMonth]} ${calYear}</h2>
      <button id="cal-next">›</button>
    </div>
    <div class="cal-grid">${weekdayHeader}${dayCells}</div>
    <button class="btn btn-primary" id="add-app-btn">+ Düngung erfassen</button>
  `;
}

function bindCalendarEvents() {
  document.getElementById('cal-prev').addEventListener('click', () => {
    calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; }
    render();
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; }
    render();
  });
  document.querySelectorAll('.cal-day[data-date]').forEach(el => {
    el.addEventListener('click', () => openDayDetail(el.dataset.date));
  });
  document.getElementById('add-app-btn').addEventListener('click', () => openApplicationForm(isoDate(today)));
}

function openDayDetail(iso) {
  if (!state.lawns.length || !state.fertilizers.length) {
    openApplicationForm(iso);
    return;
  }
  const apps = state.applications.filter(a => a.date === iso);
  const rows = apps.map(a => {
    const lawn = lawnById(a.lawnId);
    const fert = fertilizerById(a.fertilizerId);
    return `
      <div class="app-entry">
        <div>
          <strong>${escapeHtml(fert ? fert.name : '?')}</strong><br>
          <span class="card-sub">${escapeHtml(lawn ? lawn.name : '?')} · ${fmtNum(a.amountKg, 2)} kg</span>
        </div>
        <button class="btn btn-danger" data-del-app="${a.id}">Löschen</button>
      </div>`;
  }).join('');

  openModal(`
    <div class="modal-header">
      <h2>${fmtDateDe(iso)}</h2>
      <button class="modal-close" id="modal-close-btn">✕</button>
    </div>
    <div class="day-detail-list">${apps.length ? rows : '<p class="card-sub">Keine Düngung an diesem Tag.</p>'}</div>
    <button class="btn btn-primary" id="add-app-for-day-btn" style="margin-top:16px;">+ Düngung für diesen Tag</button>
  `);
  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
  document.getElementById('add-app-for-day-btn').addEventListener('click', () => openApplicationForm(iso));
  document.querySelectorAll('[data-del-app]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.applications = state.applications.filter(a => a.id !== btn.dataset.delApp);
      saveState();
      openDayDetail(iso);
      render();
    });
  });
}

function openApplicationForm(iso) {
  if (!state.lawns.length) {
    closeModal();
    toast('Bitte zuerst eine Rasenfläche anlegen');
    switchView('lawns');
    return;
  }
  if (!state.fertilizers.length) {
    closeModal();
    toast('Bitte zuerst einen Dünger anlegen');
    switchView('fertilizers');
    return;
  }
  const lawnOptions = state.lawns.map(l => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('');
  const fertOptions = state.fertilizers.map(f => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join('');

  openModal(`
    <div class="modal-header">
      <h2>Düngung erfassen</h2>
      <button class="modal-close" id="modal-close-btn">✕</button>
    </div>
    <form id="app-form">
      <div class="form-group">
        <label>Datum</label>
        <input type="date" id="app-date" required value="${iso}">
      </div>
      <div class="form-group">
        <label>Rasenfläche</label>
        <select id="app-lawn">${lawnOptions}</select>
      </div>
      <div class="form-group">
        <label>Dünger</label>
        <select id="app-fert">${fertOptions}</select>
      </div>
      <div class="form-group">
        <label>Menge (kg Produkt gesamt)</label>
        <input type="number" id="app-amount" required min="0.01" step="0.01" placeholder="z. B. 2.5">
      </div>
      <p class="card-sub" id="app-preview"></p>
      <button type="submit" class="btn btn-primary">Speichern</button>
    </form>
  `);
  document.getElementById('modal-close-btn').addEventListener('click', closeModal);

  const updatePreview = () => {
    const lawn = lawnById(document.getElementById('app-lawn').value);
    const amount = parseFloat(document.getElementById('app-amount').value);
    const preview = document.getElementById('app-preview');
    if (lawn && amount > 0) {
      preview.textContent = `≈ ${fmtNum((amount * 1000) / lawn.sizeM2, 1)} g Produkt/m²`;
    } else {
      preview.textContent = '';
    }
  };
  document.getElementById('app-lawn').addEventListener('change', updatePreview);
  document.getElementById('app-amount').addEventListener('input', updatePreview);

  document.getElementById('app-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const date = document.getElementById('app-date').value;
    const lawnId = document.getElementById('app-lawn').value;
    const fertilizerId = document.getElementById('app-fert').value;
    const amountKg = parseFloat(document.getElementById('app-amount').value);
    if (!date || !lawnId || !fertilizerId || !amountKg || amountKg <= 0) return;
    state.applications.push({ id: uid(), date, lawnId, fertilizerId, amountKg });
    saveState();
    closeModal();
    toast('Düngung gespeichert');
    const d = new Date(date + 'T00:00:00');
    calYear = d.getFullYear();
    calMonth = d.getMonth();
    render();
  });
}

/* ================= STATS ================= */

function renderStatsView() {
  if (!state.lawns.length) {
    return emptyState('📊', 'Lege zuerst eine Rasenfläche an, um Statistiken zu sehen.');
  }

  const years = new Set(state.applications.map(a => new Date(a.date + 'T00:00:00').getFullYear()));
  years.add(statsYear);
  const minYear = Math.min(...years, statsYear);
  const maxYear = Math.max(...years, statsYear);

  const lawnBlocks = state.lawns.map(lawn => {
    const totals = nutrientTotalsForLawnYear(lawn.id, statsYear);
    const targets = lawn.targets || {};
    const keys = Array.from(new Set([...Object.keys(totals), ...Object.keys(targets)]));
    const noTargetVals = keys.filter(k => targets[k] === undefined).map(k => totals[k] || 0);
    const maxNoTarget = noTargetVals.length ? Math.max(...noTargetVals, 0.001) : 1;

    const bars = keys.length ? keys.map(k => {
      const v = totals[k] || 0;
      const target = targets[k];
      if (target !== undefined) {
        const pct = target > 0 ? Math.min((v / target) * 100, 100) : (v > 0 ? 100 : 0);
        const over = v > target;
        const pctLabel = target > 0 ? fmtNum((v / target) * 100, 0) : '0';
        return `
          <div class="nutrient-bar-row">
            <div class="nutrient-bar-label"><span>${escapeHtml(k)}</span><span>${fmtNum(v, 2)} / ${fmtNum(target, 2)} g/m² (${pctLabel}%)</span></div>
            <div class="nutrient-bar-track"><div class="nutrient-bar-fill${over ? ' over' : ''}" style="width:${pct}%"></div></div>
          </div>`;
      }
      const pct = (v / maxNoTarget) * 100;
      return `
        <div class="nutrient-bar-row">
          <div class="nutrient-bar-label"><span>${escapeHtml(k)}</span><span>${fmtNum(v, 2)} g/m²</span></div>
          <div class="nutrient-bar-track"><div class="nutrient-bar-fill" style="width:${pct}%"></div></div>
        </div>`;
    }).join('') : '<p class="card-sub">Keine Düngung in diesem Jahr.</p>';

    return `
      <div class="card">
        <p class="card-title">${escapeHtml(lawn.name)}</p>
        <p class="card-sub">${fmtNum(lawn.sizeM2, 0)} m²</p>
        <div style="margin-top:10px;">${bars}</div>
      </div>`;
  }).join('');

  return `
    <div class="year-switcher">
      <button id="stats-prev-year" ${statsYear <= minYear ? 'disabled' : ''}>‹</button>
      <span>${statsYear}</span>
      <button id="stats-next-year" ${statsYear >= maxYear ? 'disabled' : ''}>›</button>
    </div>
    ${lawnBlocks}
    <div class="export-import-row">
      <button class="btn btn-secondary" id="export-btn">Export (JSON)</button>
      <button class="btn btn-secondary" id="import-btn">Import (JSON)</button>
    </div>
    <input type="file" id="import-file" accept="application/json" style="display:none;">
  `;
}

function bindStatsEvents() {
  const prev = document.getElementById('stats-prev-year');
  const next = document.getElementById('stats-next-year');
  if (prev) prev.addEventListener('click', () => { statsYear--; render(); });
  if (next) next.addEventListener('click', () => { statsYear++; render(); });

  const exportBtn = document.getElementById('export-btn');
  if (exportBtn) exportBtn.addEventListener('click', doExport);

  const importBtn = document.getElementById('import-btn');
  const importFile = document.getElementById('import-file');
  if (importBtn) importBtn.addEventListener('click', () => importFile.click());
  if (importFile) importFile.addEventListener('change', doImport);
}

function doExport() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rasenpflege-backup-${isoDate(today)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('Export gestartet');
}

function doImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || !Array.isArray(data.lawns) || !Array.isArray(data.fertilizers) || !Array.isArray(data.applications)) {
        throw new Error('invalid');
      }
      if (!confirm('Import überschreibt alle aktuellen Daten. Fortfahren?')) return;
      state = data;
      saveState();
      toast('Import erfolgreich');
      render();
    } catch (err) {
      toast('Ungültige Datei');
    }
    e.target.value = '';
  };
  reader.readAsText(file);
}

/* ================= Shared ================= */

function emptyState(icon, text) {
  return `<div class="empty-state"><span class="big">${icon}</span>${text}</div>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }

function bindViewEvents() {
  if (currentView === 'lawns') bindLawnsEvents();
  else if (currentView === 'fertilizers') bindFertilizersEvents();
  else if (currentView === 'calendar') bindCalendarEvents();
  else if (currentView === 'stats') bindStatsEvents();
}

/* ---------- Init ---------- */

render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
