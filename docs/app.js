/* World Commuting OD Flows — dashboard frontend (Leaflet, no build step). */
'use strict';

const DATA = 'data/';
const CONTINENT_COLORS = {
  'Africa': '#f6c453', 'Asia': '#ef6f6c', 'Europe': '#5b8def',
  'North America': '#38bda6', 'South America': '#b079e8',
  'Oceania': '#f59e42', 'Other': '#9aa6b2'
};

const $ = (id) => document.getElementById(id);
const fmt = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));
const fmtK = (n) => {
  if (n == null) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'k';
  return String(Math.round(n));
};

let cities = [];          // overview records
let markerLayer = null;   // L.layerGroup of overview markers
let map = null;
let currentMetric = 'total';
let detail = { layer: null, cityIdx: null, data: null, topN: 150 };

// ---------------------------------------------------------------- map setup
function initMap() {
  map = L.map('map', { worldCopyJump: true, minZoom: 2, maxZoom: 16, preferCanvas: true })
    .setView([25, 10], 2);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap © CARTO',
    subdomains: 'abcd', maxZoom: 19
  }).addTo(map);
}

// scale a metric value to a marker radius (sqrt scale)
function radiusFor(v, maxV) {
  if (!v || v <= 0) return 3;
  const r = Math.sqrt(v / maxV) * 22;
  return Math.max(3, Math.min(26, r));
}

function colorFor(rec) {
  return CONTINENT_COLORS[rec.continent] || CONTINENT_COLORS.Other;
}

// ---------------------------------------------------------------- overview
function renderOverview() {
  if (markerLayer) markerLayer.remove();
  markerLayer = L.layerGroup();

  const filtered = applyFilters(cities);
  const metric = currentMetric;
  const maxV = Math.max(1, ...filtered.map((c) => c[metric] || 0));

  // Draw large bubbles first so small ones sit on top and stay clickable.
  const ordered = [...filtered].sort((a, b) => (b[metric] || 0) - (a[metric] || 0));
  for (const c of ordered) {
    const m = L.circleMarker([c.lat, c.lon], {
      radius: radiusFor(c[metric] || 0, maxV),
      color: colorFor(c),
      weight: 1,
      fillColor: colorFor(c),
      fillOpacity: 0.55,
    });
    m.bindPopup(popupHtml(c));
    m.on('click', () => { /* popup opens; CTA handles drill-down */ });
    m._rec = c;
    markerLayer.addLayer(m);
  }
  markerLayer.addTo(map);
  $('visible-count').textContent = filtered.length.toLocaleString('en-US');
  renderLegend(maxV);
}

function popupHtml(c) {
  return `<div class="pop">
    <b>${escapeHtml(c.name)}</b><br>
    ${escapeHtml(c.country)} · ${c.continent}<br>
    <span style="color:var(--muted)">Regions:</span> ${c.n}
    ${c.has_od ? `<br><span style="color:var(--muted)">Total flow:</span> ${fmt(c.total)}
       <br><span style="color:var(--muted)">Peak corridor:</span> ${fmt(c.maxf)}` : '<br><span style="color:var(--muted)">No OD data</span>'}
    <br><span class="popup-cta" data-idx="${c.idx}">Explore OD flows →</span>
  </div>`;
}

// delegate clicks on the dynamically-built popup CTA
document.addEventListener('click', (e) => {
  const cta = e.target.closest('.popup-cta');
  if (cta) openCity(parseInt(cta.dataset.idx, 10));
});

function renderLegend(maxV) {
  const present = [...new Set(applyFilters(cities).map((c) => c.continent))].sort();
  const rows = present.map((k) =>
    `<div class="legend-row"><span class="legend-dot" style="background:${CONTINENT_COLORS[k] || CONTINENT_COLORS.Other}"></span>${k}</div>`
  ).join('');
  const sizes = [maxV, maxV / 4, maxV / 16].map((v) => {
    const d = radiusFor(v, maxV) * 2;
    return `<div class="sz"><span class="ring" style="width:${d}px;height:${d}px"></span>${fmtK(v)}</div>`;
  }).join('');
  $('legend').innerHTML = rows +
    `<div style="margin-top:8px;color:var(--muted);font-size:11px">Bubble size: ${metricLabel()}</div>` +
    `<div class="legend-sizes">${sizes}</div>`;
}

function metricLabel() {
  return { total: 'total flow', maxf: 'peak corridor', n: 'region count' }[currentMetric];
}

// ---------------------------------------------------------------- filters
function applyFilters(list) {
  const cont = $('f-continent').value;
  const country = $('f-country').value;
  const group = $('f-group').value;
  const q = $('search').value.trim().toLowerCase();
  return list.filter((c) =>
    (!cont || c.continent === cont) &&
    (!country || c.country === country) &&
    (!group || c.group === group) &&
    (!q || c.name.toLowerCase().includes(q) || c.country.toLowerCase().includes(q))
  );
}

function populateFilters(meta) {
  const contSel = $('f-continent'), countrySel = $('f-country');
  for (const c of meta.continents) contSel.add(new Option(c, c));
  for (const c of meta.countries) countrySel.add(new Option(c, c));
}

// keep country list scoped to chosen continent
function refreshCountryOptions() {
  const cont = $('f-continent').value;
  const cur = $('f-country').value;
  const countries = [...new Set(cities.filter((c) => !cont || c.continent === cont).map((c) => c.country))].sort();
  const sel = $('f-country');
  sel.innerHTML = '<option value="">All countries</option>';
  for (const c of countries) sel.add(new Option(c, c));
  if (countries.includes(cur)) sel.value = cur;
}

// ---------------------------------------------------------------- city detail
async function openCity(idx) {
  map.closePopup();
  if (location.hash !== `#city=${idx}`) location.hash = `city=${idx}`;
  $('loading').textContent = 'Loading city…';
  $('loading').classList.remove('hidden');
  try {
    const data = await fetch(`${DATA}cities/${idx}.json`).then((r) => r.json());
    detail.cityIdx = idx;
    detail.data = data;
    detail.topN = parseInt($('topn').value, 10);
    if (markerLayer) markerLayer.remove();
    showDetailPanel(idx, data);
    drawDetail();
    fitToRegions(data.regions);
  } catch (err) {
    alert('Could not load city data: ' + err);
  } finally {
    $('loading').classList.add('hidden');
  }
}

function showDetailPanel(idx, data) {
  const rec = cities.find((c) => c.idx === idx) || {};
  $('filter-panel').hidden = true;
  $('legend-panel').hidden = true;
  $('detail-panel').hidden = false;
  $('d-name').textContent = data.name;
  $('d-sub').textContent = `${data.country} · ${rec.continent || ''} · ${data.regions.length} regions`;
  const avg = rec.total && data.regions.length ? rec.total / data.regions.length : null;
  const stats = [
    ['Regions', fmt(data.regions.length)],
    ['Total flow', fmt(rec.total)],
    ['Peak O→D', fmt(rec.maxf)],
    ['Avg flow / region', avg == null ? '—' : fmtK(avg)],
    ['Top flows available', fmt(data.flows.length)],
    ['Arcs shown', String(Math.min(detail.topN, data.flows.length))],
  ];
  $('d-stats').innerHTML = stats.map(([k, v]) =>
    `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');
}

function drawDetail() {
  if (detail.layer) detail.layer.remove();
  const g = L.layerGroup();
  const data = detail.data;
  const pts = data.regions;

  // region boundaries
  if ($('t-regions').checked && data.polys) {
    for (const rings of data.polys) {
      for (const ring of rings) {
        const latlngs = ring.map(([lon, lat]) => [lat, lon]);
        L.polygon(latlngs, { color: '#3a4a5a', weight: 1, fill: true,
          fillColor: '#1b2530', fillOpacity: 0.35 }).addTo(g);
      }
    }
  }

  // region centroids
  for (let i = 0; i < pts.length; i++) {
    L.circleMarker(pts[i], { radius: 2.5, color: '#6b7a8d', weight: 0,
      fillColor: '#9fb0c2', fillOpacity: 0.7 }).addTo(g);
  }

  // OD flow arcs
  if ($('t-flows').checked && data.flows.length) {
    const flows = data.flows.slice(0, detail.topN);
    const maxv = flows[0] ? flows[0][2] : 1;
    for (const [o, d, v] of flows) {
      if (!pts[o] || !pts[d]) continue;
      const t = v / maxv;
      const arc = curve(pts[o], pts[d]);
      L.polyline(arc, {
        color: flowColor(t),
        weight: 0.8 + t * 5,
        opacity: 0.25 + t * 0.55,
        lineCap: 'round',
      }).addTo(g);
    }
  }

  g.addTo(map);
  detail.layer = g;
}

// quadratic-ish arc between two [lat,lon] points for a flow-map look
function curve(a, b) {
  const lat1 = a[0], lon1 = a[1], lat2 = b[0], lon2 = b[1];
  const mlat = (lat1 + lat2) / 2, mlon = (lon1 + lon2) / 2;
  const dx = lon2 - lon1, dy = lat2 - lat1;
  // perpendicular offset for the control point (~15% of span)
  const offx = -dy * 0.15, offy = dx * 0.15;
  const cLat = mlat + offy, cLon = mlon + offx;
  const out = [];
  const N = 16;
  for (let i = 0; i <= N; i++) {
    const tt = i / N, u = 1 - tt;
    const lat = u * u * lat1 + 2 * u * tt * cLat + tt * tt * lat2;
    const lon = u * u * lon1 + 2 * u * tt * cLon + tt * tt * lon2;
    out.push([lat, lon]);
  }
  return out;
}

function flowColor(t) {
  // yellow (low) -> orange -> red (high)
  const stops = [[56, 189, 166], [245, 166, 35], [239, 83, 80]];
  const seg = t < 0.5 ? 0 : 1;
  const lt = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5;
  const a = stops[seg], b = stops[seg + 1];
  const c = a.map((x, i) => Math.round(x + (b[i] - x) * lt));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function fitToRegions(pts) {
  if (!pts.length) return;
  const b = L.latLngBounds(pts);
  map.fitBounds(b, { padding: [40, 40], maxZoom: 13 });
}

function closeDetail() {
  if (detail.layer) { detail.layer.remove(); detail.layer = null; }
  detail.data = null; detail.cityIdx = null;
  $('detail-panel').hidden = true;
  $('filter-panel').hidden = false;
  $('legend-panel').hidden = false;
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  renderOverview();
  map.setView([25, 10], 2);
}

// open a city from the URL hash (#city=<idx>) — enables shareable links
function routeFromHash() {
  const m = location.hash.match(/city=(\d+)/);
  if (m) {
    const idx = parseInt(m[1], 10);
    if (idx !== detail.cityIdx) openCity(idx);
  } else if (detail.data) {
    closeDetail();
  }
}

// ---------------------------------------------------------------- wiring
function bindUI() {
  ['f-continent', 'f-country', 'f-group', 'search'].forEach((id) =>
    $(id).addEventListener('input', () => { if (!detail.data) renderOverview(); }));
  $('f-continent').addEventListener('change', refreshCountryOptions);
  $('f-metric').addEventListener('change', (e) => {
    currentMetric = e.target.value;
    if (!detail.data) renderOverview();
  });
  $('detail-close').addEventListener('click', closeDetail);
  $('t-regions').addEventListener('change', drawDetail);
  $('t-flows').addEventListener('change', drawDetail);
  $('topn').addEventListener('input', (e) => {
    detail.topN = parseInt(e.target.value, 10);
    $('topn-val').textContent = detail.topN;
    if (detail.data) { drawDetail(); showDetailPanel(detail.cityIdx, detail.data); }
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------- boot
async function boot() {
  initMap();
  bindUI();
  try {
    const [c, meta] = await Promise.all([
      fetch(`${DATA}cities.json`).then((r) => r.json()),
      fetch(`${DATA}meta.json`).then((r) => r.json()),
    ]);
    cities = c;
    $('stat-cities').textContent = meta.n_cities.toLocaleString('en-US');
    $('stat-countries').textContent = meta.countries.length;
    populateFilters(meta);
    renderOverview();
  } catch (err) {
    $('loading').textContent = 'Failed to load data: ' + err;
    return;
  }
  $('loading').classList.add('hidden');
  window.addEventListener('hashchange', routeFromHash);
  routeFromHash();  // honour a deep link on first load
}

boot();
