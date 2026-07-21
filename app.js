const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const MONTHS_FULL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const COLORS = ['#1677a6','#25a9b5','#7667a8','#d9931a','#c34f59','#3d9a6b','#7b8790','#b46a9b'];
const ALL_MONTHS = MONTHS.map((_, index) => index);
const DAILY_WINDOWS = [1, 7, 15, 30];
const state = { rainfall: [], monthlyRainfall: [], monthlySourceStats: {}, dailyRecords: [], stations: [], metadata: {}, charts: {}, tableRows: [], filterConfigs: {}, temporalFiltersExplicit: { years: false, months: false }, climateMetrics: new Set(['temperature','humidity','wind','rain24Total']) };
const $ = id => document.getElementById(id);
const format = value => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(value || 0);
const average = values => values.length ? values.reduce((a,b) => a + b, 0) / values.length : 0;
const averageFinite = values => {
  const finiteValues = values.filter(Number.isFinite);
  return finiteValues.length ? average(finiteValues) : null;
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    const [rainfall, dailyRecords, stations, metadata] = await Promise.all(
      ['rainfall.json','rainfall-daily.json','stations.json','metadata.json'].map(name => fetch(`data/${name}`).then(response => {
        if (!response.ok) throw new Error(`No se pudo cargar ${name}`);
        return response.json();
      }))
    );
    Object.assign(state, { rainfall, dailyRecords, stations, metadata });
    state.monthlySourceStats = buildCombinedMonthlyRainfall();
    populateFilters();
    wireControls();
    render();
    $('headerCoverage').textContent = `${metadata.yearMin}-${metadata.yearMax}`;
    $('headerDepartments').textContent = metadata.departments.length;
    $('headerUpdated').textContent = new Date(metadata.generatedAt).toLocaleDateString('es-AR');
    $('latestDataYear').textContent = metadata.yearMax;
    $('dataNote').textContent = `Fuente mensual principal: ${metadata.rainfallSource}. Base mensual combinada: ${state.monthlySourceStats.addedDepartmentMonths} departamento-mes derivados desde registros diarios vigentes.`;
  } catch (error) {
    $('errorBanner').style.display = 'block';
    $('errorBanner').textContent = `${error.message}. Ejecuta el dashboard mediante un servidor HTTP local.`;
    console.error(error);
  } finally {
    $('loading').classList.add('hidden');
  }
}

function populateFilters() {
  const years = [...new Set(monthlyRows().map(row => row.year))].sort((a,b) => b - a);
  const maxMonthlyYear = years.length ? Math.max(...years) : state.metadata.yearMax;
  const latestCompleteYear = maxMonthlyYear - 1;
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
  $('annualToFilter').value = maxMonthlyYear;
}

function monthlyRows() {
  return state.monthlyRainfall.length ? state.monthlyRainfall : state.rainfall;
}

function buildCombinedMonthlyRainfall() {
  const rowsByKey = new Map();
  state.rainfall.forEach(row => {
    const months = [...row.months];
    const monthSources = months.map(value => Number.isFinite(value) ? 'monthly' : null);
    rowsByKey.set(monthlyRowKey(row.department, row.year), {
      ...row,
      months,
      monthSources,
      dailyDerivedMeta: Array.from({ length: 12 }, () => null)
    });
  });

  const derived = deriveMonthlyFromDailyRecords(state.dailyRecords);
  let added = 0;
  let preservedMonthly = 0;
  derived.forEach(entry => {
    const key = monthlyRowKey(entry.department, entry.year);
    let row = rowsByKey.get(key);
    if (!row) {
      row = {
        department: entry.department,
        year: entry.year,
        months: Array(12).fill(null),
        monthSources: Array(12).fill(null),
        dailyDerivedMeta: Array.from({ length: 12 }, () => null)
      };
      rowsByKey.set(key, row);
    }
    if (Number.isFinite(row.months[entry.month])) {
      preservedMonthly += 1;
      return;
    }
    row.months[entry.month] = entry.rainfallMm;
    row.monthSources[entry.month] = 'daily_derived';
    row.dailyDerivedMeta[entry.month] = {
      daysWithRecords: entry.daysWithRecords,
      daysInMonth: entry.daysInMonth,
      source: 'daily_derived'
    };
    added += 1;
  });

  const combinedRows = [...rowsByKey.values()].map(row => {
    const values = row.months.filter(Number.isFinite);
    return {
      ...row,
      total: values.length ? values.reduce((sum, value) => sum + value, 0) : null,
      average: values.length ? average(values) : null
    };
  }).sort((a, b) => a.department.localeCompare(b.department, 'es') || a.year - b.year);

  state.monthlyRainfall = combinedRows;
  return {
    originalMonthlyRows: state.rainfall.length,
    combinedMonthlyRows: combinedRows.length,
    derivedDepartmentMonths: derived.length,
    addedDepartmentMonths: added,
    preservedMonthlyDepartmentMonths: preservedMonthly
  };
}

function deriveMonthlyFromDailyRecords(records) {
  const groups = new Map();
  records.forEach(record => {
    if (!record.date || !record.department) return;
    const rainfallMm = Number(record.rainfallMm);
    if (!Number.isFinite(rainfallMm) || rainfallMm < 0) return;
    const [year, monthNumber] = record.date.split('-').map(Number);
    if (!Number.isInteger(year) || !Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) return;
    const month = monthNumber - 1;
    const key = `${record.department}|${year}|${month}`;
    if (!groups.has(key)) {
      groups.set(key, {
        department: record.department,
        year,
        month,
        rainfallMm: 0,
        dates: new Set()
      });
    }
    const group = groups.get(key);
    group.rainfallMm += rainfallMm;
    group.dates.add(record.date);
  });
  return [...groups.values()].map(group => ({
    department: group.department,
    year: group.year,
    month: group.month,
    rainfallMm: group.rainfallMm,
    daysWithRecords: group.dates.size,
    daysInMonth: daysInMonth(group.year, group.month)
  }));
}

function daysInMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function monthlyRowKey(department, year) {
  return `${department}|${year}`;
}

function monthlyObservationSourceLabel(rows, month) {
  const rowsWithValue = rows.filter(row => Number.isFinite(row.months[month]));
  if (!rowsWithValue.length) return null;
  const derivedRows = rowsWithValue.filter(row => row.monthSources?.[month] === 'daily_derived');
  if (!derivedRows.length) return 'fuente mensual';
  const source = derivedRows.length === rowsWithValue.length ? 'diaria mensualizada' : 'mensual + diaria mensualizada';
  if (derivedRows.length === 1) {
    const meta = derivedRows[0].dailyDerivedMeta?.[month];
    if (meta) return `${source}; ${meta.daysWithRecords}/${meta.daysInMonth} días con registro`;
  }
  return `${source}; ${derivedRows.length} observación(es) mensualizada(s)`;
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
      if (id === 'yearFilter') state.temporalFiltersExplicit.years = true;
      if (id === 'monthFilter') state.temporalFiltersExplicit.months = true;
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
  $('dailySortFilter').addEventListener('change', () => renderDaily(filters()));
  $('resetFilters').addEventListener('click', () => {
    const latestCompleteYear = state.metadata.yearMax - 1;
    setMultiSelection('departmentFilter', ['ALL']);
    setMultiSelection('yearFilter', [String(latestCompleteYear)]);
    setMultiSelection('monthFilter', ['ALL']);
    setMultiSelection('stationFilter', [state.stations[0].station]);
    state.temporalFiltersExplicit.years = false;
    state.temporalFiltersExplicit.months = false;
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
  return monthlyRows().filter(row => matchesSelection(row.department, f.departments) && matchesSelection(row.year, f.years));
}

function selectedMonths(f) {
  return f.months === null ? ALL_MONTHS : f.months;
}

function recordValue(record, months) {
  const values = months.map(month => record.months[month]).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function monthlyObservations(records, months) {
  return records.flatMap(record => months
    .filter(month => Number.isFinite(record.months[month]))
    .map(month => ({ value: record.months[month], month, year: record.year })));
}

function render() {
  const f = filters();
  const rows = filteredRainfall(f);
  updateKpis(f);
  renderAnnual(f);
  renderMonthly(rows, f);
  renderRanking(rows, f);
    renderHeatmap(rows, f);
  renderDaily(f);
  renderClimate(f);
  renderDepartmentDetail(getDepartmentMonthlyDeviationRows(f), f);
}

function updateKpis(f) {
  const summary = monthlySummaryComparison(f);
  $('kpiReferenceMonth').textContent = summary.period ? `${MONTHS_FULL[summary.period.month]} ${summary.period.year}` : 'Sin dato';
  $('kpiReferenceDetail').textContent = summary.usesExplicitFilters ? 'según filtros activos' : 'último mes mensual disponible';
  $('kpiObserved').textContent = formatNullable(summary.observedMm);
  $('kpiObservedDetail').textContent = summary.singleDepartment ? 'observado del departamento seleccionado' : `promedio departamental observado (${summary.observedCount} depto.)`;
  $('kpiHistorical').textContent = formatNullable(summary.historicalAverageMm);
  $('kpiHistoricalDetail').textContent = summary.singleDepartment ? 'histórico del departamento para ese mes' : `promedio histórico departamental (${summary.historicalCount} depto.)`;
  $('kpiDifference').textContent = formatSignedMm(summary.differenceMm);
  $('kpiProgress').textContent = formatProgress(summary.progressPct);
  $('kpiProgressDetail').textContent = Number.isFinite(summary.progressPct) && summary.progressPct >= 100 ? 'avance sobre promedio histórico' : 'del promedio histórico mensual';
  $('kpiMonthlyCategory').textContent = summary.category;
}

function monthlySummaryComparison(f) {
  const departments = state.metadata.departments.filter(department => matchesSelection(department, f.departments));
  const period = getSummaryReferencePeriod(departments, f);
  if (!period) {
    return {
      period: null,
      observedMm: null,
      historicalAverageMm: null,
      differenceMm: null,
      progressPct: null,
      category: 'Sin referencia',
      observedCount: 0,
      historicalCount: 0,
      singleDepartment: departments.length === 1,
      usesExplicitFilters: state.temporalFiltersExplicit.years || state.temporalFiltersExplicit.months
    };
  }
  const observedEntries = departments
    .map(department => ({ department, value: monthlyValue(department, period.year, period.month) }))
    .filter(entry => Number.isFinite(entry.value));
  const observedValues = observedEntries.map(entry => entry.value);
  const historicalValues = observedEntries
    .map(entry => getMonthlyHistoricalAverage(entry.department, period.month))
    .filter(Number.isFinite);
  const observedMm = observedValues.length ? average(observedValues) : null;
  const historicalAverageMm = historicalValues.length ? average(historicalValues) : null;
  const differenceMm = Number.isFinite(observedMm) && Number.isFinite(historicalAverageMm) ? observedMm - historicalAverageMm : null;
  const progressPct = Number.isFinite(observedMm) && historicalAverageMm > 0 ? (observedMm / historicalAverageMm) * 100 : null;
  return {
    period,
    observedMm,
    historicalAverageMm,
    differenceMm,
    progressPct,
    category: classifyHistoricalProgress(progressPct),
    observedCount: observedValues.length,
    historicalCount: historicalValues.length,
    singleDepartment: departments.length === 1,
    usesExplicitFilters: state.temporalFiltersExplicit.years || state.temporalFiltersExplicit.months
  };
}

function getSummaryReferencePeriod(departments, f) {
  const years = state.temporalFiltersExplicit.years ? f.years : null;
  const months = state.temporalFiltersExplicit.months ? selectedMonths(f) : ALL_MONTHS;
  const minimumCoverage = Math.ceil(departments.length * 0.8);
  const periods = new Map();
  monthlyRows().forEach(row => {
    if (!departments.includes(row.department)) return;
    if (!matchesSelection(row.year, years)) return;
    row.months.forEach((value, month) => {
      if (!months.includes(month)) return;
      if (!Number.isFinite(value)) return;
      const key = `${row.year}-${month}`;
      if (!periods.has(key)) periods.set(key, { year: row.year, month, departments: new Set() });
      periods.get(key).departments.add(row.department);
    });
  });
  return [...periods.values()]
    .filter(period => period.departments.size >= minimumCoverage)
    .sort((a, b) => b.year - a.year || b.month - a.month)[0] || null;
}

function monthlyValue(department, year, month) {
  const record = monthlyRows().find(row => row.department === department && row.year === year);
  return record && Number.isFinite(record.months[month]) ? record.months[month] : null;
}

function classifyHistoricalProgress(progressPct) {
  if (!Number.isFinite(progressPct)) return 'Sin referencia';
  if (progressPct < 70) return 'Muy por debajo';
  if (progressPct < 90) return 'Por debajo';
  if (progressPct <= 110) return 'En torno al promedio';
  if (progressPct <= 130) return 'Por encima';
  return 'Muy por encima';
}

function validDailyRecords(f = filters()) {
  return state.dailyRecords
    .filter(record =>
      record.date &&
      record.department &&
      Number.isFinite(record.rainfallMm) &&
      matchesSelection(record.department, f.departments)
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.department.localeCompare(b.department, 'es'));
}

function renderDaily(f) {
  const records = validDailyRecords(f);
  if (!records.length) {
    $('dailyLatestDate').textContent = '\u2014';
    $('dailyCoverage').textContent = 'Sin observaciones diarias vigentes para los filtros activos';
    ['dailyRain24','dailyRain7','dailyRain30','dailyTopDepartment','dailyWetDepartments','dailyMaxRecord'].forEach(id => $(id).textContent = 'Sin dato');
    ['dailyRain24Detail','dailyRain7Detail','dailyRain30Detail','dailyTopDepartmentDetail','dailyWetDepartmentsDetail','dailyMaxRecordDetail'].forEach(id => $(id).textContent = 'sin observaciones');
    $('dailyRankingTable').innerHTML = '';
    $('dailyReferenceTable').innerHTML = '<tr><td colspan="7">No hay observaciones diarias para los filtros activos.</td></tr>';
    $('dailyTable').innerHTML = '<tr><td colspan="5">No hay observaciones diarias para los filtros activos.</td></tr>';
    chart('dailySeriesChart', 'line', { labels: [], datasets: [] }, lineOptions('mm', 'Lluvia diaria (mm)'));
    updateDailyQuickStats(f);
    return;
  }

  const latestDate = records[records.length - 1].date;
  const selectedWindow = +$('dailyWindowFilter').value || 7;
  const rows = dailyOperationalRows(records, latestDate);
  const selectedRows = rows.filter(row => row.observations[selectedWindow] > 0);
  const sortDirection = $('dailySortFilter')?.value === 'asc' ? 1 : -1;
  const rankingRows = [...rows].sort((a, b) => sortDirection * (a.windows[selectedWindow] - b.windows[selectedWindow]) || a.department.localeCompare(b.department, 'es'));
  const topDepartment = selectedRows.length ? [...selectedRows].sort((a, b) => b.windows[selectedWindow] - a.windows[selectedWindow] || a.department.localeCompare(b.department, 'es'))[0] : null;
  const maxRecord = dailyMaxRecord(records, latestDate, selectedWindow);
  const singleDepartment = f.departments?.length === 1;

  $('dailyLatestDate').textContent = formatDate(latestDate);
  $('dailyCoverage').textContent = `${records[0].date} a ${latestDate} - ${records.length} observaciones departamentales vigentes`;
  updateDailyKpis(rows, latestDate, topDepartment, maxRecord, selectedWindow, singleDepartment);
  renderDailySeries(records, latestDate, f, selectedWindow);
  renderDailyReferenceTable(f, selectedWindow);
  $('dailyRankingTable').innerHTML = rankingRows.map(row => `
    <tr>
      <td>${row.department}</td>
      <td>${dailyWindowDisplay(row, 7)}</td>
      <td>${dailyWindowDisplay(row, 30)}</td>
      <td>${formatDate(row.lastDate)}</td>
      <td>${Number.isFinite(row.maxDaily) ? `${format(row.maxDaily)} mm` : 'Sin dato'}</td>
    </tr>`).join('');
  $('dailyTable').innerHTML = rankingRows.map(row => `
    <tr>
      <td>${row.department}</td>
      <td>${formatDate(row.lastDate)}</td>
      <td>${dailyWindowDisplay(row, 1)}</td>
      <td>${dailyWindowDisplay(row, 7)}</td>
      <td>${dailyWindowDisplay(row, 30)}</td>
    </tr>`).join('');
  updateDailyQuickStats(f);
}

function dailyOperationalRows(records, latestDate) {
  const departments = [...new Set(records.map(record => record.department))].sort((a, b) => a.localeCompare(b, 'es'));
  return departments.map(department => {
    const departmentRecords = records.filter(record => record.department === department);
    const windows = Object.fromEntries(DAILY_WINDOWS.map(days => [days, dailyWindowTotal(departmentRecords, latestDate, days)]));
    const observations = Object.fromEntries(DAILY_WINDOWS.map(days => [days, dailyWindowRecords(departmentRecords, latestDate, days).length]));
    const recentRecords = dailyWindowRecords(departmentRecords, latestDate, 30);
    const lastRecord = departmentRecords[departmentRecords.length - 1];
    return {
      department,
      lastDate: lastRecord.date,
      rain24: windows[1],
      windows,
      observations,
      maxDaily: recentRecords.length ? Math.max(...recentRecords.map(record => record.rainfallMm)) : null
    };
  });
}

function updateDailyKpis(rows, latestDate, topDepartment, maxRecord, selectedWindow, singleDepartment) {
  [1, 7, 30].forEach(days => {
    const id = days === 1 ? 'dailyRain24' : `dailyRain${days}`;
    const detailId = days === 1 ? 'dailyRain24Detail' : `dailyRain${days}Detail`;
    const rowsWithData = rows.filter(row => row.observations[days] > 0);
    const value = rowsWithData.length ? (singleDepartment ? rowsWithData[0].windows[days] : average(rowsWithData.map(row => row.windows[days]))) : null;
    $(id).textContent = Number.isFinite(value) ? `${format(value)} mm` : 'Sin dato';
    $(detailId).textContent = singleDepartment ? 'acumulado temporal del departamento seleccionado' : `promedio departamental de acumulados (${rowsWithData.length} depto.)`;
  });
  $('dailyTopDepartment').textContent = topDepartment ? topDepartment.department : 'Sin dato';
  $('dailyTopDepartmentDetail').textContent = topDepartment ? `${format(topDepartment.windows[selectedWindow])} mm acumulados en ${dailyWindowLabel(selectedWindow)}` : `sin lluvia mayor a 0 mm en ${dailyWindowLabel(selectedWindow)}`;
  const wetCount = rows.filter(row => row.windows[selectedWindow] > 0).length;
  $('dailyWetDepartments').textContent = `${wetCount}`;
  $('dailyWetDepartmentsDetail').textContent = `con lluvia mayor a 0 mm en ${dailyWindowLabel(selectedWindow)}`;
  $('dailyMaxRecord').textContent = maxRecord ? `${format(maxRecord.rainfallMm)} mm` : 'Sin dato';
  $('dailyMaxRecordDetail').textContent = maxRecord ? `${maxRecord.department} - ${formatDate(maxRecord.date)}` : `sin observaciones válidas en ${dailyWindowLabel(selectedWindow)}`;
}

function dailyWindowDisplay(row, days) {
  return row.observations[days] > 0 ? `${format(row.windows[days])} mm` : 'Sin dato';
}

function renderDailyReferenceTable(f, selectedWindow) {
  const allRecords = validDailyRecords({ ...f, departments: null });
  const latestDate = allRecords.length ? allRecords[allRecords.length - 1].date : null;
  const departments = f.departments === null
    ? [...new Set(allRecords.map(record => record.department))].sort((a, b) => a.localeCompare(b, 'es'))
    : f.departments;
  if (!latestDate || !departments?.length) {
    $('dailyReferenceTable').innerHTML = '<tr><td colspan="7">No hay observaciones diarias para los filtros activos.</td></tr>';
    return;
  }

  const rows = departments.map(department => dailyReferenceRow(allRecords, department, latestDate, selectedWindow));
  const sortedRows = rows.sort((a, b) =>
    (Number.isFinite(b.observedMm) ? b.observedMm : -Infinity) - (Number.isFinite(a.observedMm) ? a.observedMm : -Infinity) ||
    a.department.localeCompare(b.department, 'es')
  );
  $('dailyReferenceTable').innerHTML = sortedRows.map(row => `
    <tr>
      <td>${row.department}</td>
      <td>${Number.isFinite(row.observedMm) ? `${format(row.observedMm)} mm` : 'Sin dato'}</td>
      <td>${Number.isFinite(row.referenceMm) ? `${format(row.referenceMm)} mm` : 'Sin referencia suficiente'}</td>
      <td>${dailyReferenceDifferenceDisplay(row)}</td>
      <td>${dailyReferencePctDisplay(row)}</td>
      <td>${row.comparableYears.length ? row.comparableYears.join(', ') : 'Sin referencia suficiente'}</td>
      <td>${row.category}</td>
    </tr>`).join('');
}

function dailyReferenceRow(records, department, latestDate, selectedWindow) {
  const windowDays = Number.isFinite(selectedWindow) && selectedWindow > 0 ? selectedWindow : 7;
  const currentStart = addDays(latestDate, 1 - windowDays);
  const observed = dailyWindowSumForRange(records, department, currentStart, latestDate);
  const latestYear = +latestDate.slice(0, 4);
  const availableYears = [...new Set(records
    .filter(record => record.department === department)
    .map(record => +record.date.slice(0, 4))
    .filter(year => year < latestYear))]
    .sort((a, b) => a - b);
  const comparable = availableYears
    .map(year => equivalentDailyWindow(records, department, latestDate, windowDays, year))
    .filter(window => window.observations > 0);
  const comparableYears = comparable.map(window => window.year);
  const referenceMm = comparable.length >= 2 ? average(comparable.map(window => window.totalMm)) : null;
  const differenceMm = Number.isFinite(referenceMm) && Number.isFinite(observed.totalMm) ? observed.totalMm - referenceMm : null;
  const differencePct = Number.isFinite(referenceMm) && referenceMm > 0 && Number.isFinite(observed.totalMm)
    ? ((observed.totalMm / referenceMm) - 1) * 100
    : null;
  return {
    department,
    observedMm: observed.observations > 0 ? observed.totalMm : null,
    referenceMm,
    differenceMm,
    differencePct,
    observedAvailable: observed.observations > 0,
    comparableYears,
    category: dailyReferenceCategory(observed.observations > 0, comparableYears.length, referenceMm, differencePct)
  };
}

function equivalentDailyWindow(records, department, currentEnd, windowDays, year) {
  const end = replaceYear(currentEnd, year);
  if (!end) return { year, totalMm: null, observations: 0 };
  const start = addDays(end, 1 - windowDays);
  return { year, ...dailyWindowSumForRange(records, department, start, end) };
}

function dailyWindowSumForRange(records, department, startDate, endDate) {
  const values = records
    .filter(record => record.department === department && record.date >= startDate && record.date <= endDate)
    .map(record => record.rainfallMm)
    .filter(Number.isFinite);
  return {
    totalMm: values.length ? values.reduce((sum, value) => sum + value, 0) : null,
    observations: values.length
  };
}

function replaceYear(dateString, year) {
  const [, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

function dailyReferenceDifferenceDisplay(row) {
  if (!row.observedAvailable) return 'Sin dato observado';
  if (row.comparableYears.length < 2 || !Number.isFinite(row.referenceMm)) return 'Sin referencia suficiente';
  return Number.isFinite(row.differenceMm) ? `${formatSigned(row.differenceMm)} mm` : 'Sin referencia suficiente';
}

function dailyReferencePctDisplay(row) {
  if (!row.observedAvailable) return 'Sin dato observado';
  if (row.comparableYears.length < 2 || !Number.isFinite(row.referenceMm)) return 'Sin referencia suficiente';
  if (row.referenceMm === 0) return 'Referencia igual a 0';
  return Number.isFinite(row.differencePct) ? `${formatSigned(row.differencePct)}%` : 'No calculable';
}

function dailyReferenceCategory(observedAvailable, comparableYears, referenceMm, differencePct) {
  if (!observedAvailable) return 'Sin dato observado';
  if (comparableYears < 2 || !Number.isFinite(referenceMm)) return 'Sin referencia suficiente';
  if (referenceMm === 0 || !Number.isFinite(differencePct)) return 'No calculable';
  if (differencePct <= -30) return 'Muy por debajo';
  if (differencePct <= -10) return 'Por debajo';
  if (differencePct < 10) return 'En torno a la referencia';
  if (differencePct < 30) return 'Por encima';
  return 'Muy por encima';
}

function formatSigned(value) {
  if (!Number.isFinite(value)) return 'Sin dato';
  const formatted = format(Math.abs(value));
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}

function renderDailySeries(records, latestDate, f, selectedWindow) {
  const windowDays = Number.isFinite(selectedWindow) && selectedWindow > 0 ? selectedWindow : 30;
  const startDate = addDays(latestDate, 1 - windowDays);
  const seriesRecords = records.filter(record => record.date >= startDate && record.date <= latestDate);
  const dates = Array.from({ length: windowDays }, (_, index) => addDays(startDate, index));
  const singleDepartment = f.departments?.length === 1;
  const values = dates.map(date => {
    const dayRecords = seriesRecords.filter(record => record.date === date);
    if (!dayRecords.length) return null;
    return singleDepartment ? dayRecords[0].rainfallMm : average(dayRecords.map(record => record.rainfallMm));
  });
  $('dailySeriesDescription').textContent = singleDepartment
    ? 'Lluvia diaria del departamento seleccionado. Los días sin observación se muestran como sin dato y no se imputan como 0 mm.'
    : 'Promedio departamental diario entre departamentos con registro. Los días sin observación se muestran como sin dato y no se imputan como 0 mm.';
  chart('dailySeriesChart', 'bar', {
    labels: dates.map(formatShortDate),
    datasets: [dataset(singleDepartment ? 'Lluvia diaria departamental' : 'Promedio departamental diario', values, COLORS[0], false, 'mm')]
  }, barOptions('mm', false, false, 'Lluvia diaria (mm)'));
}

function dailyWindowRecords(records, latestDate, days) {
  const startDate = addDays(latestDate, 1 - days);
  return records.filter(record => record.date >= startDate && record.date <= latestDate);
}

function dailyWindowTotal(records, latestDate, days) {
  const values = dailyWindowRecords(records, latestDate, days).map(record => record.rainfallMm).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : 0;
}

function dailyMaxRecord(records, latestDate, days) {
  const windowRecords = dailyWindowRecords(records, latestDate, days);
  if (!windowRecords.length) return null;
  return [...windowRecords].sort((a, b) => b.rainfallMm - a.rainfallMm || b.date.localeCompare(a.date) || a.department.localeCompare(b.department, 'es'))[0];
}

function addDays(dateString, offset) {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function dailyWindowLabel(days) {
  return days === 1 ? 'última fecha disponible' : `${days} días`;
}

function formatShortDate(value) {
  const [year, month, day] = value.split('-').map(Number);
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`;
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function updateDailyQuickStats(f) {
  const records = validDailyRecords(f);
  if (!records.length) {
    [1, 7, 30].forEach(days => {
      const id = days === 1 ? 'quickRain24' : `quickRain${days}`;
      $(id).textContent = 'No disponible';
    });
    return;
  }
  const latestDate = records[records.length - 1].date;
  const rows = dailyOperationalRows(records, latestDate);
  [1, 7, 30].forEach(days => {
    const rowsWithData = rows.filter(row => row.observations[days] > 0);
    const id = days === 1 ? 'quickRain24' : `quickRain${days}`;
    const value = rowsWithData.length ? average(rowsWithData.map(row => row.windows[days])) : null;
    $(id).textContent = Number.isFinite(value) ? `${format(value)} mm` : 'No disponible';
  });
}

function formatDate(value) {
  if (!value) return '\u2014';
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('es-AR');
}

function renderAnnual(f) {
  const from = +$('annualFromFilter').value;
  const to = +$('annualToFilter').value;
  const rows = monthlyRows().filter(row =>
    matchesSelection(row.department, f.departments) &&
    matchesSelection(row.year, f.years) &&
    row.year >= from && row.year <= to
  );
  const months = selectedMonths(f);
  const labels = [...new Set(rows.map(row => row.year))].sort((a,b) => a - b);
  let datasets;
  if (f.departments === null) {
    datasets = [dataset('Promedio departamental', labels.map(year =>
      averageFinite(rows.filter(row => row.year === year).map(row => recordValue(row, months)))
    ), COLORS[0], true, 'mm')];
  } else {
    datasets = f.departments.map((department, index) => dataset(department, labels.map(year => {
      const records = rows.filter(row => row.year === year && row.department === department);
      return records.length ? averageFinite(records.map(row => recordValue(row, months))) : null;
    }), COLORS[index % COLORS.length], false, 'mm'));
  }
  chart('annualChart', 'line', { labels, datasets }, lineOptions('mm', 'Precipitaci\u00f3n acumulada (mm)'));
}

function renderMonthly(rows, f) {
  const months = selectedMonths(f);
  const labels = months.map(month => MONTHS[month]);
  let datasets;
  if (f.departments === null) {
    datasets = [{
      ...dataset('Acumulado mensual observado', months.map(month =>
      averageFinite(rows.map(row => row.months[month]))
      ), '#17a2d4', false, 'mm'),
      sourceInfo: months.map(month => monthlyObservationSourceLabel(rows, month)),
      order: 4
    }];
    datasets.push({
      ...dataset('Promedio histórico mensual', months.map(month =>
        averageFinite(monthlyRows().map(row => row.months[month]))
      ), '#6f8794', false, 'mm'),
      type: 'line',
      backgroundColor: 'transparent',
      borderDash: [7, 4],
      borderWidth: 2.5,
      pointRadius: 3,
      order: 2
    });
    datasets.push(...monthlyRangeDatasets(months, null));
    $('monthlyChartScope').textContent = 'Todos los departamentos';
    $('monthlyChartDescription').textContent = 'Acumulado mensual observado frente al promedio y rango histórico del mismo mes calendario.';
  } else {
    datasets = f.departments.flatMap((department, index) => {
      const departmentRows = rows.filter(row => row.department === department);
      const historicalRows = monthlyRows().filter(row => row.department === department);
      return [
        {
          ...dataset('Acumulado observado', months.map(month =>
          averageFinite(departmentRows.map(row => row.months[month]))
          ), '#17a2d4', false, 'mm'),
          tooltipScope: department,
          sourceInfo: months.map(month => monthlyObservationSourceLabel(departmentRows, month)),
          order: 4
        },
        {
          ...dataset('Promedio histórico', months.map(month =>
            averageFinite(historicalRows.map(row => row.months[month]))
          ), '#6f8794', false, 'mm'),
          tooltipScope: department,
          type: 'line',
          backgroundColor: 'transparent',
          borderDash: [7, 4],
          borderWidth: 2.5,
          pointRadius: 3,
          order: 2
        },
        ...monthlyRangeDatasets(months, department)
      ];
    });
    $('monthlyChartScope').textContent = `${f.departments.length} seleccionado(s)`;
    $('monthlyChartDescription').textContent = 'Acumulado mensual observado frente al promedio y rango histórico del mismo mes calendario.';
  }
  const options = barOptions('mm', false, true, 'Precipitación mensual (mm)');
  options.interaction = { mode: 'index', intersect: false };
  chart('monthlyChart', 'bar', { labels, datasets }, options);
}

function monthlyRangeDatasets(months, department) {
  return [
    {
      ...dataset('Mínimo histórico', months.map(month => monthlyHistoricalStats(department, month).min), '#2e7d5b', false, 'mm'),
      tooltipScope: department,
      type: 'line',
      backgroundColor: 'transparent',
      borderDash: [5, 4],
      borderWidth: 3,
      pointRadius: 3,
      pointHoverRadius: 5,
      spanGaps: true,
      order: 1
    },
    {
      ...dataset('Máximo histórico', months.map(month => monthlyHistoricalStats(department, month).max), '#c34f59', false, 'mm'),
      tooltipScope: department,
      type: 'line',
      backgroundColor: 'transparent',
      borderDash: [5, 4],
      borderWidth: 3,
      pointRadius: 3,
      pointHoverRadius: 5,
      spanGaps: true,
      order: 1
    }
  ];
}

function monthlyHistoricalStats(department, month) {
  const values = monthlyRows()
    .filter(row => (department === null || row.department === department) && Number.isFinite(row.months[month]))
    .map(row => row.months[month]);
  return {
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
    average: values.length ? average(values) : null
  };
}

function renderRanking(rows, f) {
  const months = selectedMonths(f);
  const grouped = {};
  rows.forEach(row => {
    const value = recordValue(row, months);
    if (Number.isFinite(value)) (grouped[row.department] ??= []).push(value);
  });
  const entries = Object.entries(grouped).map(([department, values]) => {
    const historicalRows = monthlyRows().filter(row => row.department === department);
    return {
      department,
      selected: averageFinite(values),
      historical: averageFinite(historicalRows.map(row => recordValue(row, months)))
    };
  })
    .sort((a,b) => b.selected - a.selected)
    .slice(0, 15);
  chart('rankingChart', 'bar', {
    labels: entries.map(entry => entry.department),
    datasets: [
      dataset('Período seleccionado', entries.map(entry => entry.selected), COLORS[0], false, 'mm'),
      dataset('Promedio histórico', entries.map(entry => entry.historical), '#7b8790', false, 'mm')
    ]
  }, barOptions('mm', true, true, 'Precipitación comparable (mm)'));
}
function renderHeatmap(rows, f) {
  const months = selectedMonths(f);
  const departments = [...new Set(rows.map(row => row.department))].sort();
  const matrix = departments.map(department => months.map(month =>
    averageFinite(rows.filter(row => row.department === department).map(row => row.months[month]))
  ));
  const finiteValues = matrix.flat().filter(Number.isFinite);
  const max = Math.max(1, ...finiteValues);
  let html = '<div class="heatmap-grid"><div></div>' + months.map(month => `<div class="heat-cell heat-head">${MONTHS[month]}</div>`).join('');
  departments.forEach((department, rowIndex) => {
    html += `<div class="heat-label">${department}</div>` + months.map((month, monthIndex) => {
      const value = matrix[rowIndex][monthIndex];
      const alpha = Number.isFinite(value) ? .08 + .85 * (value / max) : 0;
      const displayValue = Number.isFinite(value) ? format(value) : 'Sin dato';
      const titleValue = Number.isFinite(value) ? `${format(value)} mm` : 'Sin dato';
      return `<div class="heat-cell" title="${department} - ${MONTHS_FULL[month]}: ${titleValue}" style="background:rgba(34,211,238,${alpha})">${displayValue}</div>`;
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

function getLatestMonthlyPeriodForDepartment(department, f) {
  const years = state.temporalFiltersExplicit.years ? f.years : null;
  const months = state.temporalFiltersExplicit.months ? selectedMonths(f) : ALL_MONTHS;
  return monthlyRows()
    .filter(row => row.department === department && matchesSelection(row.year, years))
    .reduce((latest, row) => {
    row.months.forEach((value, month) => {
      if (!months.includes(month)) return;
      if (!Number.isFinite(value)) return;
      if (!latest || row.year > latest.year || (row.year === latest.year && month > latest.month)) {
        latest = { year: row.year, month, observedMm: value };
      }
    });
    return latest;
  }, null);
}

function getMonthlyHistoricalAverage(department, month) {
  const values = monthlyRows()
    .filter(row => row.department === department && Number.isFinite(row.months[month]))
    .map(row => row.months[month]);
  return values.length ? average(values) : null;
}

function classifyMonthlyDeviation(differencePct) {
  if (!Number.isFinite(differencePct)) return 'Sin referencia';
  if (differencePct <= -30) return 'Muy por debajo';
  if (differencePct <= -10) return 'Por debajo';
  if (differencePct < 10) return 'Normal';
  if (differencePct < 30) return 'Por encima';
  return 'Muy por encima';
}

function getDepartmentMonthlyDeviationRows(f) {
  const departments = state.metadata.departments.filter(department => matchesSelection(department, f.departments));
  return departments.map(department => {
    const latest = getLatestMonthlyPeriodForDepartment(department, f);
    const observedMm = latest ? latest.observedMm : null;
    const historicalAverageMm = latest ? getMonthlyHistoricalAverage(department, latest.month) : null;
    const differenceMm = Number.isFinite(observedMm) && Number.isFinite(historicalAverageMm) ? observedMm - historicalAverageMm : null;
    const differencePct = Number.isFinite(differenceMm) && historicalAverageMm > 0 ? (differenceMm / historicalAverageMm) * 100 : null;
    return {
      department,
      latestYear: latest ? latest.year : null,
      latestMonth: latest ? latest.month : null,
      observedMm,
      historicalAverageMm,
      differenceMm,
      differencePct,
      category: classifyMonthlyDeviation(differencePct)
    };
  }).sort((a, b) => {
    const absA = Number.isFinite(a.differencePct) ? Math.abs(a.differencePct) : -1;
    const absB = Number.isFinite(b.differencePct) ? Math.abs(b.differencePct) : -1;
    return absB - absA || a.department.localeCompare(b.department, 'es');
  });
}

function renderDepartmentDetail(rows, f) {
  state.tableRows = rows;
  $('detailsTable').innerHTML = rows.map(row => {
    const period = Number.isInteger(row.latestMonth) && Number.isFinite(row.latestYear) ? `${MONTHS_FULL[row.latestMonth]} ${row.latestYear}` : 'Sin dato';
    return `<tr><td>${row.department}</td><td>${period}</td><td>${formatNullable(row.observedMm)}</td><td>${formatNullable(row.historicalAverageMm)}</td><td>${formatSignedMm(row.differenceMm)}</td><td>${formatSignedPercent(row.differencePct)}</td><td><span class="${deviationClass(row.category)}">${row.category}</span></td></tr>`;
  }).join('');
}

function deviationClass(category) {
  const classes = {
    'Muy por debajo': 'deviation-very-low',
    'Por debajo': 'deviation-low',
    'Normal': 'deviation-normal',
    'Por encima': 'deviation-high',
    'Muy por encima': 'deviation-very-high',
    'Sin referencia': 'deviation-none'
  };
  return classes[category] || 'deviation-none';
}

function signedPercent(value) {
  return `${value > 0 ? '+' : ''}${format(value)}%`;
}

function formatNullable(value) {
  return Number.isFinite(value) ? `${format(value)} mm` : 'Sin dato';
}

function formatSignedMm(value) {
  return Number.isFinite(value) ? `${value > 0 ? '+' : ''}${format(value)} mm` : 'No calculable';
}

function formatSignedPercent(value) {
  return Number.isFinite(value) ? signedPercent(value) : 'No calculable';
}

function formatProgress(value) {
  return Number.isFinite(value) ? `${format(value)}%` : 'No calculable';
}

function signedMm(value) {
  if (!Number.isFinite(value)) return '\u2014';
  return `${value > 0 ? '+' : ''}${format(value)}`;
}

function downloadTable() {
  const headers = ['Departamento','Ultimo_anio','Ultimo_mes','Acumulado_mensual_observado_mm','Promedio_historico_mensual_mm','Diferencia_mm','Diferencia_pct','Categoria'];
  const csvValue = value => Number.isFinite(value) ? value.toFixed(2) : '';
  const lines = state.tableRows.map(row => [
    row.department,
    Number.isFinite(row.latestYear) ? row.latestYear : '',
    Number.isInteger(row.latestMonth) ? MONTHS_FULL[row.latestMonth] : '',
    csvValue(row.observedMm),
    csvValue(row.historicalAverageMm),
    csvValue(row.differenceMm),
    csvValue(row.differencePct),
    row.category
  ].join(';'));
  const blob = new Blob(['\ufeff' + [headers.join(';'), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'desvios_departamentales_mensuales.csv';
  link.click();
  URL.revokeObjectURL(link.href);
}

function groupTotals(rows, key, months) {
  return rows.reduce((output, row) => {
    const group = key(row);
    const value = recordValue(row, months);
    if (Number.isFinite(value)) output[group] = (output[group] || 0) + value;
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
  const label = context.dataset.tooltipScope ? `${context.dataset.tooltipScope} - ${context.dataset.label}` : context.dataset.label;
  if (!Number.isFinite(context.raw)) return `${label}: Sin dato`;
  const sourceInfo = context.dataset.sourceInfo?.[context.dataIndex];
  return `${label}: ${format(context.raw)}${unit ? ` ${unit}` : ''}${sourceInfo ? ` (${sourceInfo})` : ''}`;
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
