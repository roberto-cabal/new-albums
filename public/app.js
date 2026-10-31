const DATA_URL = 'data/albums.json';
const REFRESH_MS = 10 * 60 * 1000;
const NEW_DAYS = 7;
const DAY = 86400000;

const SOURCE_COLORS = { needledrop: 'var(--needledrop)', pitchfork: 'var(--pitchfork)', stereogum: 'var(--stereogum)', bandcamp: 'var(--bandcamp)', quietus: 'var(--quietus)' };
// Chart strokes: brand colors re-stepped so the lines stay distinguishable (incl. color blindness) on both themes.
const CHART_COLORS = { needledrop: 'var(--chart-needledrop)', pitchfork: 'var(--chart-pitchfork)', stereogum: 'var(--chart-stereogum)', bandcamp: 'var(--chart-bandcamp)', quietus: 'var(--chart-quietus)' };
const TREND_WEEKS = 52;
const SERVICES = [
  ['spotify', 'Spotify', '#1db954'],
  ['appleMusic', 'Apple Music', '#fa2d48'],
  ['youtubeMusic', 'YouTube Music', '#ff0033'],
  ['deezer', 'Deezer', '#a238ff'],
  ['bandcamp', 'Bandcamp', '#1da0c3'],
  ['qobuz', 'Qobuz', '#4a6cf7'],
];

const state = { data: null, query: '', source: 'all', consensus: false, sort: 'recent', trendMode: 'weekly', trendWeek: null, trendLen: 0 };
const $ = (id) => document.getElementById(id);

// Data comes from third-party sites: only allow https links/images so a `javascript:` URL can't slip into an href.
const safeUrl = (u, fallback = '#') => {
  try {
    return new URL(u).protocol === 'https:' ? u : fallback;
  } catch {
    return fallback;
  }
};
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const sourceIds = (a) => [...new Set(a.picks.map((p) => p.source))];
const pfScore = (a) => a.picks.find((p) => p.source === 'pitchfork')?.score ?? null;

function relTime(iso) {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 60) return `hace ${Math.max(mins, 1)} min`;
  const h = Math.round(mins / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}

function hash(str) {
  let h = 2166136261;
  for (const ch of str) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
}

function cover(a, cls = '') {
  if (a.cover && safeUrl(a.cover, '')) return `<img class="cover ${cls}" src="${esc(a.cover)}" alt="Portada de ${esc(a.title)}" loading="lazy" referrerpolicy="no-referrer">`;
  const h = hash(a.id) % 360;
  const initials = (a.title.match(/\p{L}|\p{N}/u)?.[0] ?? '♪').toUpperCase();
  return `<div class="cover placeholder ${cls}" style="--c1:hsl(${h} 60% 45%);--c2:hsl(${(h + 50) % 360} 70% 30%)" aria-hidden="true">${esc(initials)}</div>`;
}

function badges(a) {
  const sources = Object.fromEntries(state.data.sources.map((s) => [s.id, s]));
  return a.picks
    .map((p) => {
      const s = sources[p.source] ?? { name: p.source };
      let label = s.name;
      if (p.source === 'pitchfork' && p.score) label += ` ${p.score.toFixed(1)}`;
      if (p.source === 'needledrop' && p.curator === 'austen') label += ' · austen';
      return `<a class="badge" data-src="${esc(p.source)}" style="--src:${SOURCE_COLORS[p.source] ?? 'var(--muted)'}" href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener" title="${esc(`${s.name} · ${s.list ?? ''}${p.date ? ' · ' + fmtDate(p.date) : ''}`)}">${esc(label)}</a>`;
    })
    .join('');
}

function listenLinks(a) {
  const links = a.links ?? {};
  return SERVICES.filter(([k]) => links[k])
    .map(([k, name, color]) => {
      const l = links[k];
      const title = l.exact ? `Escuchar en ${name}` : `Buscar en ${name}`;
      return `<a class="svc ${l.exact ? 'exact' : 'search'}" style="--svc:${color}" href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener" title="${title}">${name}</a>`;
    })
    .join('') + aotyLink(a);
}

// AOTY blocks automated requests, so we only link to its search and let the visitor's browser open it.
function aotyLink(a) {
  const q = encodeURIComponent(`${a.artist} ${a.title}`);
  return `<a class="svc search" style="--svc:var(--muted)" href="https://www.albumoftheyear.org/search/?q=${q}" target="_blank" rel="noopener" title="Ver calificaciones en Album of the Year">AOTY</a>`;
}

function card(a) {
  const isNew = Date.now() - Date.parse(a.lastPickAt) < NEW_DAYS * DAY;
  const meta = [
    isNew ? '<span class="new">Nuevo</span>' : '',
    a.genre ? esc(a.genre) : '',
    a.lastPickAt ? esc(fmtDate(a.lastPickAt)) : '',
  ].filter(Boolean);
  return `<article class="card">
    ${cover(a)}
    <div class="card-body">
      <h3>${esc(a.title)}</h3>
      <p class="artist">${esc(a.artist)}</p>
      <div class="meta">${meta.join('<span aria-hidden="true">·</span>')}</div>
      <div class="badges">${badges(a)}</div>
      <div class="listen">${listenLinks(a)}</div>
    </div>
  </article>`;
}

// Same pick for every visitor on a given day: weighted toward recent albums that several lists agree on.
function pickOfTheDay(albums) {
  const recent = albums.filter((a) => Date.now() - Date.parse(a.lastPickAt) < 45 * DAY);
  const pool = recent.length ? recent : albums.slice(0, 30);
  if (!pool.length) return null;
  const weights = pool.map((a) => sourceIds(a).length ** 2 + (pfScore(a) >= 8.5 ? 1 : 0));
  const total = weights.reduce((s, w) => s + w, 0);
  let r = hash(new Date().toLocaleDateString('en-CA')) % total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r < 0) return pool[i];
  }
  return pool[0];
}

function renderPick() {
  const a = pickOfTheDay(state.data.albums);
  const el = $('pick');
  if (!a) return (el.hidden = true);
  const note = a.picks.find((p) => p.note && p.note.length > 40)?.note;
  el.hidden = false;
  el.innerHTML = `${cover(a)}
    <div>
      <p class="pick-label">Recomendación del día</p>
      <h2>${esc(a.title)}</h2>
      <p class="artist">${esc(a.artist)}</p>
      <div class="badges">${badges(a)}</div>
      ${note ? `<p class="note">${esc(note)}</p>` : ''}
      <div class="listen">${listenLinks(a)}</div>
    </div>`;
}

function renderSources() {
  const counts = { all: state.data.albums.length };
  for (const a of state.data.albums) for (const s of sourceIds(a)) counts[s] = (counts[s] ?? 0) + 1;
  const chips = [{ id: 'all', name: 'Todas' }, ...state.data.sources];
  $('sources').innerHTML = chips
    .map((s) => `<button class="chip" data-id="${esc(s.id)}" aria-pressed="${state.source === s.id}" title="${esc(s.list ?? '')}${s.ok === false ? ' — no se pudo actualizar' : ''}">
      ${s.id !== 'all' ? `<span class="swatch" style="background:${SOURCE_COLORS[s.id] ?? 'var(--muted)'}"></span>` : ''}${esc(s.name)} <span class="n">${counts[s.id] ?? 0}</span></button>`)
    .join('');
  $('source-links').innerHTML = state.data.sources
    .map((s) => `<a href="${esc(safeUrl(s.homepage))}" target="_blank" rel="noopener">${esc(`${s.name} (${s.list})`)}</a>`)
    .join(', ');
}

function renderGrid() {
  const q = state.query.trim().toLowerCase();
  let list = state.data.albums.filter((a) => {
    if (state.source !== 'all' && !sourceIds(a).includes(state.source)) return false;
    if (state.consensus && sourceIds(a).length < 2) return false;
    if (q && !`${a.artist} ${a.title} ${a.genre ?? ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const byRecent = (a, b) => b.lastPickAt.localeCompare(a.lastPickAt);
  if (state.sort === 'recent') list.sort(byRecent);
  if (state.sort === 'consensus') list.sort((a, b) => sourceIds(b).length - sourceIds(a).length || byRecent(a, b));
  if (state.sort === 'score') list.sort((a, b) => (pfScore(b) ?? -1) - (pfScore(a) ?? -1) || byRecent(a, b));

  $('count').textContent = `${list.length} ${list.length === 1 ? 'álbum' : 'álbumes'}`;
  $('grid').innerHTML = list.length ? list.map(card).join('') : '<p class="empty">No hay álbumes con esos filtros.</p>';
}

// Monday 00:00 UTC of the week containing t.
function weekStart(t) {
  const d = new Date(t);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY;
}
const fmtWeek = (t) => new Date(t).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// Distinct albums each list picked per week. Undated picks fall back to the album's release date, else are skipped.
function weeklyCounts() {
  const bySource = Object.fromEntries(state.data.sources.map((s) => [s.id, new Map()]));
  const thisWeek = weekStart(Date.now());
  let undated = 0;
  let first = thisWeek;
  for (const a of state.data.albums) {
    for (const p of a.picks) {
      const iso = p.date ?? (a.releaseDate ? `${a.releaseDate}T12:00:00.000Z` : null);
      if (!iso || !bySource[p.source]) {
        undated++;
        continue;
      }
      const w = weekStart(Date.parse(iso));
      if (w > thisWeek) continue;
      first = Math.min(first, w);
      const m = bySource[p.source];
      if (!m.has(w)) m.set(w, new Set());
      m.get(w).add(a.id);
    }
  }
  first = Math.max(first, thisWeek - (TREND_WEEKS - 1) * 7 * DAY);
  const weeks = [];
  for (let w = first; w <= thisWeek; w += 7 * DAY) weeks.push(w);
  const series = state.data.sources.map((s) => {
    const weekly = weeks.map((w) => bySource[s.id].get(w)?.size ?? 0);
    const avg = weekly.map((_, i) => {
      const win = weekly.slice(Math.max(0, i - 3), i + 1);
      return win.reduce((t, v) => t + v, 0) / win.length;
    });
    return { id: s.id, name: s.name, weekly, avg };
  });
  return { weeks, series, undated };
}

const fmtVal = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

function renderTrend() {
  const section = document.querySelector('.trend');
  const { weeks, series, undated } = weeklyCounts();
  if (weeks.length < 2) return (section.hidden = true);
  section.hidden = false;
  const mode = state.trendMode;
  const val = (s, i) => s[mode][i];
  const dim = (id) => state.source !== 'all' && state.source !== id;

  $('trend-sub').textContent = `${mode === 'avg' ? 'Promedio móvil de 4 semanas' : 'Álbumes recomendados cada semana'} · desde el ${fmtWeek(weeks[0])}${undated ? ` · ${undated} sin fecha no se cuentan` : ''}`;
  for (const b of $('trend-mode').querySelectorAll('button')) b.setAttribute('aria-pressed', b.dataset.mode === mode);
  $('trend-legend').innerHTML = series
    .map((s) => `<span class="key${dim(s.id) ? ' dim' : ''}"><i style="background:${CHART_COLORS[s.id] ?? 'var(--muted)'}"></i>${esc(s.name)}</span>`)
    .join('');

  // Geometry
  const el = $('trend-chart');
  const W = Math.max(el.clientWidth, 280);
  const narrow = W < 560;
  const H = narrow ? 200 : 240;
  const m = { t: 12, r: narrow ? 12 : 136, b: 26, l: 28 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const max = Math.max(1, ...series.flatMap((s) => s[mode]));
  const top = Math.ceil(max);
  const step = top > 6 ? 2 : 1;
  const x = (i) => m.l + (i / (weeks.length - 1)) * iw;
  const y = (v) => m.t + ih - (v / top) * ih;

  let svg = '';
  for (let v = 0; v <= top; v += step) {
    svg += `<line class="grid${v === 0 ? ' base' : ''}" x1="${m.l}" x2="${m.l + iw}" y1="${y(v)}" y2="${y(v)}"/>`;
    svg += `<text class="tick" x="${m.l - 8}" y="${y(v)}" text-anchor="end" dominant-baseline="middle">${v}</text>`;
  }
  // Month labels at the first week of each month, thinned so they never collide.
  let lastX = -Infinity;
  weeks.forEach((w, i) => {
    const d = new Date(w);
    const prev = i ? new Date(weeks[i - 1]) : null;
    if (prev && prev.getUTCMonth() === d.getUTCMonth()) return;
    if (x(i) - lastX < (narrow ? 28 : 44)) return;
    lastX = x(i);
    svg += `<text class="tick" x="${x(i)}" y="${H - 6}" text-anchor="${i ? 'middle' : 'start'}">${esc(d.toLocaleDateString('es-MX', { month: 'short', timeZone: 'UTC' }).replace('.', ''))}</text>`;
  });

  const order = [...series].sort((a, b) => dim(b.id) - dim(a.id)); // highlighted line drawn last, on top
  for (const s of order) {
    const pts = s[mode].map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    svg += `<polyline class="line${dim(s.id) ? ' dim' : ''}" points="${pts}" style="stroke:${CHART_COLORS[s.id] ?? 'var(--muted)'}"/>`;
  }

  // Direct labels at the line ends, nudged apart vertically.
  if (!narrow) {
    const last = weeks.length - 1;
    const labels = series.map((s) => ({ s, y: y(val(s, last)) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 15);
    const overflow = labels.at(-1).y - (m.t + ih);
    if (overflow > 0) labels.forEach((l) => (l.y -= overflow));
    for (const l of labels) {
      svg += `<text class="end-label${dim(l.s.id) ? ' dim' : ''}" x="${x(last) + 10}" y="${l.y}" dominant-baseline="middle"><tspan class="v">${fmtVal(val(l.s, last))}</tspan> ${esc(l.s.name)}</text>`;
    }
  }

  // Hover layer: crosshair snaps to the nearest week; markers + tooltip list every list at that week.
  const hi = state.trendWeek;
  if (hi != null && hi < weeks.length) {
    svg += `<line class="cross" x1="${x(hi)}" x2="${x(hi)}" y1="${m.t}" y2="${m.t + ih}"/>`;
    for (const s of order) {
      svg += `<circle class="dot${dim(s.id) ? ' dim' : ''}" cx="${x(hi)}" cy="${y(val(s, hi))}" r="4.5" style="fill:${CHART_COLORS[s.id] ?? 'var(--muted)'}"/>`;
    }
  }
  svg += `<rect class="hit" x="${m.l}" y="0" width="${iw}" height="${H}"/>`;

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" tabindex="0" role="img" aria-label="Álbumes por semana en cada lista. Usa las flechas para recorrer las semanas.">${svg}</svg>`;

  if (hi != null && hi < weeks.length) {
    const rows = [...series]
      .sort((a, b) => val(b, hi) - val(a, hi))
      .map((s) => `<div class="tip-row${dim(s.id) ? ' dim' : ''}"><i style="background:${CHART_COLORS[s.id] ?? 'var(--muted)'}"></i><b>${fmtVal(val(s, hi))}</b><span>${esc(s.name)}</span></div>`)
      .join('');
    const tip = document.createElement('div');
    tip.className = 'tip';
    tip.innerHTML = `<p>Semana del ${esc(fmtWeek(weeks[hi]))}</p>${rows}`;
    el.append(tip);
    const left = x(hi) + 12;
    tip.style.left = `${left + tip.offsetWidth > W ? x(hi) - 12 - tip.offsetWidth : left}px`;
    tip.style.top = `${m.t}px`;
  }

  // Table view: newest week first.
  $('trend-table').innerHTML = `<table><thead><tr><th>Semana</th>${series.map((s) => `<th>${esc(s.name)}</th>`).join('')}</tr></thead><tbody>${weeks
    .map((w, i) => `<tr><td>${esc(fmtWeek(w))}</td>${series.map((s) => `<td>${fmtVal(val(s, i))}</td>`).join('')}</tr>`)
    .reverse()
    .join('')}</tbody></table>`;
  state.trendLen = weeks.length;
}

function trendPointer(e) {
  const svg = e.target.closest('svg');
  if (!svg || !state.trendLen) return;
  const r = svg.getBoundingClientRect();
  const hit = svg.querySelector('.hit').getBBox();
  const t = (e.clientX - r.left - hit.x) / hit.width;
  const i = Math.round(Math.min(1, Math.max(0, t)) * (state.trendLen - 1));
  if (i !== state.trendWeek) {
    state.trendWeek = i;
    renderTrend();
  }
}

function renderUpdated() {
  if (!state.data?.updatedAt) return;
  $('updated').innerHTML = `<span class="dot"></span>Actualizado ${relTime(state.data.updatedAt)}`;
  $('updated').title = new Date(state.data.updatedAt).toLocaleString('es-MX');
}

function render() {
  renderUpdated();
  renderSources();
  renderPick();
  renderTrend();
  renderGrid();
}

async function load() {
  try {
    const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
    const data = await res.json();
    if (state.data?.updatedAt === data.updatedAt) return renderUpdated();
    for (const a of data.albums) a.lastPickAt ??= a.addedAt;
    state.data = data;
    render();
  } catch (err) {
    console.error(err);
    if (!state.data) $('grid').innerHTML = '<p class="empty">No se pudieron cargar los álbumes. Intenta recargar la página.</p>';
  }
}

$('search').addEventListener('input', (e) => {
  state.query = e.target.value;
  renderGrid();
});
$('sources').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  state.source = chip.dataset.id;
  renderSources();
  renderTrend();
  renderGrid();
});
$('trend-mode').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.trendMode = b.dataset.mode;
  renderTrend();
});
$('trend-chart').addEventListener('pointermove', trendPointer);
$('trend-chart').addEventListener('pointerleave', () => {
  state.trendWeek = null;
  renderTrend();
});
$('trend-chart').addEventListener('keydown', (e) => {
  if (!['ArrowLeft', 'ArrowRight', 'Escape'].includes(e.key) || !state.trendLen) return;
  e.preventDefault();
  if (e.key === 'Escape') state.trendWeek = null;
  else {
    const cur = state.trendWeek ?? state.trendLen;
    state.trendWeek = Math.min(state.trendLen - 1, Math.max(0, cur + (e.key === 'ArrowRight' ? 1 : -1)));
  }
  renderTrend();
  $('trend-chart').querySelector('svg').focus();
});
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => state.data && renderTrend(), 150);
});
$('consensus').addEventListener('change', (e) => {
  state.consensus = e.target.checked;
  renderGrid();
});
$('sort').addEventListener('change', (e) => {
  state.sort = e.target.value;
  renderGrid();
});

// Near-real-time: poll for a fresh albums.json while the tab is visible.
setInterval(() => document.visibilityState === 'visible' && load(), REFRESH_MS);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && load());
setInterval(renderUpdated, 60000);
load();
