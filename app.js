const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const MONTHS_FULL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const COLORS = ['#1677a6','#25a9b5','#7667a8','#d9931a','#c34f59','#3d9a6b','#7b8790','#b46a9b'];
const ALL_MONTHS = MONTHS.map((_, index) => index);
const state = { rainfall: [], stations: [], metadata: {}, charts: {}, tableRows: [], filterConfigs: {} };
const $ = id => document.getElementById(id);
const format = value => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(value || 0);
const average = values => values.length ? values.reduce((a,b) => a + b, 0) / values.length : 0;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    const [rainfall, stations, metadata] = await Promise.all(
      ['rainfall.json','stations.json','metadata.json'].map(name => fetch(`data/${name}`).then(response => {
        if (!response.ok) throw new Error(`No se pudo cargar ${name}`);
        return response.json();
      }))
    );
    Object.assign(state, { rainfall, stations, metadata });
    populateFilters();
    wireControls();
    render();
    $('headerCoverage').textContent = `${metadata.yearMin}–${metadata.yearMax}`;
    $('headerDepartments').textContent = metadata.departments.length;
    $('headerUpdated').textContent = new Date(metadata.generatedAt).toLocaleDateString('es-AR');
    $('latestDataYear').textContent = metadata.yearMax;
    $('dataNote').textContent = `Fuente principal: ${metadata.rainfallSource}`;
  } catch (error) {
    $('errorBanner').style.display = 'block';
    $('errorBanner').textContent = `${error.message}. Ejecutá el dashboard mediante un servidor HTTP local.`;
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
    allLabel: 'Todos los años',
    defaultValues: years.includes(latestCompleteYear) ? [String(latestCompleteYear)] : ['ALL']
  });
  createMultiFilter('monthFilter', MONTHS_FULL.map((label, value) => ({ value: String(value), label })), {
    allLabel: 'Año completo',
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
  renderClimate(f);
  renderTable(rows, f);
  renderPriority(f);
}

function updateKpis(rows, f) {
  const months = selectedMonths(f);
  const values = rows.map(row => recordValue(row, months));
  const grouped = groupTotals(rows, row => row.department, months);
  const top = Object.entries(grouped).sort((a,b) => b[1] - a[1])[0];
  $('kpiTotal').textContent = `${format(average(values))} mm`;
  $('kpiTotalDetail').textContent = f.years === null ? 'promedio por registro seleccionado' : `promedio de ${f.years.length} año(s) seleccionado(s)`;
  $('kpiTopDepartment').textContent = top ? top[0] : '—';
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
  chart('annualChart', 'line', { labels, datasets }, lineOptions('mm', 'Precipitación acumulada (mm)'));
}

function renderMonthly(rows, f) {
  const months = selectedMonths(f);
  const labels = months.map(month => MONTHS[month]);
  let datasets;
  if (f.departments === null) {
    datasets = [dataset('Promedio provincial', months.map(month =>
      average(rows.map(row => row.months[month]).filter(Number.isFinite))
    ), COLORS[1], false, 'mm')];
    $('monthlyChartScope').textContent = 'Provincia';
    $('monthlyChartDescription').textContent = 'Promedio provincial para los meses y años seleccionados.';
  } else {
    datasets = f.departments.map((department, index) => {
      const departmentRows = rows.filter(row => row.department === department);
      return dataset(department, months.map(month =>
        average(departmentRows.map(row => row.months[month]).filter(Number.isFinite))
      ), COLORS[index % COLORS.length], false, 'mm');
    });
    const provincialRows = state.rainfall.filter(row => matchesSelection(row.year, f.years));
    datasets.push({
      ...dataset('Promedio provincial', months.map(month =>
        average(provincialRows.map(row => row.months[month]).filter(Number.isFinite))
      ), '#6f8794', false, 'mm'),
      type: 'line',
      backgroundColor: 'transparent',
      borderWidth: 2.5,
      pointRadius: 3
    });
    $('monthlyChartScope').textContent = `${f.departments.length} seleccionado(s)`;
    $('monthlyChartDescription').textContent = 'Comparación de los departamentos elegidos frente al promedio provincial.';
  }
  chart('monthlyChart', 'bar', { labels, datasets }, barOptions('mm', false, true, 'Precipitación mensual (mm)'));
}

function renderRanking(rows, f) {
  const entries = Object.entries(groupTotals(rows, row => row.department, selectedMonths(f)))
    .sort((a,b) => b[1] - a[1])
    .slice(0, 15);
  chart('rankingChart', 'bar', {
    labels: entries.map(entry => entry[0]),
    datasets: [dataset('Acumulado', entries.map(entry => entry[1]), COLORS[0], false, 'mm')]
  }, barOptions('mm', true, false, 'Precipitación acumulada (mm)'));
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
      return `<div class="heat-cell" title="${department} · ${MONTHS_FULL[month]}: ${format(value)} mm" style="background:rgba(34,211,238,${alpha})">${format(value)}</div>`;
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
    { key: 'temperature', label: 'Temperatura', unit: '°C', axis: 'y', color: '#c34f59' },
    { key: 'humidity', label: 'Humedad', unit: '%', axis: 'y', color: '#7667a8' },
    { key: 'wind', label: 'Viento', unit: 'unidad original', axis: 'y', color: '#d9931a' },
    { key: 'rain24Total', label: 'Lluvia mensual', unit: 'mm', axis: 'rain', color: '#1677a6' }
  ];
  const scenarios = stations.flatMap(station => {
    const years = f.years === null ? [null] : f.years;
    return years.map(year => ({
      station,
      year,
      label: `${station.station} · ${year === null ? 'Promedio de todos los años' : year}`
    }));
  });
  const datasets = scenarios.flatMap((scenario, scenarioIndex) => {
    const rows = scenario.station.monthly.filter(row => scenario.year === null || row.year === scenario.year);
    return metrics.map(metric => ({
      ...dataset(`${metric.label} · ${scenario.label}`, months.map(month => {
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
  const periodText = f.years === null ? 'promedio de todos los años' : `${f.years.length} año(s) comparado(s)`;
  $('stationCoverage').textContent = `${stations.length} localidad(es) · ${periodText}`;
  $('climateLegend').innerHTML = `
    <div class="climate-legend-group"><span class="climate-legend-title">Color = fenómeno</span><div class="climate-legend-items">
      ${metrics.map(metric => `<span class="climate-legend-item"><i class="metric-swatch" style="--swatch:${metric.color}"></i>${metric.label} (${metric.unit})</span>`).join('')}
    </div></div>
    <div class="climate-legend-group"><span class="climate-legend-title">Trazo y símbolo = localidad y período</span><div class="climate-legend-items">
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
      y: { ...axis('', 'Temperatura (°C), humedad (%) y viento (unidad original)'), position: 'left' },
      rain: { ...axis('mm', 'Lluvia mensual promedio (mm)'), position: 'right', grid: { drawOnChartArea: false } }
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
    const level = differencePct > 30 ? 'Crítico' : differencePct > 10 ? 'Alto' : differencePct >= -10 ? 'Medio' : 'Bajo';
    return { ...entry, differencePct, level, position: index + 1 };
  });
}

function renderPriority(f) {
  const all = priorityData(f);
  const selected = f.departments === null ? all : all.filter(row => f.departments.includes(row.department));
  $('kpiPriorityCount').textContent = selected.filter(row => row.level === 'Alto' || row.level === 'Crítico').length;
  $('prioritySummary').innerHTML = selected.slice(0, 7).map(row => `<div class="priority-item"><span class="risk-dot ${riskClass(row.level)}"></span><div><strong>${row.department}</strong><br><small>${format(row.rain)} mm promedio</small></div><span class="priority-score">${signedPercent(row.differencePct)}</span></div>`).join('');
  $('riskTable').innerHTML = selected.map(row => `<tr><td><span class="${riskClass(row.level)}">${row.level}</span></td><td>${row.department}</td><td>${signedPercent(row.differencePct)}</td><td>${format(row.rain)} mm</td><td>${row.position} de ${all.length}</td></tr>`).join('');
}

function riskClass(level) {
  return `risk-${level === 'Crítico' ? 'critical' : level === 'Alto' ? 'high' : level === 'Medio' ? 'medium' : 'low'}`;
}

function signedPercent(value) {
  return `${value > 0 ? '+' : ''}${format(value)}%`;
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
