const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const MONTHS_FULL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const COLORS = ['#1677a6','#25a9b5','#7667a8','#d9931a','#c34f59','#3d9a6b','#7b8790','#b46a9b'];
const ALL_MONTHS = MONTHS.map((_, index) => index);
const state = { rainfall: [], dailySummary: null, stations: [], metadata: {}, charts: {}, tableRows: [], filterConfigs: {}, climateMetrics: new Set(['temperature','humidity','wind','rain24Total']) };
const $ = id => document.getElementById(id);
const format = value => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(value || 0);
const average = values => values.length ? values.reduce((a,b) => a + b, 0) / values.length : 0;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    const [rainfall, dailySummary, stations, metadata] = await Promise.all(
      ['rainfall.json','rainfall-daily-summary.json','stations.json','metadata.json'].map(name => fetch(`data/${name}`).then(response => {
        if (!response.ok) throw new Error(`No se pudo cargar ${name}`);
        return response.json();
      }))
    );
    Object.assign(state, { rainfall, dailySummary, stations, metadata });
    populateFilters();
    wireControls();
    render();
    $('headerCoverage').textContent = `${metadata.yearMin}-${metadata.yearMax}`;
    $('headerDepartments').textContent = metadata.departments.length;
    $('headerUpdated').textContent = new Date(metadata.generatedAt).toLocaleDateString('es-AR');
    $('latestDataYear').textContent = metadata.yearMax;
    $('dataNote').textContent = `Fuente principal: ${metadata.rainfallSource}`;
  } catch (error) {
    $('errorBanner').style.display = 'block';
    $('errorBanner').textContent = `${error.message}. Ejecuta el dashboard mediante un servidor HTTP local.`;
    console.error(error);
  } finally {
    $('loading').classList.add('hidden');
  }
}

function populateFilters() {
  const years = [...new Set(state.rainfall.map(row => row.year))].sort((a,b) => b - a);
  const latestCompleteYear = state.metadata.yearMax - 1;
  createMultiFilter('departmentFilter', state.metadata.departments.map(value => ({ value, label: value })), {
    allLabel: 'Todos los departamentos',
    defaultValues: ['ALL']
  });
  createMultiFilter('yearFilter', years.map(value => ({ value: String(value), label: String(value) })), {
    allLabel: 'Todos los a\u00f1os',
    defaultValues: years.includes(latestCompleteYear) ? [String(latestCompleteYear)] : ['ALL']
  });
  createMultiFilter('monthFilter', MONTHS_FULL.map((label, value) => ({ value: String(value), label })), {
    allLabel: 'A\u00f1o completo',
    defaultValues: ['ALL']
  });
  createMultiFilter('stationFilter', state.stations.map(station => ({ value: station.station, label: station.station })), {
    allLabel: '',
    allowAll: false,
    defaultValues: [state.stations[0].station]
  });
  fillSelect('annualFromFilter', [...years].reverse());
  fillSelect('annualToFilter', [...years].reverse());
  $('annualFromFilter').value = state.metadata.yearMin;
  $('annualToFilter').value = state.metadata.yearMax;
}

function createMultiFilter(id, options, config) {
  const allowAll = config.allowAll !== false;
  const container = $(id);
  const choices = allowAll ? [{ value: 'ALL', label: config.allLabel }, ...options] : options;
  state.filterConfigs[id] = { ...config, allowAll, options };
  container.innerHTML = `<details><summary><span></span></summary><div class="multi-filter-menu">${choices.map(choice =>
    `<label><input type="checkbox" value="${choice.value}"><span>${choice.label}</span></label>`
  ).join('')}</div></details>`;
  setMultiSelection(id, config.defaultValues);
}

function fillSelect(id, values) {
  const select = $(id);
  select.innerHTML = '';
  values.forEach(value => select.add(new Option(value, value)));
}

function wireControls() {
  Object.keys(state.filterConfigs).forEach(id => {
    $(id).addEventListener('change', event => {
      if (event.target.type !== 'checkbox') return;
      normalizeMultiSelection(id, event.target);
      updateMultiSummary(id);
      render();
    });
  });
  ['annualFromFilter','annualToFilter'].forEach(id => $(id).addEventListener('change', () => {
    let from = +$('annualFromFilter').value;
    let to = +$('annualToFilter').value;
    if (from > to) [$('annualFromFilter').value, $('annualToFilter').value] = [String(to), String(from)];
    renderAnnual(filters());
  }));
  $('dailyWindowFilter').addEventListener('change', () => renderDaily(filters()));
  $('resetFilters').addEventListener('click', () => {
    const latestCompleteYear = state.metadata.yearMax - 1;
    setMultiSelection('departmentFilter', ['ALL']);
    setMultiSelection('yearFilter', [String(latestCompleteYear)]);
    setMultiSelection('monthFilter', ['ALL']);
    setMultiSelection('stationFilter', [state.stations[0].station]);
    $('annualFromFilter').value = state.metadata.yearMin;
    $('annualToFilter').value = state.metadata.yearMax;
    render();
  });
  document.querySelectorAll('.section-tab').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('.section-tab').forEach(tab => tab.classList.toggle('active', tab === button));
    document.querySelectorAll('.dashboard-panel').forEach(panel => panel.classList.toggle('active', panel.id === button.dataset.panel));
    setTimeout(() => Object.values(state.charts).forEach(chartInstance => chartInstance.resize()), 0);
  }));
  document.addEventListener('click', event => {
    document.querySelectorAll('.multi-filter details[open]').forEach(details => {
      if (!details.contains(event.target)) details.removeAttribute('open');
    });
  });
  $('climateLegend').addEventListener('click', event => {
    const button = event.target.closest('[data-climate-metric]');
    if (!button) return;
    const metric = button.dataset.climateMetric;
    if (state.climateMetrics.has(metric) && state.climateMetrics.size === 1) return;
    if (state.climateMetrics.has(metric)) state.climateMetrics.delete(metric);
    else state.climateMetrics.add(metric);
    renderClimate(filters());
  });
  $('downloadTable').addEventListener('click', downloadTable);
}

function normalizeMultiSelection(id, changed) {
  const config = state.filterConfigs[id];
  const inputs = [...$(id).querySelectorAll('input[type="checkbox"]')];
  if (config.allowAll && changed.value === 'ALL' && changed.checked) {
    inputs.forEach(input => { if (input.value !== 'ALL') input.checked = false; });
  } else if (config.allowAll && changed.checked) {
    const all = inputs.find(input => input.value === 'ALL');
    if (all) all.checked = false;
  }
  if (!inputs.some(input => input.checked)) {
    const fallback = config.allowAll ? inputs.find(input => input.value === 'ALL') : changed;
    fallback.checked = true;
  }
}

function setMultiSelection(id, values) {
  const selected = new Set(values.map(String));
  $(id).querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = selected.has(input.value); });
  updateMultiSummary(id);
}

function updateMultiSummary(id) {
  const config = state.filterConfigs[id];
  const selected = [...$(id).querySelectorAll('input[type="checkbox"]:checked')];
  const summary = $(id).querySelector('summary span');
  if (selected.some(input => input.value === 'ALL')) {
    summary.textContent = config.allLabel;
  } else if (selected.length === 1) {
    summary.textContent = selected[0].nextElementSibling.textContent;
  } else {
    summary.textContent = `${selected[0].nextElementSibling.textContent} +${selected.length - 1}`;
  }
}

function selectedValues(id, numeric = false) {
  const checked = [...$(id).querySelectorAll('input[type="checkbox"]:checked')].map(input => input.value);
  if (checked.includes('ALL')) return null;
  return numeric ? checked.map(Number) : checked;
}

function filters() {
  return {
    departments: selectedValues('departmentFilter'),
    years: selectedValues('yearFilter', true),
    months: selectedValues('monthFilter', true)
  };
}

function matchesSelection(value, selected) {
  return selected === null || selected.includes(value);
}

function filteredRainfall(f = filters()) {
  return state.rainfall.filter(row => matchesSelection(row.department, f.departments) && matchesSelection(row.year, f.years));
}

function selectedMonths(f) {
  return f.months === null ? ALL_MONTHS : f.months;
}

function recordValue(record, months) {
  return months.reduce((sum, month) => sum + (Number.isFinite(record.months[month]) ? record.months[month] : 0), 0);
}

function monthlyObservations(records, months) {
  return records.flatMap(record => months
    .filter(month => Number.isFinite(record.months[month]))
    .map(month => ({ value: record.months[month], month, year: record.year })));
}

function render() {
  const f = filters();
  const rows = filteredRainfall(f);
  updateKpis(rows, f);
  renderAnnual(f);
  renderMonthly(rows, f);
  renderRanking(rows, f);
    renderHeatmap(rows, f);
  renderDaily(f);
  renderClimate(f);
  renderTable(rows, f);
  renderPriority(f);
}

function dailyRows(f = filters()) {
  if (!state.dailySummary || !Array.isArray(state.dailySummary.rows)) return [];
  const windowDays = +$('dailyWindowFilter').value || 7;
  return state.dailySummary.rows
    .filter(row => row.windowDays === windowDays && matchesSelection(row.department, f.departments))
    .sort((a,b) => levelWeight(b.level) - levelWeight(a.level) || b.differencePct - a.differencePct);
}

function renderDaily(f) {
  if (!state.dailySummary) return;
  const rows = dailyRows(f);
  const windowDays = +$('dailyWindowFilter').value || 7;
  $('dailyLatestDate').textContent = formatDate(state.dailySummary.dateMax);
  $('dailyCoverage').textContent = `${state.dailySummary.dateMin} a ${state.dailySummary.dateMax} - ${state.dailySummary.records} registros`;
  $('dailyHeatmap').innerHTML = rows.length ? rows.map(row => dailyTile(row, windowDays)).join('') : '<div class="empty-state">No hay datos diarios para los filtros seleccionados.</div>';
  $('dailyTable').innerHTML = rows.map(row => `<tr><td>${row.department}</td><td><span class="daily-level daily-${levelCss(row.level)}">${levelLabel(row.level)}</span></td><td>${format(row.recentMm)}</td><td>${format(row.historicalAverageMm)}</td><td>${signedMm(row.differenceMm)}</td><td>${signedPercent(row.differencePct)}</td><td>${row.historicalYears}</td></tr>`).join('');
  updateDailyQuickStats(f);
}

function dailyTile(row, windowDays) {
  const pctForBar = Math.max(0, Math.min(100, row.historicalAverageMm > 0 ? (row.recentMm / Math.max(row.historicalAverageMm * 2, 1)) * 100 : (row.recentMm > 0 ? 100 : 0)));
  const comparison = row.historicalAverageMm > 0
    ? `${signedPercent(row.differencePct)} vs referencia`
    : 'Sin referencia previa comparable';
  return `<article class="daily-tile ${row.level}">
    <div class="daily-tile-top"><h3>${row.department}</h3><span class="daily-level daily-${levelCss(row.level)}">${levelLabel(row.level)}</span></div>
    <div class="daily-main-metric"><strong>${format(row.recentMm)}</strong><span>mm en ${windowDays} d&iacute;a${windowDays === 1 ? '' : 's'}</span></div>
    <div class="daily-bar" aria-hidden="true"><span style="width:${pctForBar}%"></span></div>
    <dl class="daily-tile-metrics">
      <div><dt>Promedio hist&oacute;rico</dt><dd>${format(row.historicalAverageMm)} mm</dd></div>
      <div><dt>Diferencia</dt><dd>${signedMm(row.differenceMm)} mm</dd></div>
      <div><dt>Exceso</dt><dd>${comparison}</dd></div>
    </dl>
  </article>`;
}

function updateDailyQuickStats(f) {
  [1, 7, 30].forEach(days => {
    const selected = state.dailySummary.rows.filter(row => row.windowDays === days && matchesSelection(row.department, f.departments));
    const total = selected.reduce((sum, row) => sum + row.recentMm, 0);
    const id = days === 1 ? 'quickRain24' : `quickRain${days}`;
    $(id).textContent = selected.length ? `${format(total)} mm` : 'No disponible';
  });
}

function levelWeight(level) {
  return { rojo: 4, naranja: 3, amarillo: 2, normal: 1 }[level] || 0;
}

function levelLabel(level) {
  return { rojo: 'Alerta alta', naranja: 'Alerta', amarillo: 'Atenci\u00f3n', normal: 'Normal' }[level] || 'Sin datos';
}

function levelCss(level) {
  return level === 'rojo' ? 'red' : level === 'naranja' ? 'orange' : level === 'amarillo' ? 'yellow' : 'normal';
}

function formatDate(value) {
  if (!value) return '\u2014';
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('es-AR');
}

function updateKpis(rows, f) {
  const months = selectedMonths(f);
  const values = rows.map(row => recordValue(row, months));
  const grouped = groupTotals(rows, row => row.department, months);
  const top = Object.entries(grouped).sort((a,b) => b[1] - a[1])[0];
  $('kpiTotal').textContent = `${format(average(values))} mm`;
  $('kpiTotalDetail').textContent = f.years === null ? 'promedio por registro seleccionado' : `promedio de ${f.years.length} a\u00f1o(s) seleccionado(s)`;
  $('kpiTopDepartment').textContent = top ? top[0] : '\u2014';
  $('kpiTopDepartmentDetail').textContent = top ? `${format(top[1])} mm` : 'sin datos';
}

function renderAnnual(f) {
  const from = +$('annualFromFilter').value;
  const to = +$('annualToFilter').value;
  const rows = state.rainfall.filter(row =>
    matchesSelection(row.department, f.departments) &&
    matchesSelection(row.year, f.years) &&
    row.year >= from && row.year <= to
  );
  const months = selectedMonths(f);
  const labels = [...new Set(rows.map(row => row.year))].sort((a,b) => a - b);
  let datasets;
  if (f.departments === null) {
    datasets = [dataset('Promedio provincial', labels.map(year =>
      average(rows.filter(row => row.year === year).map(row => recordValue(row, months)))
    ), COLORS[0], true, 'mm')];
  } else {
    datasets = f.departments.map((department, index) => dataset(department, labels.map(year => {
      const records = rows.filter(row => row.year === year && row.department === department);
      return records.length ? average(records.map(row => recordValue(row, months))) : null;
    }), COLORS[index % COLORS.length], false, 'mm'));
  }
  chart('annualChart', 'line', { labels, datasets }, lineOptions('mm', 'Precipitaci\u00f3n acumulada (mm)'));
}

function renderMonthly(rows, f) {
  const months = selectedMonths(f);
  const labels = months.map(month => MONTHS[month]);
  let datasets;
  if (f.departments === null) {
    datasets = [dataset('Promedio provincial', months.map(month =>
      average(rows.map(row => row.months[month]).filter(Number.isFinite))
    ), COLORS[1], false, 'mm')];
    datasets.push({
      ...dataset('Promedio historico provincial', months.map(month =>
        average(state.rainfall.map(row => row.months[month]).filter(Number.isFinite))
      ), '#6f8794', false, 'mm'),
      type: 'line',
      backgroundColor: 'transparent',
      borderDash: [7, 4],
      borderWidth: 2.5,
      pointRadius: 3
    });
    $('monthlyChartScope').textContent = 'Provincia';
    $('monthlyChartDescription').textContent = 'Promedio del periodo seleccionado comparado con el promedio historico provincial.';
  } else {
    datasets = f.departments.flatMap((department, index) => {
      const departmentRows = rows.filter(row => row.department === department);
      const historicalRows = state.rainfall.filter(row => row.department === department);
      return [
        dataset(`${department} - periodo seleccionado`, months.map(month =>
          average(departmentRows.map(row => row.months[month]).filter(Number.isFinite))
        ), COLORS[index % COLORS.length], false, 'mm'),
        {
          ...dataset(`${department} - promedio historico`, months.map(month =>
            average(historicalRows.map(row => row.months[month]).filter(Number.isFinite))
          ), COLORS[index % COLORS.length], false, 'mm'),
          type: 'line',
          backgroundColor: 'transparent',
          borderDash: [7, 4],
          borderWidth: 2.5,
          pointRadius: 3
        }
      ];
    });
    $('monthlyChartScope').textContent = `${f.departments.length} seleccionado(s)`;
    $('monthlyChartDescription').textContent = 'Cada departamento se compara contra su propio promedio historico mensual.';
  }
  chart('monthlyChart', 'bar', { labels, datasets }, barOptions('mm', false, true, 'Precipitacion mensual (mm)'));
}

function renderRanking(rows, f) {
  const months = selectedMonths(f);
  const grouped = {};
  rows.forEach(row => { (grouped[row.department] ??= []).push(recordValue(row, months)); });
  const entries = Object.entries(grouped).map(([department, values]) => {
    const historicalRows = state.rainfall.filter(row => row.department === department);
    return {
      department,
      selected: average(values),
      historical: average(historicalRows.map(row => recordValue(row, months)))
    };
  })
    .sort((a,b) => b.selected - a.selected)
    .slice(0, 15);
  chart('rankingChart', 'bar', {
    labels: entries.map(entry => entry.department),
    datasets: [
      dataset('Periodo seleccionado', entries.map(entry => entry.selected), COLORS[0], false, 'mm'),
      dataset('Promedio historico', entries.map(entry => entry.historical), '#7b8790', false, 'mm')
    ]
  }, barOptions('mm', true, true, 'Precipitacion comparable (mm)'));
}
function renderHeatmap(rows, f) {
  const months = selectedMonths(f);
  const departments = [...new Set(rows.map(row => row.department))].sort();
  const matrix = departments.map(department => months.map(month =>
    average(rows.filter(row => row.department === department).map(row => row.months[month]).filter(Number.isFinite))
  ));
  const max = Math.max(1, ...matrix.flat());
  let html = '<div class="heatmap-grid"><div></div>' + months.map(month => `<div class="heat-cell heat-head">${MONTHS[month]}</div>`).join('');
  departments.forEach((department, rowIndex) => {
    html += `<div class="heat-label">${department}</div>` + months.map((month, monthIndex) => {
      const value = matrix[rowIndex][monthIndex];
      const alpha = .08 + .85 * (value / max);
      return `<div class="heat-cell" title="${department} - ${MONTHS_FULL[month]}: ${format(value)} mm" style="background:rgba(34,211,238,${alpha})">${format(value)}</div>`;
    }).join('');
  });
  $('heatmap').innerHTML = html + '</div>';
  $('heatmap').querySelector('.heatmap-grid').style.gridTemplateColumns = `155px repeat(${months.length}, minmax(55px, 1fr))`;
}

function renderClimate(f) {
  const stationNames = selectedValues('stationFilter');
  const months = selectedMonths(f);
  const stations = state.stations.filter(station => stationNames.includes(station.station));
  const dashPatterns = [[], [8,4], [2,4], [10,4,2,4]];
  const dashClasses = ['scenario-solid','scenario-dashed','scenario-dotted','scenario-dashdot'];
  const pointStyles = ['circle','rect','triangle','rectRot','crossRot','star'];
  const metrics = [
    { key: 'temperature', label: 'Temperatura', unit: '\u00b0C', axis: 'y', color: '#c34f59' },
    { key: 'humidity', label: 'Humedad', unit: '%', axis: 'y', color: '#7667a8' },
    { key: 'wind', label: 'Viento', unit: 'unidad original', axis: 'y', color: '#d9931a' },
    { key: 'rain24Total', label: 'Lluvia mensual', unit: 'mm', axis: 'rain', color: '#1677a6' }
  ];
  const visibleMetrics = metrics.filter(metric => state.climateMetrics.has(metric.key));
  const scenarios = stations.flatMap(station => {
    const years = f.years === null ? [null] : f.years;
    return years.map(year => ({
      station,
      year,
      label: `${station.station} - ${year === null ? 'Promedio de todos los a\u00f1os' : year}`
    }));
  });
  const datasets = scenarios.flatMap((scenario, scenarioIndex) => {
    const rows = scenario.station.monthly.filter(row => scenario.year === null || row.year === scenario.year);
    return visibleMetrics.map(metric => ({
      ...dataset(`${metric.label} - ${scenario.label}`, months.map(month => {
        const values = rows.filter(row => row.month === month + 1).map(row => row[metric.key]).filter(Number.isFinite);
        return values.length ? average(values) : null;
      }), metric.color, false, metric.unit),
      yAxisID: metric.axis,
      borderDash: dashPatterns[scenarioIndex % dashPatterns.length],
      pointStyle: pointStyles[scenarioIndex % pointStyles.length],
      pointRadius: 3,
      pointHoverRadius: 5,
      spanGaps: false
    }));
  });
  const periodText = f.years === null ? 'promedio de todos los a\u00f1os' : `${f.years.length} a\u00f1o(s) comparado(s)`;
  $('stationCoverage').textContent = `${stations.length} localidad(es) - ${periodText}`;
  $('climateLegend').innerHTML = `
    <div class="climate-legend-group climate-variable-group"><span class="climate-legend-title">Variables clim\u00e1ticas visibles</span><div class="climate-legend-items climate-variable-items">
      ${metrics.map(metric => `<button type="button" class="climate-variable-button ${state.climateMetrics.has(metric.key) ? 'active' : ''}" data-climate-metric="${metric.key}" aria-pressed="${state.climateMetrics.has(metric.key)}"><i class="metric-swatch" style="--swatch:${metric.color}"></i><span>${metric.label}</span><small>${metric.unit}</small></button>`).join('')}
    </div></div>
    <div class="climate-legend-group"><span class="climate-legend-title">Trazo y s\u00edmbolo = localidad y per\u00edodo</span><div class="climate-legend-items climate-scenario-items">
      ${scenarios.map((scenario, index) => `<span class="climate-legend-item"><i class="scenario-swatch ${dashClasses[index % dashClasses.length]}" style="--point-rotation:${index % 2 ? 45 : 0}deg"></i>${scenario.label}</span>`).join('')}
    </div></div>`;
  chart('climateChart', 'line', { labels: months.map(month => MONTHS[month]), datasets }, {
    ...lineOptions(''),
    interaction: { mode: 'nearest', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        mode: 'nearest',
        intersect: false,
        callbacks: { label: context => tooltipLabel(context) }
      }
    },
    scales: {
      x: axis(),
      y: { ...axis('', 'Temperatura (\u00b0C), humedad (%) y viento (unidad original)'), display: visibleMetrics.some(metric => metric.axis === 'y'), position: 'left' },
      rain: { ...axis('mm', 'Lluvia mensual promedio (mm)'), display: visibleMetrics.some(metric => metric.axis === 'rain'), position: 'right', grid: { drawOnChartArea: false } }
    }
  });
}

function renderTable(rows, f) {
  const months = selectedMonths(f);
  const grouped = {};
  rows.forEach(row => { (grouped[row.department] ??= []).push(row); });
  state.tableRows = Object.entries(grouped).map(([department, records]) => {
    const observations = monthlyObservations(records, months);
    const values = observations.map(observation => observation.value);
    const peak = observations.reduce((best, observation) => observation.value > best.value ? observation : best, { value: -1, month: 0 });
    return {
      department,
      observations: observations.length,
      total: values.reduce((sum, value) => sum + value, 0),
      average: average(values),
      maximum: peak.value,
      peakMonth: peak.value >= 0 ? MONTHS_FULL[peak.month] : 'Sin datos'
    };
  });
  $('detailsTable').innerHTML = state.tableRows.map(row => `<tr><td>${row.department}</td><td>${row.observations}</td><td>${format(row.total)} mm</td><td>${format(row.average)} mm</td><td>${format(row.maximum)} mm</td><td>${row.peakMonth}</td></tr>`).join('');
}

function priorityData(f) {
  const months = selectedMonths(f);
  const rows = state.rainfall.filter(row => matchesSelection(row.year, f.years));
  const grouped = {};
  rows.forEach(row => (grouped[row.department] ??= []).push(recordValue(row, months)));
  const entries = Object.entries(grouped).map(([department, values]) => ({ department, rain: average(values) })).sort((a,b) => b.rain - a.rain);
  const provincialAverage = average(entries.map(entry => entry.rain));
  return entries.map((entry, index) => {
    const differencePct = provincialAverage ? ((entry.rain - provincialAverage) / provincialAverage) * 100 : 0;
    const level = differencePct > 30 ? 'Cr\u00edtico' : differencePct > 10 ? 'Alto' : differencePct >= -10 ? 'Medio' : 'Bajo';
    return { ...entry, differencePct, level, position: index + 1 };
  });
}

function renderPriority(f) {
  const all = priorityData(f);
  const selected = f.departments === null ? all : all.filter(row => f.departments.includes(row.department));
  $('kpiPriorityCount').textContent = selected.filter(row => row.level === 'Alto' || row.level === 'Cr\u00edtico').length;
  $('riskTable').innerHTML = selected.map(row => `<tr><td><span class="${riskClass(row.level)}">${row.level}</span></td><td>${row.department}</td><td>${signedPercent(row.differencePct)}</td><td>${format(row.rain)} mm</td><td>${row.position} de ${all.length}</td></tr>`).join('');
}

function riskClass(level) {
  return `risk-${level === 'Cr\u00edtico' ? 'critical' : level === 'Alto' ? 'high' : level === 'Medio' ? 'medium' : 'low'}`;
}

function signedPercent(value) {
  return `${value > 0 ? '+' : ''}${format(value)}%`;
}

function signedMm(value) {
  if (!Number.isFinite(value)) return '\u2014';
  return `${value > 0 ? '+' : ''}${format(value)}`;
}

function downloadTable() {
  const headers = ['Departamento','Observaciones_mensuales','Acumulado_periodo_mm','Promedio_mensual_mm','Maximo_mensual_mm','Mes_maximo'];
  const lines = state.tableRows.map(row => [row.department,row.observations,row.total.toFixed(2),row.average.toFixed(2),row.maximum.toFixed(2),row.peakMonth].join(';'));
  const blob = new Blob(['\ufeff' + [headers.join(';'), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'resumen_departamental.csv';
  link.click();
  URL.revokeObjectURL(link.href);
}

function groupTotals(rows, key, months) {
  return rows.reduce((output, row) => {
    const group = key(row);
    output[group] = (output[group] || 0) + recordValue(row, months);
    return output;
  }, {});
}

function dataset(label, data, color, fill = false, unit = '') {
  return { label, data, unit, borderColor: color, backgroundColor: fill ? `${color}20` : `${color}aa`, borderWidth: 2, fill, tension: .3, pointRadius: 2, borderRadius: 5 };
}

function axis(unit = '', title = '') {
  const ticks = { color: '#617887', font: { family: 'Inter', size: 10 } };
  if (unit) ticks.callback = value => format(value);
  return { grid: { color: 'rgba(52,86,104,.08)' }, title: { display: Boolean(title), text: title, color: '#496473', font: { family: 'Inter', size: 11, weight: '600' } }, ticks };
}

function tooltipLabel(context, fallbackUnit = '') {
  const unit = context.dataset.unit || fallbackUnit;
  return `${context.dataset.label}: ${format(context.raw)}${unit ? ` ${unit}` : ''}`;
}

function lineOptions(unit = '', axisTitle = '') {
  return { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { color: '#496473', usePointStyle: true } }, tooltip: { callbacks: { label: context => tooltipLabel(context, unit) } } }, scales: { x: axis(), y: axis(unit, axisTitle) } };
}

function barOptions(unit = '', horizontal = false, showLegend = false, axisTitle = '') {
  const options = lineOptions(unit, axisTitle);
  if (horizontal) options.scales = { x: axis(unit, axisTitle), y: axis() };
  return { ...options, indexAxis: horizontal ? 'y' : 'x', interaction: { mode: 'nearest', axis: horizontal ? 'y' : 'x', intersect: false }, plugins: { legend: { display: showLegend, labels: { color: '#496473', usePointStyle: true } }, tooltip: { callbacks: { label: context => tooltipLabel(context, unit) } } } };
}

function chart(id, type, data, options) {
  if (state.charts[id]) state.charts[id].destroy();
  state.charts[id] = new Chart($(id), { type, data, options });
}
