const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const MONTHS_FULL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const COLORS = ['#1677a6','#25a9b5','#7667a8','#d9931a','#c34f59','#3d9a6b','#7b8790','#b46a9b'];
const ALL_MONTHS = MONTHS.map((_, index) => index);
const DAILY_WINDOWS = [1, 7, 15, 30];
const DAILY_REFERENCE_WINDOWS = [7, 15, 30];
const DAILY_TIME_ZONE = 'America/Argentina/Buenos_Aires';
const MINIMUM_COMPARABLE_YEARS = 3;
const CACHE_VERSION = '20260812-5';
const CLIMATE_MAP_NEUTRAL = '#d7dedd';
const CLIMATE_MAP_VARIABLES = Object.freeze({
  rainLastDateMm: { label: 'Lluvia del día de referencia', unit: 'mm', scale: 'rain' },
  rain7dMm: { label: 'Acumulado 7 días', unit: 'mm', scale: 'rain' },
  rain15dMm: { label: 'Acumulado 15 días', unit: 'mm', scale: 'rain' },
  rain30dMm: { label: 'Acumulado 30 días', unit: 'mm', scale: 'rain' },
  monthlyDifferencePct: { label: 'Desvío mensual vs histórico', unit: '%', scale: 'difference' },
  monthlyCategory: { label: 'Categoría mensual descriptiva', unit: '', scale: 'category' }
});
const state = { rainfall: [], monthlyRainfall: [], monthlySourceStats: {}, operationalDailyRecords: [], dailyRecords: [], dailyDataSource: 'operational', dailyGeneratedAt: null, dailyDateMax: null, stations: [], metadata: {}, charts: {}, tableRows: [], filterConfigs: {}, temporalFiltersExplicit: { years: false, months: false }, climateMetrics: new Set(['temperature','humidity','wind','rain24Total']), climateMap: { map: null, geoLayer: null, resizeObserver: null, layoutInvalidateTimer: null, refreshTimer: null, statuses: new Map(), selectedDepartment: null, mode: 'departments', variable: 'rain7dMm', externalConfig: {}, pointCache: null, provinceGeojson: null, satelliteStatus: null, pointLayers: new Map(), pointCounts: new Map(), pointData: new Map(), pointRequests: new Set(), wmsLayers: new Map(), activeHydrologyLayer: 'none', preferredHydrologyLayer: 'none', satelliteOpacity: 0.65, satelliteOpacities: new Map(), satelliteTimeline: { enabled: false, scenes: [] }, geoglowsForecasts: new Map(), inaHistory: { cache: new Map(), requests: new Map(), selectionToken: 0, chart: null }, refreshingPrimaryHeights: false, refreshingSatelliteStatus: false, primaryProxyUnavailable: false, satelliteProxyUnavailable: false, hydrologyLiveStarted: false, detailAction: null } };
const sourceAudit = { catalog: new Map(), health: new Map(), selectedId: null };
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
    const [rainfall, operationalDailyRecords, combinedDailyResult, dailySummary, stations, metadata] = await Promise.all([
      fetchDataFile('rainfall.json'),
      fetchDataFile('rainfall-daily.json'),
      fetchDataFile('rainfall-daily-combined.json')
        .then(records => ({ records, source: 'combined' }))
        .catch(error => {
          console.warn(`${error.message}. Se usara rainfall-daily.json como respaldo.`);
          return null;
        }),
      fetchDataFile('rainfall-daily-summary.json').catch(error => {
        console.warn(`${error.message}. La actualización del dataset diario no estará disponible.`);
        return null;
      }),
      fetchDataFile('stations.json'),
      fetchDataFile('metadata.json')
    ]);
    const dailyRecords = combinedDailyResult?.records || operationalDailyRecords;
    Object.assign(state, {
      rainfall,
      operationalDailyRecords,
      dailyRecords,
      dailyDataSource: combinedDailyResult?.source || 'operational',
      dailyGeneratedAt: typeof dailySummary?.generatedAt === 'string' ? dailySummary.generatedAt : null,
      dailyDateMax: typeof dailySummary?.dateMax === 'string' ? dailySummary.dateMax : null,
      stations,
      metadata
    });
    state.monthlySourceStats = buildCombinedMonthlyRainfall();
    await initializeSourceAudit();
    await initializeClimateMap();
    populateFilters();
    syncClimateMapWithGlobalFilter(filters());
    wireControls();
    setupStickyFilters();
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

function fetchDataFile(name) {
  return fetch(`data/${name}?v=${CACHE_VERSION}`, { cache: 'no-store' }).then(response => {
    if (!response.ok) throw new Error(`No se pudo cargar ${name}`);
    return response.json();
  });
}

function setupStickyFilters() {
  const sectionNav = document.querySelector('.section-nav');
  const globalFilters = document.querySelector('.global-filters-sticky');
  if (!sectionNav || !globalFilters) return;
  const updateOffset = () => {
    document.documentElement.style.setProperty('--section-nav-height', `${sectionNav.offsetHeight}px`);
    document.documentElement.style.setProperty('--global-filters-height', `${globalFilters.offsetHeight}px`);
  };
  updateOffset();
  window.addEventListener('resize', updateOffset, { passive: true });
  if ('ResizeObserver' in window) {
    const stickyObserver = new ResizeObserver(updateOffset);
    stickyObserver.observe(sectionNav);
    stickyObserver.observe(globalFilters);
  }
}

function populateFilters() {
  const years = [...new Set(monthlyRows().map(row => row.year))].sort((a,b) => b - a);
  const maxMonthlyYear = latestCombinedMonthlyYear();
  createMultiFilter('departmentFilter', state.metadata.departments.map(value => ({ value, label: value })), {
    allLabel: 'Todos los departamentos',
    defaultValues: ['ALL']
  });
  createMultiFilter('yearFilter', years.map(value => ({ value: String(value), label: String(value) })), {
    allLabel: 'Todos los a\u00f1os',
    defaultValues: years.includes(maxMonthlyYear) ? [String(maxMonthlyYear)] : ['ALL']
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
  fillSelect('monthlyBaseYear', years);
  fillSelect('monthlyCompareYear', years);
  $('monthlyBaseYear').value = years.includes(1998) ? '1998' : String(years[years.length - 1]);
  $('monthlyCompareYear').value = years.includes(2026) ? '2026' : String(maxMonthlyYear);
}

function monthlyRows() {
  return state.monthlyRainfall.length ? state.monthlyRainfall : state.rainfall;
}

function latestCombinedMonthlyYear() {
  const years = monthlyRows().map(row => row.year).filter(Number.isFinite);
  return years.length ? Math.max(...years) : state.metadata.yearMax;
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

  // La metodologia mensual validada sigue usando exclusivamente la base
  // operativa. El historico Excel se incorpora solo al analisis diario.
  const derived = deriveMonthlyFromDailyRecords(state.operationalDailyRecords);
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
      const currentFilters = filters();
      render();
      if (id === 'departmentFilter') syncClimateMapWithGlobalFilter(currentFilters);
    });
  });
  ['annualFromFilter','annualToFilter'].forEach(id => $(id).addEventListener('change', () => {
    let from = +$('annualFromFilter').value;
    let to = +$('annualToFilter').value;
    if (from > to) [$('annualFromFilter').value, $('annualToFilter').value] = [String(to), String(from)];
    renderAnnual(filters());
  }));
  ['monthlyViewMode','monthlyBaseYear','monthlyCompareYear'].forEach(id => $(id).addEventListener('change', () => {
    if (id !== 'monthlyViewMode') normalizeMonthlyComparisonYears(id);
    renderMonthly(filteredRainfall(filters()), filters());
  }));
  $('dailyWindowFilter').addEventListener('change', () => renderDaily(filters()));
  $('dailySortFilter').addEventListener('change', () => renderDaily(filters()));
  $('dailyMatrixSortFilter').addEventListener('change', () => renderDaily(filters()));
  $('departmentDetailSortFilter').addEventListener('change', () => renderDepartmentDetail(getDepartmentMonthlyDeviationRows(filters()), filters()));
  $('resetFilters').addEventListener('click', () => {
    const latestAvailableYear = latestCombinedMonthlyYear();
    setMultiSelection('departmentFilter', ['ALL']);
    setMultiSelection('yearFilter', [String(latestAvailableYear)]);
    setMultiSelection('monthFilter', ['ALL']);
    setMultiSelection('stationFilter', [state.stations[0].station]);
    state.temporalFiltersExplicit.years = false;
    state.temporalFiltersExplicit.months = false;
    $('annualFromFilter').value = state.metadata.yearMin;
    $('annualToFilter').value = state.metadata.yearMax;
    $('monthlyViewMode').value = 'comparison';
    $('monthlyBaseYear').value = monthlyRows().some(row => row.year === 1998) ? '1998' : String(state.metadata.yearMin);
    $('monthlyCompareYear').value = monthlyRows().some(row => row.year === 2026) ? '2026' : String(latestAvailableYear);
    render();
    syncClimateMapWithGlobalFilter(filters());
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
  updateClimateDailyStatuses(f);
  updateKpis(f);
  renderAnnual(f);
  renderMonthly(rows, f);
  renderRanking(rows, f);
    renderHeatmap(rows, f);
  renderDaily(f);
  renderClimate(f);
  refreshClimateDepartmentMap();
  renderDepartmentDetail(getDepartmentMonthlyDeviationRows(f), f);
}

function updateKpis(f) {
  const today = new Date();
  const summary = monthlySummaryComparison(f, today);
  const presentation = summaryExecutivePresentation(summary, f, today);
  $('kpiReferenceMonth').textContent = presentation.periodValue;
  $('kpiReferenceDetail').textContent = presentation.periodDetail;
  $('kpiObservedLabel').textContent = presentation.observedTitle;
  $('kpiObserved').textContent = formatSummaryRainfall(summary.observedMm);
  $('kpiObservedDetail').textContent = presentation.observedDetail;
  $('kpiHistoricalLabel').textContent = presentation.historicalTitle;
  $('kpiHistorical').textContent = formatSummaryRainfall(summary.historicalAverageMm);
  $('kpiHistoricalDetail').textContent = presentation.historicalDetail;
  $('kpiDifference').textContent = presentation.monthComparisonValue;
  $('kpiDifferenceDetail').textContent = presentation.monthComparisonDetail;
  $('kpiAnnualAverageLabel').textContent = presentation.annualTitle;
  $('kpiAnnualAverage').textContent = formatSummaryRainfall(summary.annualAverageMm);
  $('kpiAnnualAverageDetail').textContent = presentation.annualDetail;
  $('kpiAnnualComparison').textContent = presentation.annualComparisonValue;
  $('kpiAnnualComparisonDetail').textContent = presentation.annualComparisonDetail;
  $('kpiExecutiveReadingTitle').textContent = presentation.readingTitle;
  $('kpiExecutiveReading').textContent = presentation.reading;
}

function summaryExecutivePresentation(summary, f, today = new Date()) {
  const current = dailyCalendarParts(today);
  const monthName = MONTHS_FULL[summary.period.month];
  const monthNameLower = monthName.toLowerCase();
  const isCurrentPartial = summary.period.year === current.year && summary.period.month === current.month;
  const department = summary.singleDepartment ? f.departments?.[0] || '' : '';
  const shortPeriod = isCurrentPartial ? `1–${current.day} de ${monthNameLower}` : monthNameLower;
  const periodValue = isCurrentPartial ? `${shortPeriod} de ${summary.period.year}` : `${monthName} ${summary.period.year}`;
  const annualDifferenceMm = Number.isFinite(summary.annualAverageMm) && Number.isFinite(summary.comparableHistoricalMm)
    ? summary.annualAverageMm - summary.comparableHistoricalMm
    : null;
  const annualDifferencePct = Number.isFinite(annualDifferenceMm) && summary.comparableHistoricalMm > 0
    ? annualDifferenceMm / summary.comparableHistoricalMm * 100
    : null;
  const monthComparison = executiveComparison(summary.observedMm, summary.historicalAverageMm, summary.differenceMm, summary.differencePct, 'promedio histórico');
  const annualComparison = executiveComparison(summary.annualAverageMm, summary.comparableHistoricalMm, annualDifferenceMm, annualDifferencePct, 'promedio histórico para el mismo período');
  const periodLead = isCurrentPartial ? `Entre el 1 y el ${current.day} de ${monthNameLower}` : `En ${monthNameLower} de ${summary.period.year}`;

  return {
    periodValue,
    periodDetail: isCurrentPartial ? 'Período parcial' : 'Mes completo',
    observedTitle: department ? `Lluvia acumulada en ${department}` : 'Lluvia acumulada promedio por departamento',
    observedDetail: isCurrentPartial
      ? `${department ? 'Entre' : 'Acumulada entre'} el 1 y el ${current.day} de ${monthNameLower}`
      : `${department ? 'Durante' : 'Acumulada durante'} ${monthNameLower}`,
    historicalTitle: department ? `Lluvia habitual en ${department}` : 'Lluvia habitual por departamento',
    historicalDetail: isCurrentPartial ? `Para el mismo período: ${shortPeriod}` : `Para ${monthNameLower} completo`,
    monthComparisonValue: monthComparison.value,
    monthComparisonDetail: monthComparison.detail,
    annualTitle: department
      ? `Lluvia acumulada en ${department} en ${summary.selectedYear}`
      : `Lluvia acumulada promedio por departamento en ${summary.selectedYear}`,
    annualDetail: summary.selectedYear === current.year
      ? `Acumulada desde enero hasta el ${current.day} de ${MONTHS_FULL[current.month].toLowerCase()}`
      : `Acumulada durante los meses disponibles de ${summary.selectedYear}`,
    annualComparisonValue: annualComparison.value,
    annualComparisonDetail: annualComparison.detail,
    readingTitle: department ? `Lectura de ${department}` : 'Lectura provincial',
    reading: executiveSummaryReading({
      periodLead,
      department,
      selectedYear: summary.selectedYear,
      observedMm: summary.observedMm,
      monthDifferencePct: summary.differencePct,
      annualAverageMm: summary.annualAverageMm,
      annualDifferencePct
    })
  };
}

function executiveComparison(observed, historical, differenceMm, differencePct, referenceLabel) {
  if (!Number.isFinite(observed)) return { value: 'Sin dato disponible', detail: 'No hay un valor calculable para el período' };
  if (!Number.isFinite(historical) || !Number.isFinite(differencePct)) {
    return { value: 'Sin referencia histórica', detail: 'No hay referencia histórica suficiente para comparar' };
  }
  if (Math.abs(differencePct) < 0.05) {
    return { value: '0 %', detail: `En línea con el ${referenceLabel}` };
  }
  const direction = differencePct > 0 ? 'por encima' : 'por debajo';
  return {
    value: `${differencePct > 0 ? '+' : '−'}${format(Math.abs(differencePct))} %`,
    detail: `${format(Math.abs(differenceMm))} mm ${direction} del ${referenceLabel}`
  };
}

function executiveSummaryReading({ periodLead, department, selectedYear, observedMm, monthDifferencePct, annualAverageMm, annualDifferencePct }) {
  if (!Number.isFinite(observedMm) && !Number.isFinite(annualAverageMm)) return 'No hay datos disponibles para construir una lectura ejecutiva.';
  const monthHasReference = Number.isFinite(monthDifferencePct);
  const annualHasReference = Number.isFinite(annualDifferencePct);
  if (!monthHasReference && !annualHasReference) return 'No hay referencia histórica suficiente para realizar la comparación.';

  const sentences = [];
  if (!Number.isFinite(observedMm)) {
    sentences.push(`${periodLead}, no hay datos disponibles para el período.`);
  } else if (!monthHasReference) {
    sentences.push(`${periodLead}, no hay referencia histórica suficiente para comparar las precipitaciones.`);
  } else {
    const monthDirection = Math.abs(monthDifferencePct) < 0.05 ? 'en línea con' : monthDifferencePct > 0 ? `${format(Math.abs(monthDifferencePct))} % por encima de` : `${format(Math.abs(monthDifferencePct))} % por debajo de`;
    const subject = department ? `${department} registra precipitaciones` : 'las precipitaciones se ubican';
    sentences.push(`${periodLead}, ${subject} ${monthDirection} lo habitual.`);
  }

  if (!Number.isFinite(annualAverageMm)) {
    sentences.push(`No hay datos disponibles para resumir ${selectedYear}.`);
  } else if (!annualHasReference) {
    sentences.push(`En lo que va de ${selectedYear}, no hay referencia histórica suficiente para realizar la comparación anual.`);
  } else {
    const annualDirection = Math.abs(annualDifferencePct) < 0.05 ? 'en línea con' : annualDifferencePct > 0 ? `${format(Math.abs(annualDifferencePct))} % por encima de` : `${format(Math.abs(annualDifferencePct))} % por debajo de`;
    const annualSubject = department ? `la lluvia acumulada de ${department}` : 'la lluvia promedio por departamento';
    sentences.push(`En lo que va de ${selectedYear}, ${annualSubject} se mantiene ${annualDirection} su referencia histórica.`);
  }
  return sentences.join(' ');
}

function monthlySummaryComparison(f, today = new Date()) {
  const departments = state.metadata.departments.filter(department => matchesSelection(department, f.departments));
  const period = getSummaryReferencePeriod(departments, f, today);
  const current = dailyCalendarParts(today);
  const isCurrentMonth = period.year === current.year && period.month === current.month;
  const monthlyObservation = isCurrentMonth
    ? summaryCurrentMonthFromDaily(departments, period.year, period.month, current.isoDate)
    : summaryProvincialMonth(departments, period.year, period.month);
  const observedEntries = monthlyObservation.valid ? monthlyObservation.entries : [];
  const historicalDepartments = observedEntries.length ? observedEntries.map(entry => entry.department) : departments;
  const historicalValues = historicalDepartments
    .map(department => isCurrentMonth
      ? getCurrentMonthHistoricalAverage(department, current.isoDate)
      : getMonthlyHistoricalAverage(department, period.month))
    .filter(Number.isFinite);
  const observedMm = monthlyObservation.valid ? monthlyObservation.value : null;
  const historicalAverageMm = historicalValues.length ? average(historicalValues) : null;
  const differenceMm = Number.isFinite(observedMm) && Number.isFinite(historicalAverageMm) ? observedMm - historicalAverageMm : null;
  const differencePct = Number.isFinite(differenceMm) && historicalAverageMm > 0 ? differenceMm / historicalAverageMm * 100 : null;
  const annual = summaryAnnualComparison(departments, period.year, today);
  const partialDate = monthlyObservation.valid ? summaryPartialMonthDate(observedEntries, period) : null;
  const observedScope = departments.length === 1
    ? 'observado del departamento seleccionado'
    : `promedio departamental observado (${observedEntries.length} depto.)`;
  return {
    period,
    selectedYear: period.year,
    observedMm,
    historicalAverageMm,
    differenceMm,
    differencePct,
    category: classifyMonthlyDeviation(differencePct),
    observedCount: observedEntries.length,
    historicalCount: historicalValues.length,
    singleDepartment: departments.length === 1,
    observedDetail: isCurrentMonth
      ? `Acumulado parcial al ${formatSummaryDate(current.isoDate)} · ${observedScope} · cobertura real ${monthlyObservation.observedDays}/${monthlyObservation.possibleDays} días-departamento`
      : (partialDate ? `Acumulado parcial al ${formatSummaryDate(partialDate)} · ${observedScope}` : observedScope),
    ...annual
  };
}

function getSummaryReferencePeriod(departments, f, today = new Date()) {
  const current = dailyCalendarParts(today);
  const availableYears = [...new Set(monthlyRows().map(row => row.year).filter(Number.isFinite))];
  const selectedYear = f.years?.length
    ? Math.max(...f.years)
    : (availableYears.includes(current.year) ? current.year : Math.max(...availableYears));
  if (f.months?.length) {
    return { year: selectedYear, month: Math.max(...f.months), reason: 'según el mes seleccionado' };
  }
  if (selectedYear === current.year) {
    return { year: selectedYear, month: current.month, reason: 'mes calendario actual · período parcial hasta hoy' };
  }
  const latestValidMonth = [...ALL_MONTHS].reverse()
    .find(month => summaryProvincialMonth(departments, selectedYear, month).valid);
  return {
    year: selectedYear,
    month: latestValidMonth ?? 11,
    reason: latestValidMonth === undefined ? 'sin observaciones mensuales válidas en el año' : 'último mes válido del año seleccionado'
  };
}

function summaryProvincialMonth(departments, year, month) {
  const entries = departments
    .map(department => {
      const row = monthlyRows().find(item => item.department === department && item.year === year);
      return { department, row, value: row?.months?.[month] };
    })
    .filter(entry => Number.isFinite(entry.value));
  const minimumCoverage = Math.ceil(departments.length * 0.8);
  const valid = departments.length > 0 && entries.length >= minimumCoverage;
  return { entries, valid, value: valid ? average(entries.map(entry => entry.value)) : null, minimumCoverage };
}

function summaryAvailableProvincialMonth(departments, year, month) {
  const observation = summaryProvincialMonth(departments, year, month);
  return {
    ...observation,
    valid: observation.entries.length > 0,
    value: observation.entries.length ? average(observation.entries.map(entry => entry.value)) : null
  };
}

function summaryCurrentMonthFromDaily(departments, year, month, referenceDate) {
  const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const entries = departments.map(department => {
    const records = state.dailyRecords.filter(record =>
      record.department === department &&
      record.date >= monthStart &&
      record.date <= referenceDate &&
      Number.isFinite(record.rainfallMm)
    );
    return {
      department,
      row: null,
      value: records.reduce((sum, record) => sum + record.rainfallMm, 0),
      daysWithRecords: new Set(records.map(record => record.date)).size
    };
  });
  const daysElapsed = Number(referenceDate.slice(8, 10));
  return {
    entries,
    valid: departments.length > 0,
    value: departments.length ? average(entries.map(entry => entry.value)) : null,
    minimumCoverage: departments.length,
    observedDays: entries.reduce((sum, entry) => sum + entry.daysWithRecords, 0),
    possibleDays: daysElapsed * departments.length,
    operationalPartial: true
  };
}

function getCurrentMonthHistoricalAverage(department, referenceDate) {
  const daysElapsed = Number(referenceDate.slice(8, 10));
  return dailyHistoricalWindowReference(state.dailyRecords, department, referenceDate, daysElapsed).averageMm;
}

function summaryPartialMonthDate(entries, period) {
  const derivedEntries = entries.filter(entry => entry.row?.monthSources?.[period.month] === 'daily_derived');
  if (!derivedEntries.length) return null;
  const incomplete = derivedEntries.some(entry => {
    const meta = entry.row.dailyDerivedMeta?.[period.month];
    return meta && meta.daysWithRecords < meta.daysInMonth;
  });
  if (!incomplete) return null;
  const departments = new Set(derivedEntries.map(entry => entry.department));
  return state.operationalDailyRecords
    .filter(record => departments.has(record.department) && Number(record.date?.slice(0, 4)) === period.year && Number(record.date?.slice(5, 7)) === period.month + 1)
    .reduce((latest, record) => record.date > latest ? record.date : latest, '');
}

function summaryAnnualComparison(departments, selectedYear, today = new Date()) {
  const current = dailyCalendarParts(today);
  const observedMonths = ALL_MONTHS.map(month => ({
    month,
    observation: selectedYear === current.year && month === current.month
      ? summaryCurrentMonthFromDaily(departments, selectedYear, month, current.isoDate)
      : summaryAvailableProvincialMonth(departments, selectedYear, month)
  }))
    .filter(item => item.observation.valid);
  const includedMonths = observedMonths.map(item => item.month);
  const coverageCounts = observedMonths.map(item => item.observation.entries.length);
  const annualAverageMm = observedMonths.length ? average(observedMonths.map(item => item.observation.value)) : null;
  const historicalYears = [...new Set(monthlyRows().map(row => row.year))]
    .filter(year => year !== selectedYear)
    .sort((a, b) => a - b);
  const comparableYears = includedMonths.length ? historicalYears.map(year => {
    const observations = includedMonths.map(month => summaryAvailableProvincialMonth(departments, year, month));
    return observations.every(observation => observation.valid)
      ? { year, value: average(observations.map(observation => observation.value)) }
      : null;
  }).filter(Boolean) : [];
  const comparableHistoricalMm = comparableYears.length ? average(comparableYears.map(item => item.value)) : null;
  const periodLabel = formatSummaryMonthSet(includedMonths);
  const partialDates = observedMonths
    .map(item => summaryPartialMonthDate(item.observation.entries, { year: selectedYear, month: item.month }))
    .filter(Boolean)
    .sort();
  const includesCurrentPartial = selectedYear === current.year && includedMonths.includes(current.month);
  const partialSuffix = includesCurrentPartial
    ? ` · incluye parcial al ${formatSummaryDate(current.isoDate)}`
    : (partialDates.length ? ` · incluye parcial al ${formatSummaryDate(partialDates[partialDates.length - 1])}` : '');
  const minimumDepartmentCoverage = coverageCounts.length ? Math.min(...coverageCounts) : 0;
  const maximumDepartmentCoverage = coverageCounts.length ? Math.max(...coverageCounts) : 0;
  const coverageSuffix = coverageCounts.length
    ? ` · cobertura ${minimumDepartmentCoverage === maximumDepartmentCoverage ? minimumDepartmentCoverage : `${minimumDepartmentCoverage}–${maximumDepartmentCoverage}`} de ${departments.length} deptos.`
    : '';
  return {
    annualAverageMm,
    comparableHistoricalMm,
    annualMonths: includedMonths,
    comparableYears: comparableYears.map(item => item.year),
    annualDetail: includedMonths.length ? `${periodLabel} · ${includedMonths.length} ${includedMonths.length === 1 ? 'mes' : 'meses'} con datos${coverageSuffix}${partialSuffix}` : 'Sin meses con observaciones válidas',
    comparableHistoricalDetail: includedMonths.length
      ? `Promedio histórico para el mismo período · ${comparableYears.length} ${comparableYears.length === 1 ? 'año comparable' : 'años comparables'}`
      : 'Sin período observado comparable'
  };
}

function formatSummaryMonthSet(months) {
  if (!months.length) return 'Sin período';
  const sorted = [...months].sort((a, b) => a - b);
  const contiguous = sorted.every((month, index) => index === 0 || month === sorted[index - 1] + 1);
  if (contiguous && sorted.length > 1) return `${MONTHS_FULL[sorted[0]]}–${MONTHS_FULL[sorted[sorted.length - 1]].toLowerCase()}`;
  return sorted.map((month, index) => index === 0 ? MONTHS_FULL[month] : MONTHS_FULL[month].toLowerCase()).join(', ');
}

function formatSummaryDate(value) {
  if (!value) return '';
  const [year, month, day] = value.split('-');
  return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
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

function fetchClimateMapData(path, optional = false) {
  const separator = path.includes('?') ? '&' : '?';
  return fetch(`data/${path}${separator}v=${Date.now()}`, { cache: 'no-store' }).then(response => {
    if (optional && response.status === 404) return null;
    if (!response.ok) throw new Error(`No se pudo cargar data/${path}`);
    return response.json();
  }).catch(error => {
    if (optional) {
      console.info(`${error.message}. La capa opcional queda sin datos.`);
      return null;
    }
    throw error;
  });
}

function finiteApiNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(String(value).replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function isCorrientesCoordinate(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -32 && lat <= -25 && lng >= -61 && lng <= -54;
}

function normalizeExternalRainRecords(records) {
  if (!Array.isArray(records)) return [];
  const publicDecimals = Math.max(0, Math.min(6, Number(state.climateMap.externalConfig?.privacy?.rainCoordinateDecimals) || 4));
  const publicCoordinate = value => Number.isFinite(value) ? Number(value.toFixed(publicDecimals)) : value;
  return records.filter(record => {
    const status = normalizeSourceKey(record.status || record.estado);
    const action = normalizeSourceKey(record.action || record.accion);
    return !['deleted', 'eliminado'].includes(status) && !['delete', 'eliminar'].includes(action);
  }).map(record => {
    const date = String(record.date || record.fecha || '').slice(0, 10);
    const department = normalizeClimateDepartment(record.department || record.departamento);
    const municipality = String(record.municipality || record.localidad || record.municipio || department || '').trim();
    const rainfallMm = finiteApiNumber(record.rainfallMm ?? record.rain ?? record.lluvia ?? record.precipitacion);
    const lat = finiteApiNumber(record.lat ?? record.latitude ?? record.latitud);
    const lng = finiteApiNumber(record.lng ?? record.lon ?? record.longitude ?? record.longitud);
    return {
      date,
      department,
      municipality,
      rainfallMm,
      lat: publicCoordinate(lat),
      lng: publicCoordinate(lng),
      updatedAt: String(record.updatedAt || record.updated_at || '')
    };
  }).filter(record =>
    /^\d{4}-\d{2}-\d{2}$/.test(record.date) &&
    record.department &&
    Number.isFinite(record.rainfallMm) &&
    record.rainfallMm >= 0 &&
    record.rainfallMm <= 1000 &&
    isCorrientesCoordinate(record.lat, record.lng)
  );
}

function latestRainPoints(records) {
  const byLocation = new Map();
  records.forEach(record => {
    const locationKey = [
      record.department,
      record.municipality || record.department,
      record.lat.toFixed(4),
      record.lng.toFixed(4)
    ].join('|');
    const current = byLocation.get(locationKey);
    if (!current || record.date > current.date || (record.date === current.date && record.updatedAt > current.updatedAt)) {
      byLocation.set(locationKey, record);
    }
  });
  return [...byLocation.values()].sort((a, b) =>
    a.department.localeCompare(b.department, 'es') || a.municipality.localeCompare(b.municipality, 'es')
  );
}

async function fetchWithTimeout(url, timeoutMs, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function parseGeoglowsForecastCsv(text) {
  const lines = String(text || '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].replace(/^\uFEFF/, '').split(',').map(value => value.trim());
  const index = name => headers.indexOf(name);
  const dateIndex = index('datetime');
  const medianIndex = index('flow_median');
  const upperIndex = index('flow_uncertainty_upper');
  const lowerIndex = index('flow_uncertainty_lower');
  if (dateIndex < 0 || medianIndex < 0) return [];
  return lines.slice(1).map(line => {
    const values = line.split(',');
    return {
      datetime: values[dateIndex],
      median: finiteApiNumber(values[medianIndex]),
      upper: upperIndex >= 0 ? finiteApiNumber(values[upperIndex]) : null,
      lower: lowerIndex >= 0 ? finiteApiNumber(values[lowerIndex]) : null
    };
  }).filter(row => row.datetime && Number.isFinite(row.median) && !Number.isNaN(new Date(row.datetime).getTime()));
}

function updateClimateApiCard(prefix, cardState, stateLabel, summary, meta) {
  const card = $(`${prefix}Card`);
  if (card) card.dataset.state = cardState;
  const stateElement = $(`${prefix}State`);
  if (stateElement && stateLabel) stateElement.textContent = stateLabel;
  const summaryElement = $(`${prefix}Summary`);
  if (summaryElement && summary !== undefined) summaryElement.textContent = compactOperationalText(prefix, summary);
  const metaElement = $(`${prefix}Meta`);
  if (metaElement && meta !== undefined) metaElement.textContent = compactUpdateText(meta);
}

function compactOperationalText(prefix, value) {
  const count = String(value || '').match(/^\s*(\d+)/)?.[1];
  const labels = { rainApi: 'registros', inaApi: 'estaciones', snihApi: 'estaciones', saltoApi: 'estaciones', satelliteApi: 'coberturas', nasaApi: 'coberturas', geoglowsApi: 'puntos con pronóstico' };
  return count ? `${count} ${labels[prefix] || 'registros disponibles'}` : 'Actualizando cobertura';
}

function compactUpdateText(value) {
  const text = String(value || '');
  const labelled = text.match(/(?:Últim[^·.]*|Escena más reciente:[^·.]*)/i)?.[0];
  const date = text.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}(?:,?\s+\d{1,2}:\d{2})?/u)?.[0];
  return labelled || (date ? `Última actualización: ${date}` : 'Última actualización: no informada');
}

function formatApiFlow(value) {
  return Number.isFinite(value)
    ? `${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(value)} m³/s`
    : 'Sin dato';
}

function formatApiDateTime(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? String(value || 'Sin dato')
    : parsed.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeClimateDepartment(value) {
  const key = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const aliases = {
    'gral alvear': 'General Alvear',
    'gral paz': 'General Paz',
    'monte casero': 'Monte Caseros',
    'paso de los libres': 'Paso de los Libres',
    'p de los libres': 'Paso de los Libres'
  };
  if (aliases[key]) return aliases[key];
  return state.metadata.departments?.find(department => department
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase() === key) || String(value || '').trim();
}

function formatClimateMm(value) {
  return Number.isFinite(value) ? `${format(value)} mm` : 'Sin dato';
}

function formatClimateUpdatedAt(value) {
  if (!value) return 'Sin dato';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('es-AR');
}

function formatDailyDatasetUpdatedAt(value) {
  const timestamp = String(value || '').trim();
  if (!timestamp) return 'Actualización no disponible';
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(timestamp)
    ? `${timestamp}Z`
    : timestamp;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return 'Actualización no disponible';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: DAILY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(parsed).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${parts.day}/${parts.month}/${parts.year} · ${parts.hour}:${parts.minute}`;
}
// Implementación puntual del mapa. Las declaraciones siguientes reemplazan la
// vista coroplética anterior sin modificar los análisis departamentales del resto
// del tablero.
const CLIMATE_CATEGORY_COLORS = Object.freeze({ precipitation: '#1677b8', hydrometry: '#13806f', satellite: '#d66b3d', models: '#7656a8' });
const CLIMATE_POINT_SOURCES = Object.freeze({
  ina: { label: 'Altura del río · INA', category: 'hydrometry', color: CLIMATE_CATEGORY_COLORS.hydrometry, countId: 'climateInaCount', pane: 'inaPointPane' },
  snih: { label: 'Altura del río · SNIH', category: 'hydrometry', color: CLIMATE_CATEGORY_COLORS.hydrometry, countId: 'climateSnihCount', pane: 'snihPointPane' },
  salto: { label: 'Altura del río · Salto Grande', category: 'hydrometry', color: CLIMATE_CATEGORY_COLORS.hydrometry, countId: 'climateSaltoCount', pane: 'saltoPointPane' },
  rain: { label: 'Lluvias registradas', category: 'precipitation', color: CLIMATE_CATEGORY_COLORS.precipitation, countId: 'climateRainCount', pane: 'rainPointPane' },
  nasa: { label: 'Precipitación NASA', category: 'models', color: CLIMATE_CATEGORY_COLORS.models, countId: 'climateNasaCount', pane: 'nasaPointPane' },
  geoglows: { label: 'Pronóstico de caudal', category: 'models', color: CLIMATE_CATEGORY_COLORS.models, countId: 'climateGeoglowsCount', pane: 'geoglowsPointPane' }
});
const PRIMARY_HEIGHT_SOURCE_DETAILS = Object.freeze({
  ina: {
    label: 'INA SIyAH',
    cardPrefix: 'inaApi',
    validation: 'publicada por INA',
    intro: 'Lectura numérica de altura hidrométrica publicada por el INA.'
  },
  snih: {
    label: 'Sistema Nacional de Información Hídrica',
    cardPrefix: 'snihApi',
    validation: 'telemétrica preliminar',
    intro: 'Lectura telemétrica actual publicada por el Sistema Nacional de Información Hídrica.'
  },
  salto: {
    label: 'Comisión Técnica Mixta de Salto Grande',
    cardPrefix: 'saltoApi',
    validation: 'operativa telemétrica',
    intro: 'Lectura operativa publicada por la red telemétrica de Salto Grande.'
  }
});

async function initializeClimateMap() {
  const container = $('climateMap');
  if (!container) return;
  const initialViewParams = new URLSearchParams(location.search);
  try {
    if (typeof L === 'undefined') throw new Error('Leaflet no se encuentra disponible');
    const [statuses, geojson, externalConfig] = await Promise.all([
      fetchClimateMapData('department-climate-status.json'),
      fetchClimateMapData('geo/corrientes-departamentos.geojson'),
      fetchClimateMapData('external-api-config.json', true)
    ]);
    if (!Array.isArray(statuses) || !statuses.length) throw new Error('El archivo departamental no contiene registros');
    if (!geojson || !Array.isArray(geojson.features) || !geojson.features.length) throw new Error('El GeoJSON no contiene departamentos');

    const safeExternalConfig = externalConfig && !Array.isArray(externalConfig) ? externalConfig : {};
    const cacheFile = safeExternalConfig.pointCacheFile || 'map-point-sources.json';
    const pointCache = await fetchClimateMapData(cacheFile, true);
    state.climateMap.statuses = new Map(statuses.map(status => [normalizeClimateDepartment(status.department), status]));
    state.climateMap.externalConfig = safeExternalConfig;
    state.climateMap.pointCache = pointCache && !Array.isArray(pointCache) ? pointCache : {};
    state.climateMap.satelliteStatus = state.climateMap.pointCache.satelliteFlood || null;
    state.climateMap.provinceGeojson = geojson;
    state.climateMap.mode = 'departments';
    state.climateMap.variable = $('climateMapVariable')?.value || 'rain7dMm';
    state.climateMap.preferredHydrologyLayer = safeExternalConfig.defaultRasterLayer || 'none';
    state.climateMap.pointLayers = new Map();
    state.climateMap.pointCounts = new Map();
    state.climateMap.pointData = new Map();
    state.climateMap.pointRequests = new Set();

    state.climateMap.map = L.map(container, {
      zoomControl: true,
      minZoom: 6,
      maxZoom: 14,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      scrollWheelZoom: false
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      opacity: 0.64,
      crossOrigin: 'anonymous',
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(state.climateMap.map);
    createClimatePointPanes();
    state.climateMap.geoLayer = L.geoJSON(geojson, {
      style: climateDepartmentStyle,
      onEachFeature: wireClimateMapFeature
    }).addTo(state.climateMap.map);
    Object.keys(CLIMATE_POINT_SOURCES).forEach(source => {
      state.climateMap.pointLayers.set(source, L.layerGroup());
      state.climateMap.pointCounts.set(source, 0);
      state.climateMap.pointData.set(source, []);
    });
    fitClimateMapToCorrientes();
    wireClimatePointControls();
    initializePointRasterLayers();
    renderCachedClimatePoints();
    applyClimateMapMode('departments', { initial: true });
    const urlApplied = applyClimateViewFromUrl(initialViewParams);
    const initialDepartment = urlApplied?.department || (state.climateMap.statuses.has('Capital') ? 'Capital' : geojson.features[0]?.properties?.department);
    if (initialDepartment && (state.climateMap.mode === 'departments' || urlApplied?.department)) selectClimateDepartment(initialDepartment);

    requestAnimationFrame(() => {
      state.climateMap.map.invalidateSize({ pan: false, animate: false });
      fitClimateMapToCorrientes();
    });
    if ('ResizeObserver' in window) {
      state.climateMap.resizeObserver = new ResizeObserver(() => scheduleClimateMapInvalidate(100));
      state.climateMap.resizeObserver.observe(container);
    }

  } catch (error) {
    showClimateMapMessage('No fue posible cargar la información territorial. El resto del dashboard continúa disponible.', 0);
    if ($('climateMapReference')) $('climateMapReference').textContent = 'Información territorial no disponible';
    console.error(error);
  }
}

async function initializeSourceAudit() {
  const [catalog, health] = await Promise.all([fetchClimateMapData('source-catalog.json'), fetchClimateMapData('source-health.json', true)]);
  sourceAudit.catalog = new Map((catalog || []).map(item => [item.id, item]));
  sourceAudit.health = new Map((health || []).map(item => [item.id, item]));
  renderSourceHealthPanel();
  $('sourceInfoButton')?.addEventListener('click', () => showSourceInformation(sourceAudit.selectedId || 'rain'));
  $('sourceInfoClose')?.addEventListener('click', () => { $('sourceInfoPanel').hidden = true; });
}

function renderSourceHealthPanel() {
  const body = $('sourceHealthBody');
  if (!body) return;
  body.innerHTML = [...sourceAudit.catalog.values()].map(source => {
    const health = sourceAudit.health.get(source.id);
    const technical = health?.status || (source.status === 'Pendiente' ? 'PENDIENTE' : 'SIN DATO');
    return `<tr><td><button class="source-table-link" data-source-info="${escapeHtml(source.id)}">${escapeHtml(source.name)}</button></td><td><span class="source-chip source-chip-${escapeHtml(technical.toLowerCase().replace(/\s+/g,'-'))}">${escapeHtml(technical)}</span></td><td>${escapeHtml(source.confidenceLevel)}</td><td>${escapeHtml(health?.lastValidation || source.lastValidation || 'Sin validar')}</td><td>${source.supportsGithubPages ? 'Sí' : 'No'}</td><td>${source.requiresBackend ? 'Sí' : 'No'}</td></tr>`;
  }).join('');
  body.querySelectorAll('[data-source-info]').forEach(button => button.addEventListener('click', () => showSourceInformation(button.dataset.sourceInfo)));
}

function showSourceInformation(sourceId) {
  const source = sourceAudit.catalog.get(sourceId);
  if (!source || !$('sourceInfoPanel')) return;
  const health = sourceAudit.health.get(sourceId);
  $('sourceInfoTitle').textContent = source.name;
  $('sourceInfoContent').innerHTML = `<div class="source-info-grid"><div><strong>Proveedor</strong><span>${escapeHtml(source.provider)}</span></div><div><strong>Grupo</strong><span>${escapeHtml(source.group)}</span></div><div><strong>Naturaleza</strong><span>${escapeHtml(source.nature)}</span></div><div><strong>Estado</strong><span class="source-chip">${escapeHtml(source.status)}</span></div><div><strong>Confianza metodológica</strong><span>${escapeHtml(source.confidenceLevel)}</span></div><div><strong>Disponibilidad</strong><span>${escapeHtml(health?.availability || 'Sin monitoreo')}</span></div><div><strong>Cobertura</strong><span>${escapeHtml(source.coverage)}</span></div><div><strong>Resolución espacial</strong><span>${escapeHtml(source.resolutionSpatial)}</span></div><div><strong>Resolución temporal</strong><span>${escapeHtml(source.resolutionTemporal)}</span></div><div><strong>Frecuencia</strong><span>${escapeHtml(source.updateFrequency)}</span></div><div><strong>Última validación</strong><span>${escapeHtml(health?.lastValidation || source.lastValidation || 'Sin validar')}</span></div><div><strong>GitHub Pages / backend</strong><span>${source.supportsGithubPages ? 'Compatible' : 'No compatible'} · ${source.requiresBackend ? 'requiere backend' : 'sin backend obligatorio'}</span></div></div><h4>Limitaciones</h4><ul>${source.limitations.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul><h4>Metodología</h4><p>${escapeHtml(source.methodology)}</p>${source.documentationUrl ? `<a href="${escapeHtml(source.documentationUrl)}" target="_blank" rel="noopener noreferrer">Documentación oficial</a>` : '<p>Documentación pendiente.</p>'}`;
  $('sourceInfoPanel').hidden = false;
}

function createClimatePointPanes() {
  const panes = [
    ['climateRasterPane', 350],
    ['nasaPointPane', 410],
    ['geoglowsPointPane', 430],
    ['rainPointPane', 450],
    ['inaPointPane', 470],
    ['snihPointPane', 480],
    ['saltoPointPane', 490]
  ];
  panes.forEach(([name, zIndex]) => {
    if (state.climateMap.map.getPane(name)) return;
    const pane = state.climateMap.map.createPane(name);
    pane.style.zIndex = String(zIndex);
  });
}

function wireClimatePointControls() {
  $('climateMapMode')?.addEventListener('change', event => { applyClimateMapMode(event.target.value); updateClimateViewUrl(); });
  $('climateMapVariable')?.addEventListener('change', event => {
    state.climateMap.variable = event.target.value;
    refreshClimateDepartmentMap();
    updateClimateViewUrl();
  });
  document.querySelectorAll('[data-point-source]').forEach(control => {
    control.addEventListener('change', () => {
      if (control.checked) sourceAudit.selectedId = control.dataset.pointSource;
      applyClimatePointSourceVisibility(control.dataset.pointSource);
      updateClimateViewUrl();
    });
  });
  $('climateSatelliteOpacity')?.addEventListener('input', event => setClimateSatelliteOpacity(Number(event.target.value) / 100));
  $('climateFullscreenButton')?.addEventListener('click', toggleClimateMapFullscreen);
  $('climateExportPngButton')?.addEventListener('click', exportClimateMapPng);
  document.addEventListener('fullscreenchange', () => scheduleClimateMapInvalidate());
}

function setClimateSatelliteOpacity(value, { layerId = state.climateMap.activeHydrologyLayer, updateUrl = true } = {}) {
  const entry = state.climateMap.wmsLayers.get(layerId);
  const fallback = Number(entry?.config?.opacity) || 0.65;
  state.climateMap.satelliteOpacity = Math.max(0.1, Math.min(1, Number(value) || fallback));
  if (entry) {
    state.climateMap.satelliteOpacities.set(layerId, state.climateMap.satelliteOpacity);
    entry.layer.setOpacity(state.climateMap.satelliteOpacity);
  }
  if ($('climateSatelliteOpacity')) $('climateSatelliteOpacity').value = String(Math.round(state.climateMap.satelliteOpacity * 100));
  if ($('climateSatelliteOpacityValue')) $('climateSatelliteOpacityValue').textContent = `${Math.round(state.climateMap.satelliteOpacity * 100)} %`;
  if (updateUrl) updateClimateViewUrl();
}

async function toggleClimateMapFullscreen() {
  const visual = document.querySelector('.climate-map-visual');
  if (!visual) return;
  visual.classList.toggle('is-map-fullscreen');
  document.body.classList.toggle('map-fullscreen-open', visual.classList.contains('is-map-fullscreen'));
  scheduleClimateMapInvalidate();
}

async function exportClimateMapPng() {
  const visual = document.querySelector('.climate-map-visual');
  const button = $('climateExportPngButton');
  if (!visual || typeof html2canvas !== 'function') return showClimateMapMessage('La exportación PNG no está disponible.', 4500);
  button.disabled = true;
  visual.classList.add('climate-map-exporting');
  try {
    const canvas = await html2canvas(visual, { useCORS: true, allowTaint: false, backgroundColor: '#eef4f2', scale: Math.min(2, window.devicePixelRatio || 1) });
    const link = document.createElement('a');
    link.download = `mapa-climatico-corrientes-${new Date().toISOString().slice(0, 10)}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (error) {
    console.warn(`No se pudo exportar el mapa: ${error.message}`);
    showClimateMapMessage('No fue posible exportar la vista. Alguna capa remota puede restringir la captura.', 5500);
  } finally {
    visual.classList.remove('climate-map-exporting');
    button.disabled = false;
  }
}

function updateClimateViewUrl() {
  if (!state.climateMap.map || !history.replaceState) return;
  const params = new URLSearchParams(location.search);
  params.set('mapMode', state.climateMap.mode);
  params.set('mapVariable', state.climateMap.variable);
  if (state.climateMap.selectedDepartment) params.set('mapDepartment', state.climateMap.selectedDepartment); else params.delete('mapDepartment');
  if (state.climateMap.activeHydrologyLayer !== 'none') params.set('mapSatellite', state.climateMap.activeHydrologyLayer); else params.delete('mapSatellite');
  params.set('mapOpacity', String(Math.round(state.climateMap.satelliteOpacity * 100)));
  history.replaceState(null, '', `${location.pathname}?${params}${location.hash}`);
}

function applyClimateViewFromUrl(params = new URLSearchParams(location.search)) {
  const mode = params.get('mapMode');
  const variable = params.get('mapVariable');
  const department = normalizeClimateDepartment(params.get('mapDepartment') || '');
  const satellite = params.get('mapSatellite');
  const opacity = Number(params.get('mapOpacity'));
  if (CLIMATE_MAP_VARIABLES[variable]) { state.climateMap.variable = variable; if ($('climateMapVariable')) $('climateMapVariable').value = variable; }
  if (mode === 'hydrology') applyClimateMapMode('hydrology');
  if (satellite && state.climateMap.wmsLayers.has(satellite)) selectClimateHydrologyLayer(satellite);
  if (Number.isFinite(opacity) && opacity >= 10 && opacity <= 100) setClimateSatelliteOpacity(opacity / 100);
  return { department: state.climateMap.statuses.has(department) ? department : null };
}

function applyClimateMapMode(mode, { initial = false } = {}) {
  const nextMode = mode === 'hydrology' ? 'hydrology' : 'departments';
  state.climateMap.mode = nextMode;
  if ($('climateMapMode')) $('climateMapMode').value = nextMode;
  const hydrology = nextMode === 'hydrology';
  if ($('climateDepartmentControls')) $('climateDepartmentControls').hidden = hydrology;
  if ($('climateHydrologyControls')) $('climateHydrologyControls').hidden = !hydrology;
  if ($('climateDepartmentDetail')) $('climateDepartmentDetail').hidden = hydrology;
  if ($('climatePointDetail')) $('climatePointDetail').hidden = !hydrology;
  if ($('climateApiGrid')) $('climateApiGrid').hidden = !hydrology;
  if ($('climateDepartmentMethod')) $('climateDepartmentMethod').hidden = hydrology;
  if ($('climateHydrologyMethod')) $('climateHydrologyMethod').hidden = !hydrology;
  if ($('climateModeExplanation')) {
    $('climateModeExplanation').textContent = hydrology
      ? 'Mediciones puntuales, productos modelados y referencias satelitales presentados por fuente.'
      : 'Indicadores territoriales agregados por departamento.';
  }

  if (hydrology) {
    state.climateMap.geoLayer?.setStyle(climatePointBoundaryStyle);
    state.climateMap.geoLayer?.eachLayer(layer => {
      const department = normalizeClimateDepartment(layer.feature?.properties?.department || layer.feature?.properties?.officialName);
      layer.setTooltipContent(climateMapTooltip(department));
    });
    Object.keys(CLIMATE_POINT_SOURCES).forEach(source => applyClimatePointSourceVisibility(source, false));
    selectClimateHydrologyLayer(state.climateMap.preferredHydrologyLayer || 'none');
    const selectedRaster = state.climateMap.wmsLayers.get(state.climateMap.activeHydrologyLayer);
    if (selectedRaster) renderSatelliteLayerDetail(selectedRaster.config); else renderDefaultHydrologyDetail();
    updateClimatePointSummary();
    activateHydrologyLiveRefresh();
  } else {
    state.climateMap.pointLayers.forEach(layer => {
      if (state.climateMap.map?.hasLayer(layer)) state.climateMap.map.removeLayer(layer);
    });
    state.climateMap.wmsLayers.forEach(({ layer }) => {
      if (state.climateMap.map?.hasLayer(layer)) state.climateMap.map.removeLayer(layer);
    });
    refreshClimateDepartmentMap();
    const selected = state.climateMap.selectedDepartment || (state.climateMap.statuses.has('Capital') ? 'Capital' : null);
    if (selected) selectClimateDepartment(selected);
    if ($('climatePointTotal')) $('climatePointTotal').textContent = `${state.climateMap.statuses.size} departamentos`;
  }
  if (!initial) scheduleClimateMapInvalidate();
}

function activateHydrologyLiveRefresh() {
  if (state.climateMap.hydrologyLiveStarted) return;
  state.climateMap.hydrologyLiveStarted = true;
  void Promise.allSettled([
    refreshPointRainSource(),
    refreshPrimaryRiverHeightSources(),
    refreshPointNasaSource(),
    refreshSatelliteFloodStatus()
  ]);
  startClimateMapRefresh();
}

function renderDefaultHydrologyDetail() {
  const defaultHeightPoint = ['ina', 'snih', 'salto']
    .flatMap(sourceId => (state.climateMap.pointData.get(sourceId) || []).map(observation => ({ sourceId, observation })))
    .sort((a, b) => String(b.observation.latestHeight?.date || b.observation.date || '').localeCompare(String(a.observation.latestHeight?.date || a.observation.date || '')))[0];
  if (defaultHeightPoint) renderPrimaryHeightDetail(defaultHeightPoint.sourceId, defaultHeightPoint.observation);
}

function renderCachedClimatePoints() {
  const cache = state.climateMap.pointCache || {};
  const rainPoints = normalizeExternalRainRecords(cache.rainObservations?.points || []);
  renderRainPointLayer(rainPoints, { source: 'cache', generatedAt: cache.generatedAt });
  renderInaPointLayer(cache.ina?.heightObservations || cache.ina?.stations || [], {
    source: 'cache',
    generatedAt: cache.generatedAt,
    inventory: cache.ina || {}
  });
  renderAuthorityHeightLayer('snih', cache.snih?.observations || [], {
    source: 'cache',
    generatedAt: cache.generatedAt,
    metadata: cache.snih?.metadata || {}
  });
  renderAuthorityHeightLayer('salto', cache.salto?.observations || [], {
    source: 'cache',
    generatedAt: cache.generatedAt,
    metadata: cache.salto?.metadata || {}
  });
  renderNasaPointLayer(cache.nasaPower || {}, { source: 'cache', generatedAt: cache.generatedAt });
  renderGeoglowsPointLayer(cache.geoglows?.nodes || [], { source: 'cache', generatedAt: cache.generatedAt });
}

function replaceClimatePointLayer(source, records, markerFactory) {
  const layer = state.climateMap.pointLayers.get(source);
  if (!layer) return;
  layer.clearLayers();
  records.forEach(record => {
    const marker = markerFactory(record);
    if (marker) layer.addLayer(marker);
  });
  state.climateMap.pointData.set(source, records);
  state.climateMap.pointCounts.set(source, records.length);
  applyClimatePointSourceVisibility(source, false);
  updateClimatePointSummary();
}

function applyClimatePointSourceVisibility(source, updateSummary = true) {
  const layer = state.climateMap.pointLayers.get(source);
  if (!layer || !state.climateMap.map) return;
  const control = document.querySelector(`[data-point-source="${source}"]`);
  const visible = state.climateMap.mode === 'hydrology' && (control ? control.checked && !control.disabled : true);
  if (visible && !state.climateMap.map.hasLayer(layer)) layer.addTo(state.climateMap.map);
  if (!visible && state.climateMap.map.hasLayer(layer)) state.climateMap.map.removeLayer(layer);
  if (updateSummary) updateClimatePointSummary();
}

function updateClimatePointSummary() {
  if (state.climateMap.mode !== 'hydrology') return;
  let visibleTotal = 0;
  const visibleSources = [];
  Object.entries(CLIMATE_POINT_SOURCES).forEach(([source, config]) => {
    const count = state.climateMap.pointCounts.get(source) || 0;
    if ($(config.countId)) $(config.countId).textContent = new Intl.NumberFormat('es-AR').format(count);
    const control = document.querySelector(`[data-point-source="${source}"]`);
    if (control?.checked && !control.disabled) {
      visibleTotal += count;
      visibleSources.push(source);
    }
  });
  if ($('climatePointTotal')) {
    const primaryHeightSources = new Set(['ina', 'snih', 'salto']);
    const noun = visibleSources.length && visibleSources.every(source => primaryHeightSources.has(source)) ? 'alturas visibles' : 'puntos visibles';
    $('climatePointTotal').textContent = `${new Intl.NumberFormat('es-AR').format(visibleTotal)} ${noun}`;
  }
  renderClimatePointLegend();
  updateClimatePointReference();
}

function renderClimatePointLegend() {
  const legend = $('climateMapLegend');
  if (!legend || state.climateMap.mode !== 'hydrology') return;
  const activeCategories = new Map();
  Object.entries(CLIMATE_POINT_SOURCES).filter(([source]) => {
    const control = document.querySelector(`[data-point-source="${source}"]`);
    return control?.checked && !control.disabled;
  }).forEach(([source, config]) => {
    const count = state.climateMap.pointCounts.get(source) || 0;
    activeCategories.set(config.category, (activeCategories.get(config.category) || 0) + count);
  });
  const raster = state.climateMap.wmsLayers.get(state.climateMap.activeHydrologyLayer)?.config;
  if (raster) activeCategories.set('satellite', null);
  const categoryLabels = { precipitation: 'Precipitaciones', hydrometry: 'Hidrometría', satellite: 'Observación satelital', models: 'Modelos y pronósticos' };
  const rows = [...activeCategories.entries()].map(([category, count]) => `<span class="climate-legend-row"><i class="climate-legend-swatch climate-point-swatch" style="--legend-color:${CLIMATE_CATEGORY_COLORS[category]}"></i>${categoryLabels[category]}${Number.isFinite(count) ? ` <strong>${count}</strong>` : ''}</span>`).join('');
  legend.innerHTML = `<strong>Tipo de información</strong>${rows || '<span class="climate-legend-row">Sin datos activos</span>'}`;
}

function scheduleClimateMapInvalidate(delayMs = 80) {
  clearTimeout(state.climateMap.layoutInvalidateTimer);
  state.climateMap.layoutInvalidateTimer = setTimeout(() => {
    state.climateMap.layoutInvalidateTimer = null;
    requestAnimationFrame(() => state.climateMap.map?.invalidateSize({ pan: false, animate: false }));
  }, Math.max(0, delayMs));
}

function updateClimatePointReference() {
  const rain = state.climateMap.pointData.get('rain') || [];
  const nasa = state.climateMap.pointData.get('nasa') || [];
  const rainDate = rain.reduce((latest, point) => point.date > latest ? point.date : latest, '');
  const nasaDate = nasa.reduce((latest, point) => point.date > latest ? point.date : latest, '');
  const visibleSources = Object.keys(CLIMATE_POINT_SOURCES).filter(source => {
    const control = document.querySelector(`[data-point-source="${source}"]`);
    return control?.checked && !control.disabled;
  });
  const heightSources = ['ina', 'snih', 'salto'];
  const heightCount = heightSources
    .filter(source => visibleSources.includes(source))
    .reduce((sum, source) => sum + (state.climateMap.pointCounts.get(source) || 0), 0);
  const onlyHeights = visibleSources.length && visibleSources.every(source => heightSources.includes(source));
  let text = onlyHeights
    ? `${heightCount} estaciones con altura publicada por fuentes primarias`
    : `${visibleSources.length} fuentes puntuales visibles`;
  if (visibleSources.includes('rain') && rainDate) text += ` · lluvia ${formatDate(rainDate)}`;
  if (visibleSources.includes('nasa') && nasaDate) text += ` · NASA ${formatDate(nasaDate)}`;
  const raster = state.climateMap.wmsLayers.get(state.climateMap.activeHydrologyLayer)?.config;
  if (raster) text += ` · inundación satelital${raster.resolvedTime ? ` ${formatDate(raster.resolvedTime)}` : ''}`;
  if ($('climateHydrologyReference')) $('climateHydrologyReference').textContent = text;
}

function rainMarkerOptions(point) {
  return {
    pane: CLIMATE_POINT_SOURCES.rain.pane,
    radius: Math.min(10, 5 + Math.sqrt(Math.max(0, point.rainfallMm)) / 2.4),
    color: '#064e58',
    weight: 1.6,
    fillColor: CLIMATE_POINT_SOURCES.rain.color,
    fillOpacity: 0.88,
    className: 'climate-point-marker source-rain-marker'
  };
}

function renderRainPointLayer(records, sourceInfo = {}) {
  const availability = sourceInfo.source === 'live' ? 'Consulta externa actualizada' : 'Respaldo local';
  const points = latestRainPoints(normalizeExternalRainRecords(records)).map(point => ({ ...point, dataAvailability: availability }));
  replaceClimatePointLayer('rain', points, point => {
    const marker = L.circleMarker([point.lat, point.lng], rainMarkerOptions(point));
    marker.bindTooltip(`${point.municipality || point.department}: ${formatClimateMm(point.rainfallMm)} · ${formatDate(point.date)}`, { direction: 'top' });
    marker.bindPopup(`<strong>Precipitaciones</strong><span class="climate-api-popup-label">Registro observado</span>${escapeHtml(point.municipality || point.department)} · ${escapeHtml(formatClimateMm(point.rainfallMm))}<span class="climate-api-popup-label">Fecha</span>${escapeHtml(formatDate(point.date))}<span class="climate-api-popup-label">Fuente</span>Registro Provincial`);
    marker.on('click', () => renderRainPointDetail(point));
    return marker;
  });
  const latestDate = points.reduce((latest, point) => point.date > latest ? point.date : latest, '');
  const isLive = sourceInfo.source === 'live';
  updateClimateApiCard(
    'rainApi',
    isLive ? 'live' : 'cache',
    isLive ? 'En vivo' : 'Respaldo local',
    `${points.length} ubicaciones puntuales con coordenadas; no se reducen a un punto por departamento.`,
    `${latestDate ? `Último registro del conjunto: ${formatDate(latestDate)}` : 'Sin fecha válida'}${sourceInfo.generatedAt ? ` · consulta ${formatClimateUpdatedAt(sourceInfo.generatedAt)}` : ''}${sourceInfo.reason ? ` · API en vivo: ${sourceInfo.reason}` : ''}`
  );
}

function renderRainPointDetail(point) {
  renderMapPointDetail({
    presentationType: 'rain',
    department: point.department,
    title: point.municipality || point.department,
    intro: 'Ubicación declarada en el registro operativo de precipitaciones.',
    source: 'Apps Script · registro de lluvias',
    nature: 'Observado propio',
    availability: point.dataAvailability,
    type: 'Observación puntual',
    value: formatClimateMm(point.rainfallMm),
    date: formatDate(point.date),
    location: `${point.department} · ${formatCoordinate(point.lat)}, ${formatCoordinate(point.lng)}`,
    id: `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`,
    status: point.date === latestDateForSource('rain') ? 'Fecha más reciente del conjunto' : 'Registro histórico por ubicación',
    context: 'El tamaño del punto aumenta con los milímetros informados. Un valor de 0 mm es válido. La coordenada pública se limita a cuatro decimales.',
    updated: point.updatedAt ? formatClimateUpdatedAt(point.updatedAt) : 'Respuesta del registro operativo'
  });
}

async function refreshPointRainSource() {
  const config = state.climateMap.externalConfig?.rainObservations;
  if (!config?.url || state.climateMap.pointRequests.has('rain')) return;
  state.climateMap.pointRequests.add('rain');
  updateClimateApiCard('rainApi', 'loading', 'Consultando', 'El respaldo permanece visible mientras responde Apps Script.');
  try {
    let response = await fetchWithTimeout(config.proxyUrl || config.url, Number(config.timeoutMs) || 120000, { cache: 'no-store' });
    if (!response.ok && config.proxyUrl && response.status === 404) {
      response = await fetchWithTimeout(config.url, Number(config.timeoutMs) || 120000, { cache: 'no-store' });
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (payload?.ok === false) throw new Error(payload.error || 'La API informó un error');
    const records = Array.isArray(payload) ? payload : (payload.records || payload.data || []);
    const points = normalizeExternalRainRecords(records);
    if (!points.length) throw new Error('La API no devolvió observaciones con coordenadas válidas');
    renderRainPointLayer(points, {
      source: payload?.degraded || payload?.source === 'snapshot' ? 'cache' : 'live',
      generatedAt: payload.generatedAt,
      reason: payload.upstreamError
    });
  } catch (error) {
    updateClimateApiCard('rainApi', 'cache', 'Respaldo local', undefined, `La consulta en vivo falló: ${error.name === 'AbortError' ? 'tiempo agotado' : error.message}`);
    console.warn(`No se pudo actualizar Apps Script: ${error.message}`);
  }
}

function normalizeInaHeightFeatures(payload) {
  return (payload?.features || []).map(feature => {
    const properties = feature.properties || {};
    const coordinates = feature.geometry?.coordinates || [];
    return {
      name: String(properties.nombre || ''),
      lat: finiteApiNumber(coordinates[1]),
      lng: finiteApiNumber(coordinates[0]),
      date: properties.fecha || '',
      valueM: finiteApiNumber(properties.valor),
      previousValueM: finiteApiNumber(properties.valor_precedente),
      trend: String(properties.tendencia || ''),
      status: String(properties.estado || ''),
      condition: String(properties.condicion || ''),
      seriesId: properties.series_id,
      river: String(properties.rio || ''),
      alertLevelM: finiteApiNumber(properties.nivel_de_alerta),
      evacuationLevelM: finiteApiNumber(properties.nivel_de_evacuacion),
      lowWaterLevelM: finiteApiNumber(properties.nivel_de_aguas_bajas),
      timeseries: parseInaTimeseries(properties.timeseries)
    };
  }).filter(height => isCorrientesCoordinate(height.lat, height.lng));
}

function parseInaTimeseries(value) {
  if (!value) return [];
  try {
    const rows = typeof value === 'string' ? JSON.parse(value) : value;
    return (Array.isArray(rows) ? rows : [])
      .map(row => [String(row?.[0] || ''), finiteApiNumber(row?.[1])])
      .filter(row => row[0] && Number.isFinite(row[1]) && !Number.isNaN(new Date(row[0]).getTime()))
      .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime());
  } catch {
    return [];
  }
}

function matchInaHeight(station, heights) {
  const name = normalizeSourceKey(station.name);
  const named = heights.filter(height => normalizeSourceKey(height.name) === name);
  const candidates = named.length ? named : heights.filter(height => Math.abs(height.lat - station.lat) <= 0.004 && Math.abs(height.lng - station.lng) <= 0.004);
  return candidates.sort((a, b) => pointDistanceSquared(station, a) - pointDistanceSquared(station, b))[0] || null;
}

function normalizeInaStations(payload, heightsPayload) {
  const rows = Array.isArray(payload) ? payload : (payload?.data || []);
  const heights = normalizeInaHeightFeatures(heightsPayload);
  const cachedBySite = new Map((state.climateMap.pointCache?.ina?.stations || []).map(station => [Number(station.siteCode), station]));
  return rows.map(row => {
    const lat = finiteApiNumber(row.lat);
    const lng = finiteApiNumber(row.lon ?? row.lng);
    const siteCode = Number(row.sitecode ?? row.siteCode);
    const station = {
      siteCode,
      name: String(row.nombre || row.name || `Estación ${siteCode}`),
      type: String(row.tipo_nombre || row.type || row.tipo || 'Sin tipo'),
      typeCode: String(row.tipo || row.typeCode || ''),
      network: String(row.nombre_red || row.network || 'Sin red'),
      owner: String(row.propietario || row.owner || ''),
      river: String(row.rio || row.river || ''),
      lat,
      lng,
      automatic: Boolean(row.automatica ?? row.automatic),
      alertLevelM: finiteApiNumber(row.nivel_de_alerta ?? row.alertLevelM),
      evacuationLevelM: finiteApiNumber(row.nivel_de_evacuacion ?? row.evacuationLevelM),
      lowWaterLevelM: finiteApiNumber(row.nivel_de_aguas_bajas ?? row.lowWaterLevelM)
    };
    const liveHeight = station.typeCode === 'H' ? matchInaHeight(station, heights) : null;
    if (row.latestHeight) station.latestHeight = row.latestHeight;
    else if (liveHeight) station.latestHeight = liveHeight;
    else if (cachedBySite.get(siteCode)?.latestHeight) station.latestHeight = cachedBySite.get(siteCode).latestHeight;
    return station;
  }).filter(station => Number.isInteger(station.siteCode) && isCorrientesCoordinate(station.lat, station.lng))
    .sort((a, b) => a.typeCode.localeCompare(b.typeCode) || a.name.localeCompare(b.name, 'es'));
}

function inaHeightObservationKey(height) {
  if (height?.seriesId !== null && height?.seriesId !== undefined && height?.seriesId !== '') return `series:${height.seriesId}`;
  return [normalizeSourceKey(height?.name), Number(height?.lat).toFixed(5), Number(height?.lng).toFixed(5)].join('|');
}

function inaHeightStation(height, station = null) {
  const latestHeight = { ...height };
  return {
    siteCode: station?.siteCode ?? null,
    name: String(height?.name || station?.name || 'Estación hidrométrica'),
    type: 'Estación hidrométrica con lectura',
    typeCode: 'H',
    network: station?.network || 'WFS de últimas alturas',
    owner: station?.owner || 'INA SIyAH',
    river: String(height?.river || station?.river || ''),
    lat: finiteApiNumber(height?.lat ?? station?.lat),
    lng: finiteApiNumber(height?.lng ?? station?.lng),
    automatic: Boolean(station?.automatic),
    alertLevelM: finiteApiNumber(height?.alertLevelM ?? station?.alertLevelM),
    evacuationLevelM: finiteApiNumber(height?.evacuationLevelM ?? station?.evacuationLevelM),
    lowWaterLevelM: finiteApiNumber(height?.lowWaterLevelM ?? station?.lowWaterLevelM),
    latestHeight
  };
}

function selectInaHeightObservations(stations, heightsPayload) {
  const provinceFeatures = state.climateMap.provinceGeojson?.features || [];
  const observations = new Map();
  const addHeight = (height, station = null) => {
    if (!Number.isFinite(height?.valueM) || !isCorrientesCoordinate(height?.lat, height?.lng)) return;
    observations.set(inaHeightObservationKey(height), inaHeightStation(height, station));
  };
  normalizeInaHeightFeatures(heightsPayload).forEach(height => {
    if (provinceFeatures.some(feature => climateGeometryContains(feature.geometry, height.lng, height.lat))) addHeight(height);
  });
  (stations || []).forEach(station => {
    if (station.typeCode === 'H' && Number.isFinite(station.latestHeight?.valueM)) addHeight(station.latestHeight, station);
  });
  return [...observations.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

function normalizePrimaryHeightRecords(records, sourceId, inventory = []) {
  const stationBySeries = new Map((inventory || []).filter(station => station.latestHeight?.seriesId !== null && station.latestHeight?.seriesId !== undefined)
    .map(station => [String(station.latestHeight.seriesId), station]));
  return (records || []).map(record => {
    const height = record.latestHeight || record;
    const matchedStation = record.latestHeight ? record : stationBySeries.get(String(height.seriesId));
    const station = matchedStation || record;
    return {
      ...inaHeightStation(height, station),
      sourceId: String(record.sourceId || sourceId),
      sourceLabel: String(record.sourceLabel || PRIMARY_HEIGHT_SOURCE_DETAILS[sourceId]?.label || sourceId),
      sourceUrl: String(record.sourceUrl || ''),
      validation: String(record.validation || PRIMARY_HEIGHT_SOURCE_DETAILS[sourceId]?.validation || ''),
      stationId: String(record.stationId ?? station.siteCode ?? height.seriesId ?? ''),
      department: String(record.department || station.department || ''),
      transmission: String(record.transmission || station.transmission || ''),
      zeroScaleM: finiteApiNumber(record.zeroScaleM ?? station.zeroScaleM),
      elevationSystem: record.elevationSystem ?? station.elevationSystem ?? null,
      variables: Array.isArray(record.variables) ? record.variables : [],
      lastTransmissionAt: String(record.lastTransmissionAt || ''),
      latestHeight: {
        ...height,
        valueM: finiteApiNumber(height.valueM),
        previousValueM: finiteApiNumber(height.previousValueM),
        alertLevelM: finiteApiNumber(height.alertLevelM ?? station.alertLevelM),
        evacuationLevelM: finiteApiNumber(height.evacuationLevelM ?? station.evacuationLevelM),
        lowWaterLevelM: finiteApiNumber(height.lowWaterLevelM ?? station.lowWaterLevelM),
        date: String(height.date || ''),
        timeseries: Array.isArray(height.timeseries) ? height.timeseries : []
      }
    };
  }).filter(station =>
    Number.isFinite(station.latestHeight?.valueM) &&
    station.latestHeight.valueM > -100 &&
    !Number.isNaN(new Date(station.latestHeight?.date).getTime()) &&
    new Date(station.latestHeight.date).getUTCFullYear() >= 2000 &&
    isCorrientesCoordinate(station.lat, station.lng)
  ).sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

function normalizeInaHeightRecords(records, inventory = []) {
  return normalizePrimaryHeightRecords(records, 'ina', inventory);
}

function validInaThreshold(value) {
  return Number.isFinite(value) && value > 0;
}

function inaHeightState(station) {
  const value = station.latestHeight?.valueM;
  const evacuation = station.latestHeight?.evacuationLevelM ?? station.evacuationLevelM;
  const alert = station.latestHeight?.alertLevelM ?? station.alertLevelM;
  const low = station.latestHeight?.lowWaterLevelM ?? station.lowWaterLevelM;
  const publishedStatus = normalizeSourceKey(station.latestHeight?.status);
  if (publishedStatus.includes('evac') || (validInaThreshold(evacuation) && value >= evacuation)) {
    return { key: 'external-upper-2', label: 'Supera referencia hidrométrica externa 2', color: '#7667a8', stroke: '#493d70' };
  }
  if (publishedStatus.includes('alert') || (validInaThreshold(alert) && value >= alert)) {
    return { key: 'external-upper-1', label: 'Supera referencia hidrométrica externa 1', color: '#d9931a', stroke: '#865907' };
  }
  if (validInaThreshold(low) && value <= low) {
    return { key: 'external-low', label: 'Referencia hidrométrica externa inferior', color: '#657b9b', stroke: '#3f5068' };
  }
  return { key: 'reference', label: publishedStatus === 'normal' ? 'Dentro de referencias publicadas' : 'Sin referencia hidrométrica publicada', color: '#0b6f8d', stroke: '#06465a' };
}

function inaHeightIsOlder(station, hours = 72) {
  const measuredAt = new Date(station.latestHeight?.date).getTime();
  return Number.isFinite(measuredAt) && Date.now() - measuredAt > hours * 60 * 60 * 1000;
}

function renderInaPointLayer(stations, sourceInfo = {}) {
  const inventoryStations = Array.isArray(sourceInfo.inventory?.stations)
    ? sourceInfo.inventory.stations
    : (Array.isArray(sourceInfo.inventory) ? sourceInfo.inventory : []);
  const availability = sourceInfo.source === 'live' ? 'Consulta externa actualizada' : 'Respaldo local';
  const normalized = normalizeInaHeightRecords(stations, inventoryStations).map(station => ({ ...station, dataAvailability: availability }));
  replaceClimatePointLayer('ina', normalized, station => {
    const heightState = inaHeightState(station);
    const older = inaHeightIsOlder(station);
    const value = station.latestHeight.valueM;
    const seriesClass = String(station.latestHeight.seriesId ?? '').replace(/[^a-zA-Z0-9_-]/g, '');
    const marker = L.circleMarker([station.lat, station.lng], {
      pane: CLIMATE_POINT_SOURCES.ina.pane,
      radius: 6.5,
      color: '#07584a',
      weight: 2.2,
      fillColor: CLIMATE_CATEGORY_COLORS.hydrometry,
      fillOpacity: older ? 0.72 : 0.96,
      dashArray: older ? '4 3' : undefined,
      className: `climate-point-marker source-ina-marker${seriesClass ? ` ina-series-${seriesClass}` : ''} river-height-${heightState.key}${older ? ' river-height-older' : ''}`
    });
    marker.bindTooltip(`${format(value)} m`, {
      permanent: true,
      direction: 'top',
      offset: [0, -6],
      opacity: 0.96,
      className: `river-height-label river-height-label-${heightState.key}${older ? ' is-older' : ''}`
    });
    marker.on('click', () => renderPrimaryHeightDetail('ina', station));
    return marker;
  });
  const inventoryHydro = finiteApiNumber(sourceInfo.inventory?.hydrologicalCount ?? sourceInfo.metadata?.inventoryCount);
  const inventoryMeteo = finiteApiNumber(sourceInfo.inventory?.meteorologicalCount);
  const hydro = Number.isFinite(inventoryHydro) ? inventoryHydro : inventoryStations.filter(station => station.typeCode === 'H').length;
  const meteo = Number.isFinite(inventoryMeteo) ? inventoryMeteo : inventoryStations.filter(station => station.typeCode === 'M').length;
  const older = normalized.filter(station => inaHeightIsOlder(station)).length;
  const isLive = sourceInfo.source === 'live';
  const inventorySummary = [
    hydro ? `${hydro} hidrológicas candidatas` : null,
    meteo ? `${meteo} meteorológicas en el inventario general` : null
  ].filter(Boolean).join(' y ');
  updateClimateApiCard(
    'inaApi',
    isLive ? 'live' : 'cache',
    isLive ? 'En vivo' : 'Respaldo local',
    `${normalized.length} estaciones con altura numérica publicada; son los únicos puntos INA dibujados.`,
    `${inventorySummary || 'Inventario oficial consultado'}; las que no tienen altura se omiten.${older ? ` ${older} lectura(s) superan 72 h.` : ''}${sourceInfo.generatedAt ? ` · consulta ${formatClimateUpdatedAt(sourceInfo.generatedAt)}` : ''}${sourceInfo.reason ? ` · actualización: ${sourceInfo.reason}` : ''}`
  );
}

function renderPrimaryHeightDetail(sourceId, station) {
  const definition = PRIMARY_HEIGHT_SOURCE_DETAILS[sourceId] || PRIMARY_HEIGHT_SOURCE_DETAILS.ina;
  const height = station.latestHeight;
  const value = height?.valueM;
  const heightState = sourceId === 'ina' ? inaHeightState(station) : null;
  const thresholds = sourceId === 'ina' ? [
      validInaThreshold(height?.alertLevelM ?? station.alertLevelM) ? `referencia externa 1: ${format(height?.alertLevelM ?? station.alertLevelM)} m` : null,
      validInaThreshold(height?.evacuationLevelM ?? station.evacuationLevelM) ? `referencia externa 2: ${format(height?.evacuationLevelM ?? station.evacuationLevelM)} m` : null,
      validInaThreshold(height?.lowWaterLevelM ?? station.lowWaterLevelM) ? `referencia externa inferior: ${format(height?.lowWaterLevelM ?? station.lowWaterLevelM)} m` : null
    ].filter(Boolean).join(' · ') : '';
  const identifiers = [
    station.stationId ? `estación ${station.stationId}` : null,
    station.siteCode && String(station.siteCode) !== String(station.stationId) ? `siteCode ${station.siteCode}` : null,
    height?.seriesId ? `serie ${height.seriesId}` : null
  ].filter(Boolean).join(' · ');
  const datum = Number.isFinite(station.zeroScaleM) ? ` · cero de escala ${format(station.zeroScaleM)} m` : '';
  renderMapPointDetail({
    presentationType: sourceId === 'ina' ? 'ina-height' : 'station',
    title: station.name,
    intro: definition.intro,
    source: station.sourceLabel || definition.label,
    nature: sourceId === 'snih' ? 'Preliminar externo' : 'Observado externo',
    availability: station.dataAvailability || 'Respaldo local',
    type: `Altura de río${station.automatic ? ' · estación automática' : ''}`,
    value: `${format(value)} m`,
    date: height?.date ? formatApiDateTime(height.date) : 'Sin fecha reciente',
    location: `${station.river || 'Curso no informado'}${station.department ? ` · ${station.department}` : ''} · ${formatCoordinate(station.lat)}, ${formatCoordinate(station.lng)}`,
    id: identifiers || 'Sin identificador publicado',
    status: [heightState?.label, height?.status ? `Estado informado por la fuente: ${height.status}` : null, height?.trend, inaHeightIsOlder(station) ? 'lectura anterior a 72 h' : null].filter(Boolean).join(' · '),
    context: `${station.validation || definition.validation}${datum}${thresholds ? ` · Umbrales publicados por la fuente externa: ${thresholds}` : ''} · Estas referencias no constituyen una señal propia del dashboard. La cota no se promedia con otras redes porque puede usar otro cero hidrométrico.`,
    updated: `Última lectura publicada: ${formatApiDateTime(height.date)}`
  });
  if (sourceId === 'ina') renderInaHydrometryPanel(station);
}

const INA_HISTORY_ENDPOINT = 'https://alerta.ina.gob.ar/pub/datos/datos';
const INA_TIME_ZONE = 'America/Argentina/Buenos_Aires';
const INA_HISTORY_WINDOWS = Object.freeze({ '7d': 7, '30d': 30 });

function formatInaDateTime(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value || 'Sin dato');
  const parts = new Intl.DateTimeFormat('es-AR', {
    timeZone: INA_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(parsed);
  const part = type => parts.find(item => item.type === type)?.value || '';
  return `${part('day')}/${part('month')}/${part('year')} · ${part('hour')}:${part('minute')}`;
}

function formatInaTrend(value) {
  const normalized = normalizeSourceKey(value);
  if (normalized.includes('sube') || normalized.includes('asc')) return 'Sube';
  if (normalized.includes('baja') || normalized.includes('desc')) return 'Baja';
  if (normalized.includes('permanece') || normalized.includes('estable')) return 'Permanece';
  return '';
}

function normalizeInaHistoryTimestamp(value) {
  const text = String(value || '').trim().replace(' ', 'T');
  if (!text) return null;
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}-03:00`;
  const timestamp = new Date(zoned).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizeInaHistoryPayload(payload, expectedSeriesId) {
  const metadata = payload?.responseHeader?.seriesmetadata || {};
  const returnedSeriesId = metadata.seriesId ?? metadata.series_id;
  if (returnedSeriesId !== undefined && String(returnedSeriesId) !== String(expectedSeriesId)) throw new Error('INA devolvió una serie distinta de la solicitada');
  const unit = String(metadata.unit_abrev || metadata.unit || 'm').toLowerCase();
  if (unit && unit !== 'm') throw new Error(`La serie histórica no está expresada en metros (${unit})`);
  const seen = new Set();
  return (Array.isArray(payload?.data) ? payload.data : [])
    .map(observation => ({
      x: normalizeInaHistoryTimestamp(observation?.timestart ?? observation?.timeStart ?? observation?.fecha),
      y: finiteApiNumber(observation?.valor ?? observation?.value)
    }))
    .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y) && !seen.has(`${point.x}|${point.y}`) && seen.add(`${point.x}|${point.y}`))
    .sort((a, b) => a.x - b.x);
}

function inaWfsHistoryPoints(station, days) {
  const points = (station.latestHeight?.timeseries || [])
    .map(row => ({ x: normalizeInaHistoryTimestamp(row?.[0]), y: finiteApiNumber(row?.[1]) }))
    .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
    .sort((a, b) => a.x - b.x);
  if (!points.length) return [];
  const end = points.at(-1).x;
  const start = end - days * 24 * 60 * 60 * 1000;
  return points.filter(point => point.x >= start && point.x <= end);
}

function inaHistoryCacheKey(seriesId, windowKey) {
  return `${seriesId}:${windowKey}`;
}

async function fetchInaHistory(seriesId, days) {
  const timeEnd = new Date();
  const timeStart = new Date(timeEnd.getTime() - days * 24 * 60 * 60 * 1000);
  const url = `${INA_HISTORY_ENDPOINT}&seriesId=${encodeURIComponent(seriesId)}&timeStart=${encodeURIComponent(timeStart.toISOString())}&timeEnd=${encodeURIComponent(timeEnd.toISOString())}&format=json`;
  const response = await fetchWithTimeout(url, Number(state.climateMap.externalConfig?.ina?.timeoutMs) || 60000, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return normalizeInaHistoryPayload(await response.json(), seriesId);
}

async function loadInaHistoryWindow(station, windowKey) {
  const seriesId = station.latestHeight?.seriesId;
  if (seriesId === null || seriesId === undefined || seriesId === '') throw new Error('La estación no publica seriesId');
  const key = inaHistoryCacheKey(seriesId, windowKey);
  const historyState = state.climateMap.inaHistory;
  if (historyState.cache.has(key)) return historyState.cache.get(key);
  const days = INA_HISTORY_WINDOWS[windowKey];
  if (windowKey === '7d') {
    const wfsPoints = inaWfsHistoryPoints(station, days);
    if (wfsPoints.length) {
      historyState.cache.set(key, wfsPoints);
      return wfsPoints;
    }
  }
  if (historyState.requests.has(key)) return historyState.requests.get(key);
  const request = fetchInaHistory(seriesId, days)
    .then(points => {
      historyState.cache.set(key, points);
      historyState.requests.delete(key);
      return points;
    })
    .catch(error => {
      historyState.requests.delete(key);
      throw error;
    });
  historyState.requests.set(key, request);
  return request;
}

function inaThresholds(station) {
  const height = station.latestHeight || {};
  return [
    { label: 'Aguas bajas', value: height.lowWaterLevelM ?? station.lowWaterLevelM, color: '#657b9b' },
    { label: 'Alerta', value: height.alertLevelM ?? station.alertLevelM, color: '#d9931a' },
    { label: 'Evacuación', value: height.evacuationLevelM ?? station.evacuationLevelM, color: '#8f4b8d' }
  ].filter(threshold => validInaThreshold(finiteApiNumber(threshold.value))).map(threshold => ({ ...threshold, value: finiteApiNumber(threshold.value) }));
}

function inaObservationSegments(points) {
  if (points.length < 2) return points.length ? [points] : [];
  const intervals = points.slice(1).map((point, index) => point.x - points[index].x).filter(interval => interval > 0).sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)] || 0;
  const gapLimit = Math.max(3 * 60 * 60 * 1000, median * 3);
  return points.reduce((segments, point, index) => {
    if (!index || point.x - points[index - 1].x > gapLimit) segments.push([]);
    segments.at(-1).push(point);
    return segments;
  }, []);
}

function destroyInaHydrometryChart() {
  state.climateMap.inaHistory.chart?.destroy();
  state.climateMap.inaHistory.chart = null;
}

function inaHistoryDiffersFromCurrent(station, points) {
  if (!points.length) return false;
  const currentTimestamp = new Date(station.latestHeight?.date).getTime();
  if (!Number.isFinite(currentTimestamp)) return false;
  const intervals = points.slice(1).map((point, index) => point.x - points[index].x).filter(interval => interval > 0).sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)] || 0;
  return Math.abs(currentTimestamp - points.at(-1).x) > Math.max(2 * 60 * 60 * 1000, median * 1.5);
}

function renderInaHistoryChart(station, points) {
  const status = $('inaHistoryStatus');
  const canvas = $('inaHistoryChart');
  const notice = $('inaHistoryDifference');
  const legend = $('inaThresholdLegend');
  destroyInaHydrometryChart();
  if (!points.length) {
    if (status) status.textContent = 'No hay observaciones disponibles para este período.';
    if (canvas) canvas.hidden = true;
    if (notice) notice.hidden = true;
    if (legend) legend.innerHTML = '';
    return;
  }
  if (typeof Chart === 'undefined') throw new Error('La biblioteca de gráficos no está disponible');
  if (status) status.textContent = `${points.length} observaciones reales · hora de Argentina`;
  if (canvas) canvas.hidden = false;
  const thresholds = inaThresholds(station);
  if (legend) legend.innerHTML = thresholds.length
    ? `<span class="ina-threshold-source">Umbrales publicados por INA / autoridades competentes</span>${thresholds.map(threshold => `<span><i style="--threshold-color:${threshold.color}"></i>${escapeHtml(threshold.label)}: ${escapeHtml(format(threshold.value))} m</span>`).join('')}`
    : '';
  if (notice) {
    notice.hidden = !inaHistoryDiffersFromCurrent(station, points);
    notice.textContent = 'El último dato del gráfico puede diferir de la lectura más reciente.';
  }
  const latestTimestamp = points.at(-1).x;
  const observationDatasets = inaObservationSegments(points).map((segment, index) => ({
    label: 'Altura observada', data: segment, parsing: false, borderColor: '#087d94', backgroundColor: '#087d94', borderWidth: 2.2,
    pointRadius: context => context.raw.x === latestTimestamp ? 4.5 : 1.8,
    pointHoverRadius: 5,
    pointBackgroundColor: context => context.raw.x === latestTimestamp ? '#d66b3d' : '#087d94',
    tension: 0, fill: false, order: index + 1
  }));
  const thresholdDatasets = thresholds.map(threshold => ({
    label: threshold.label,
    data: [{ x: points[0].x, y: threshold.value }, { x: latestTimestamp, y: threshold.value }],
    parsing: false, borderColor: threshold.color, borderWidth: 1.4, borderDash: [6, 5], pointRadius: 0, pointHoverRadius: 0, tension: 0, order: 20
  }));
  state.climateMap.inaHistory.chart = new Chart(canvas, {
    type: 'line',
    data: { datasets: [...observationDatasets, ...thresholdDatasets] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'nearest', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: context => context.dataset.label === 'Altura observada',
          callbacks: {
            title: items => items.length ? formatInaDateTime(items[0].raw.x) : '',
            label: context => `${context.datasetIndex === observationDatasets.length - 1 && context.dataIndex === context.dataset.data.length - 1 ? 'Última observación · ' : ''}Altura: ${format(context.raw.y)} m`
          }
        }
      },
      scales: {
        x: {
          type: 'linear', grid: { color: 'rgba(37,67,63,.08)' },
          ticks: { maxTicksLimit: 5, callback: value => new Date(value).toLocaleDateString('es-AR', { timeZone: INA_TIME_ZONE, day: '2-digit', month: '2-digit' }) },
          title: { display: true, text: 'Fecha / hora (Argentina)' }
        },
        y: {
          grid: { color: 'rgba(37,67,63,.1)' }, ticks: { callback: value => `${format(value)} m` }, title: { display: true, text: 'Altura (m)' }
        }
      }
    }
  });
}

async function showInaHistoryWindow(station, windowKey, token) {
  const status = $('inaHistoryStatus');
  const canvas = $('inaHistoryChart');
  const buttons = document.querySelectorAll('[data-ina-history-window]');
  buttons.forEach(button => {
    button.classList.toggle('is-active', button.dataset.inaHistoryWindow === windowKey);
    button.setAttribute('aria-pressed', String(button.dataset.inaHistoryWindow === windowKey));
    button.disabled = true;
  });
  if (status) status.textContent = 'Cargando serie hidrométrica…';
  if (canvas) canvas.hidden = true;
  try {
    const points = await loadInaHistoryWindow(station, windowKey);
    if (token !== state.climateMap.inaHistory.selectionToken) return;
    renderInaHistoryChart(station, points);
  } catch (error) {
    if (token !== state.climateMap.inaHistory.selectionToken) return;
    destroyInaHydrometryChart();
    if (status) status.textContent = 'No fue posible consultar el histórico en este momento.';
    if (canvas) canvas.hidden = true;
    console.warn(`No se pudo consultar el histórico INA de la serie ${station.latestHeight?.seriesId}: ${error.message}`);
  } finally {
    if (token === state.climateMap.inaHistory.selectionToken) buttons.forEach(button => { button.disabled = false; });
  }
}

function renderInaHydrometryPanel(station) {
  const container = $('mapPointOperationalDetail');
  if (!container) return;
  const height = station.latestHeight || {};
  const trend = formatInaTrend(height.trend);
  const token = ++state.climateMap.inaHistory.selectionToken;
  destroyInaHydrometryChart();
  container.innerHTML = `
    <dl class="climate-detail-list climate-point-detail-list ina-current-summary">
      <div><dt>Estación</dt><dd>${escapeHtml(station.name)}</dd></div>
      <div><dt>Río / curso</dt><dd>${escapeHtml(station.river || 'No informado por INA')}</dd></div>
      <div><dt>Altura actual</dt><dd>${escapeHtml(format(height.valueM))} m</dd></div>
      <div><dt>Última actualización</dt><dd>${escapeHtml(formatInaDateTime(height.date))}</dd></div>
      <div class="climate-detail-wide"><dt>Fuente</dt><dd>INA / SIyAH</dd></div>
      ${trend ? `<div class="climate-detail-wide"><dt>Tendencia informada por INA</dt><dd>${escapeHtml(trend)}</dd></div>` : ''}
    </dl>
    <section class="ina-history-panel" aria-labelledby="inaHistoryTitle">
      <div class="ina-history-head"><div><h4 id="inaHistoryTitle">Evolución de la altura del río</h4><small>Serie observada oficial · metros</small></div><div class="ina-history-window" role="group" aria-label="Período del gráfico"><button type="button" data-ina-history-window="7d" class="is-active" aria-pressed="true">7 días</button><button type="button" data-ina-history-window="30d" aria-pressed="false">30 días</button></div></div>
      <p id="inaHistoryStatus" class="ina-history-status" role="status">Cargando serie hidrométrica…</p>
      <div class="ina-history-chart-wrap"><canvas id="inaHistoryChart" aria-label="Gráfico de altura hidrométrica observada" role="img"></canvas></div>
      <div id="inaThresholdLegend" class="ina-threshold-legend"></div>
      <p id="inaHistoryDifference" class="ina-history-notice" hidden></p>
      <a class="ina-history-source" href="https://alerta.ina.gob.ar/pub/mapa" target="_blank" rel="noopener noreferrer">Fuente: INA / SIyAH</a>
    </section>`;
  container.querySelectorAll('[data-ina-history-window]').forEach(button => button.addEventListener('click', () => showInaHistoryWindow(station, button.dataset.inaHistoryWindow, token)));
  showInaHistoryWindow(station, '7d', token);
  scheduleClimateMapInvalidate();
}

function renderInaPointDetail(station) {
  renderPrimaryHeightDetail('ina', station);
}

function renderAuthorityHeightLayer(sourceId, observations, sourceInfo = {}) {
  const definition = PRIMARY_HEIGHT_SOURCE_DETAILS[sourceId];
  const sourceConfig = CLIMATE_POINT_SOURCES[sourceId];
  if (!definition || !sourceConfig) return;
  const availability = sourceInfo.source === 'live' ? 'Consulta externa actualizada' : 'Respaldo local';
  const normalized = normalizePrimaryHeightRecords(observations, sourceId).map(station => ({ ...station, dataAvailability: availability }));
  replaceClimatePointLayer(sourceId, normalized, station => {
    const older = inaHeightIsOlder(station);
    const value = station.latestHeight.valueM;
    const marker = L.circleMarker([station.lat, station.lng], {
      pane: sourceConfig.pane,
      radius: 6.2,
      color: '#07584a',
      weight: 2,
      fillColor: sourceConfig.color,
      fillOpacity: older ? 0.68 : 0.94,
      dashArray: older ? '4 3' : undefined,
      className: `climate-point-marker source-${sourceId}-marker${older ? ' river-height-older' : ''}`
    });
    marker.bindTooltip(`${station.name}: ${format(value)} m · ${formatApiDateTime(station.latestHeight.date)}`, { direction: 'top' });
    marker.bindPopup(`<strong>Hidrometría</strong><span class="climate-api-popup-label">Estación</span>${escapeHtml(station.name)}<span class="climate-api-popup-label">Altura observada</span>${escapeHtml(format(value))} m · ${escapeHtml(formatApiDateTime(station.latestHeight.date))}<span class="climate-api-popup-label">Fuente</span>${escapeHtml(definition.label)}`);
    marker.on('click', () => renderPrimaryHeightDetail(sourceId, station));
    return marker;
  });
  const metadata = sourceInfo.metadata || {};
  const olderCount = normalized.filter(station => inaHeightIsOlder(station)).length;
  const missingCount = Number(metadata.missingHeightCount) || 0;
  const failedCount = Number(metadata.failedCount) || 0;
  const isLive = sourceInfo.source === 'live';
  const meta = [
    Number(metadata.inventoryCount) ? `${metadata.inventoryCount} estaciones candidatas` : null,
    missingCount ? `${missingCount} sin altura vigente, omitidas` : null,
    failedCount ? `${failedCount} consultas fallidas` : null,
    olderCount ? `${olderCount} lecturas superan 72 h` : null,
    sourceInfo.generatedAt ? `consulta ${formatClimateUpdatedAt(sourceInfo.generatedAt)}` : null,
    sourceInfo.reason ? `actualización: ${sourceInfo.reason}` : null
  ].filter(Boolean).join(' · ');
  updateClimateApiCard(
    definition.cardPrefix,
    isLive ? 'live' : 'cache',
    isLive ? 'En vivo' : 'Respaldo local',
    `${normalized.length} estaciones con altura, fecha y coordenadas válidas; no se dibujan registros vacíos.`,
    meta || 'Cada punto conserva la identificación y validación de su fuente.'
  );
}

async function refreshPointInaSource() {
  const config = state.climateMap.externalConfig?.ina;
  if (!config?.stationUrl || state.climateMap.pointRequests.has('ina')) return;
  state.climateMap.pointRequests.add('ina');
  updateClimateApiCard('inaApi', 'loading', 'Consultando', 'Las alturas respaldadas permanecen visibles durante la consulta.');
  try {
    const [stationResponse, heightResponse] = await Promise.all([
      fetchWithTimeout(config.stationUrl, Number(config.timeoutMs) || 60000, { cache: 'no-store' }),
      fetchWithTimeout(config.latestHeightsWfsUrl, Number(config.timeoutMs) || 60000, { cache: 'no-store' })
    ]);
    if (!stationResponse.ok) throw new Error(`Estaciones HTTP ${stationResponse.status}`);
    if (!heightResponse.ok) throw new Error(`Alturas HTTP ${heightResponse.status}`);
    const stationPayload = await stationResponse.json();
    const heightPayload = await heightResponse.json();
    const stations = normalizeInaStations(stationPayload, heightPayload);
    if (!stations.length) throw new Error('INA no devolvió estaciones válidas');
    const heightObservations = selectInaHeightObservations(stations, heightPayload);
    if (!heightObservations.length) throw new Error('INA no devolvió alturas numéricas pertinentes para Corrientes');
    renderInaPointLayer(heightObservations, { source: 'live', inventory: stations });
    await refreshGeoglowsCoverage(stations);
  } catch (error) {
    updateClimateApiCard('inaApi', 'cache', 'Respaldo local', undefined, `La consulta en vivo falló: ${error.message}`);
    console.warn(`No se pudo actualizar INA: ${error.message}`);
  }
}

async function refreshPrimaryRiverHeightSources({ force = false } = {}) {
  const config = state.climateMap.externalConfig?.primaryRiverHeights;
  if (!config?.proxyUrl || state.climateMap.refreshingPrimaryHeights) return;
  if (state.climateMap.primaryProxyUnavailable && !force) return;
  state.climateMap.refreshingPrimaryHeights = true;
  ['ina', 'snih', 'salto'].forEach(sourceId => {
    const prefix = PRIMARY_HEIGHT_SOURCE_DETAILS[sourceId].cardPrefix;
    updateClimateApiCard(prefix, 'loading', 'Consultando', 'Las lecturas respaldadas permanecen visibles durante la actualización.');
  });
  try {
    const response = await fetchWithTimeout(config.proxyUrl, Number(config.timeoutMs) || 120000, { cache: 'no-store' });
    if (response.status === 404) {
      state.climateMap.primaryProxyUnavailable = true;
      await refreshPointInaSource();
      ['snih', 'salto'].forEach(sourceId => {
        const prefix = PRIMARY_HEIGHT_SOURCE_DETAILS[sourceId].cardPrefix;
        updateClimateApiCard(prefix, 'cache', 'Respaldo local', undefined, 'El hosting estático conserva la instantánea diaria; npm start habilita actualización intradía.');
      });
      return;
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status}`);
    const isLive = !payload.degraded && payload.source !== 'snapshot';
    const sources = payload.sources || {};
    const sourceStatus = payload.sourceStatus || {};
    ['ina', 'snih', 'salto'].forEach(sourceId => {
      const source = sources[sourceId] || {};
      const status = sourceStatus[sourceId] || {};
      const observations = Array.isArray(source.observations) ? source.observations : [];
      const sourceInfo = {
        source: isLive && status.ok !== false ? 'live' : 'cache',
        generatedAt: payload.generatedAt,
        metadata: source.metadata || {},
        inventory: sourceId === 'ina' ? {
          hydrologicalCount: source.metadata?.inventoryCount,
          stations: []
        } : undefined,
        reason: status.ok === false ? status.error : payload.upstreamError
      };
      if (status.ok === false && !observations.length) {
        const prefix = PRIMARY_HEIGHT_SOURCE_DETAILS[sourceId].cardPrefix;
        updateClimateApiCard(prefix, 'cache', 'Respaldo local', undefined, `La fuente no respondió: ${status.error || 'error sin detalle'}. Se conserva la instantánea visible.`);
        return;
      }
      if (sourceId === 'ina') renderInaPointLayer(observations, sourceInfo);
      else renderAuthorityHeightLayer(sourceId, observations, sourceInfo);
    });
  } catch (error) {
    ['ina', 'snih', 'salto'].forEach(sourceId => {
      const prefix = PRIMARY_HEIGHT_SOURCE_DETAILS[sourceId].cardPrefix;
      updateClimateApiCard(prefix, 'cache', 'Respaldo local', undefined, `La actualización en vivo falló: ${error.name === 'AbortError' ? 'tiempo agotado' : error.message}`);
    });
    console.warn(`No se pudieron actualizar las alturas primarias: ${error.message}`);
  } finally {
    state.climateMap.refreshingPrimaryHeights = false;
  }
}

function startClimateMapRefresh() {
  if (state.climateMap.refreshTimer) clearInterval(state.climateMap.refreshTimer);
  const interval = Math.max(60_000, Number(state.climateMap.externalConfig?.primaryRiverHeights?.refreshIntervalMs) || 300_000);
  state.climateMap.refreshTimer = setInterval(() => {
    if (document.hidden || state.climateMap.mode !== 'hydrology') return;
    void refreshPrimaryRiverHeightSources();
    void refreshSatelliteFloodStatus();
  }, interval);
}

function climateRingContains(ring, lng, lat) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[previous];
    if ((y1 > lat) !== (y2 > lat) && lng < ((x2 - x1) * (lat - y1)) / (y2 - y1) + x1) inside = !inside;
  }
  return inside;
}

function climatePolygonContains(polygon, lng, lat) {
  return climateRingContains(polygon[0] || [], lng, lat) && !(polygon.slice(1).some(ring => climateRingContains(ring, lng, lat)));
}

function climateGeometryContains(geometry, lng, lat) {
  if (geometry?.type === 'Polygon') return climatePolygonContains(geometry.coordinates || [], lng, lat);
  if (geometry?.type === 'MultiPolygon') return (geometry.coordinates || []).some(polygon => climatePolygonContains(polygon, lng, lat));
  return false;
}

function isInsideCorrientes(lng, lat) {
  return (state.climateMap.provinceGeojson?.features || []).some(feature => climateGeometryContains(feature.geometry, lng, lat));
}

function buildNasaPowerRequestUrl() {
  const config = state.climateMap.externalConfig?.nasaPower;
  if (!config?.baseUrl) return '';
  const now = new Date();
  const start = new Date(now.getTime() - (Number(config.lookbackDays) || 22) * 86400000);
  const compactDate = date => date.toISOString().slice(0, 10).replaceAll('-', '');
  const bbox = config.bbox || {};
  const params = new URLSearchParams({
    'latitude-min': bbox.latitudeMin,
    'latitude-max': bbox.latitudeMax,
    'longitude-min': bbox.longitudeMin,
    'longitude-max': bbox.longitudeMax,
    parameters: config.parameter || 'PRECTOTCORR',
    community: config.community || 'AG',
    start: compactDate(start),
    end: compactDate(now),
    format: 'JSON',
    'time-standard': config.timeStandard || 'UTC'
  });
  return `${config.baseUrl}?${params}`;
}

function normalizeNasaPowerPayload(payload) {
  const parameter = state.climateMap.externalConfig?.nasaPower?.parameter || 'PRECTOTCORR';
  const fillValue = finiteApiNumber(payload?.header?.fill_value);
  const dates = new Set();
  (payload?.features || []).forEach(feature => {
    const values = feature?.properties?.parameter?.[parameter] || {};
    Object.entries(values).forEach(([date, raw]) => {
      const value = finiteApiNumber(raw);
      if (Number.isFinite(value) && value !== fillValue) dates.add(date);
    });
  });
  const latest = [...dates].sort().at(-1);
  if (!latest) return { points: [], date: '' };
  const date = `${latest.slice(0, 4)}-${latest.slice(4, 6)}-${latest.slice(6, 8)}`;
  const points = (payload.features || []).map(feature => {
    const coordinates = feature?.geometry?.coordinates || [];
    const lng = finiteApiNumber(coordinates[0]);
    const lat = finiteApiNumber(coordinates[1]);
    const value = finiteApiNumber(feature?.properties?.parameter?.[parameter]?.[latest]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(value) || value === fillValue || !isInsideCorrientes(lng, lat)) return null;
    return {
      id: `POWER_${lat.toFixed(3)}_${lng.toFixed(3)}`,
      date,
      lat,
      lng,
      elevationM: finiteApiNumber(coordinates[2]),
      precipitationMm: value
    };
  }).filter(Boolean);
  return {
    date,
    parameter,
    parameterLabel: payload?.parameters?.[parameter]?.longname || 'Precipitación corregida',
    unit: payload?.parameters?.[parameter]?.units || 'mm/día',
    timeStandard: payload?.header?.time_standard || 'UTC',
    apiVersion: payload?.header?.api?.version,
    dataSources: payload?.header?.sources || [],
    gridResolution: { latitudeDegrees: 0.5, longitudeDegrees: 0.625 },
    points
  };
}

function renderNasaPointLayer(dataset, sourceInfo = {}) {
  const availability = sourceInfo.source === 'live' ? 'Consulta externa actualizada' : 'Respaldo local';
  const points = (Array.isArray(dataset) ? dataset : (dataset.points || [])).map(point => ({ ...point, dataAvailability: availability }));
  const metadata = Array.isArray(dataset) ? {} : dataset;
  replaceClimatePointLayer('nasa', points, point => {
    const marker = L.circleMarker([point.lat, point.lng], {
      pane: CLIMATE_POINT_SOURCES.nasa.pane,
      radius: Math.min(8, 4.4 + Math.sqrt(Math.max(0, point.precipitationMm || 0)) / 2),
      color: '#44316e',
      weight: 1.4,
      fillColor: CLIMATE_POINT_SOURCES.nasa.color,
      fillOpacity: 0.78,
      className: 'climate-point-marker source-nasa-marker'
    });
    marker.bindTooltip(`NASA POWER: ${formatClimateMm(point.precipitationMm)} · ${formatDate(point.date)}`, { direction: 'top' });
    marker.bindPopup(`<strong>Modelos y pronósticos</strong><span class="climate-api-popup-label">Valor modelado</span>${escapeHtml(formatClimateMm(point.precipitationMm))}<span class="climate-api-popup-label">Fecha</span>${escapeHtml(formatDate(point.date))}<span class="climate-api-popup-label">Fuente</span>NASA POWER`);
    marker.on('click', () => renderNasaPointDetail(point, metadata));
    return marker;
  });
  const date = metadata.date || points[0]?.date;
  const isLive = sourceInfo.source === 'live';
  updateClimateApiCard(
    'nasaApi',
    isLive ? 'live' : 'cache',
    isLive ? 'En vivo' : 'Respaldo local',
    `${points.length} centros de celda dentro del límite de Corrientes.`,
    `${date ? `Precipitación corregida del ${formatDate(date)}` : 'Sin fecha válida'} · grilla 0,5° × 0,625° · no son estaciones.`
  );
}

function renderNasaPointDetail(point, metadata = {}) {
  const resolution = metadata.gridResolution || { latitudeDegrees: 0.5, longitudeDegrees: 0.625 };
  renderMapPointDetail({
    title: `Celda NASA ${point.lat.toFixed(3)}, ${point.lng.toFixed(3)}`,
    intro: 'Centro de una celda meteorológica de NASA POWER, recortada al límite provincial.',
    source: `NASA POWER${metadata.dataSources?.length ? ` · ${metadata.dataSources.join(', ')}` : ''}`,
    nature: 'Modelado / grilla meteorológica',
    availability: point.dataAvailability,
    type: 'Grilla meteorológica · no es estación',
    value: formatClimateMm(point.precipitationMm),
    date: formatDate(point.date),
    location: `${formatCoordinate(point.lat)}, ${formatCoordinate(point.lng)}${Number.isFinite(point.elevationM) ? ` · elevación ${format(point.elevationM)} m` : ''}`,
    id: point.id,
    status: 'Dato diario disponible',
    context: `Precipitación corregida · resolución ${resolution.latitudeDegrees}° × ${resolution.longitudeDegrees}°. No debe interpretarse como pluviómetro local.`,
    updated: `${metadata.timeStandard || 'UTC'}${metadata.apiVersion ? ` · API ${metadata.apiVersion}` : ''}`
  });
}

async function refreshPointNasaSource() {
  const url = buildNasaPowerRequestUrl();
  const config = state.climateMap.externalConfig?.nasaPower;
  if (!url || state.climateMap.pointRequests.has('nasa')) return;
  state.climateMap.pointRequests.add('nasa');
  updateClimateApiCard('nasaApi', 'loading', 'Consultando', 'El respaldo de grilla permanece visible durante la consulta regional.');
  try {
    const response = await fetchWithTimeout(url, Number(config.timeoutMs) || 150000, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const dataset = normalizeNasaPowerPayload(await response.json());
    if (!dataset.points.length) throw new Error('NASA POWER no devolvió celdas válidas dentro de Corrientes');
    renderNasaPointLayer(dataset, { source: 'live' });
  } catch (error) {
    updateClimateApiCard('nasaApi', 'cache', 'Respaldo local', undefined, `La consulta en vivo falló: ${error.name === 'AbortError' ? 'tiempo agotado' : error.message}`);
    console.warn(`No se pudo actualizar NASA POWER: ${error.message}`);
  }
}

function renderGeoglowsPointLayer(nodes, sourceInfo = {}) {
  const availability = sourceInfo.source === 'live' ? 'Consulta externa actualizada' : 'Respaldo local';
  const validNodes = (nodes || []).filter(node => Number.isFinite(Number(node.riverId)) && isCorrientesCoordinate(Number(node.lat), Number(node.lng)))
    .map(node => ({ ...node, riverId: Number(node.riverId), siteCode: Number(node.siteCode), lat: Number(node.lat), lng: Number(node.lng), dataAvailability: availability }));
  replaceClimatePointLayer('geoglows', validNodes, node => {
    const marker = L.circleMarker([node.lat, node.lng], {
      pane: CLIMATE_POINT_SOURCES.geoglows.pane,
      radius: 10,
      color: CLIMATE_POINT_SOURCES.geoglows.color,
      weight: 2.4,
      fillColor: CLIMATE_POINT_SOURCES.geoglows.color,
      fillOpacity: 0.08,
      className: 'climate-point-marker source-geoglows-marker'
    });
    marker.bindTooltip(`${node.stationName} · pronóstico disponible al consultar`, { direction: 'top' });
    marker.bindPopup(`<strong>Modelos y pronósticos</strong><span class="climate-api-popup-label">Punto de referencia</span>${escapeHtml(node.stationName)}<span class="climate-api-popup-label">Fuente</span>GEOGLOWS`);
    marker.on('click', () => renderGeoglowsNodeDetail(node));
    return marker;
  });
  const unique = new Set(validNodes.map(node => node.riverId)).size;
  updateClimateApiCard(
    'geoglowsApi',
    validNodes.length ? 'active' : 'error',
    validNodes.length ? 'Cobertura completa' : 'Sin nodos',
    `${validNodes.length} nodos asociados a las estaciones hidrológicas del INA; ${unique} River ID distintos.`,
    `El pronóstico se consulta por nodo al seleccionarlo.${sourceInfo.generatedAt ? ` · mapeo ${formatClimateUpdatedAt(sourceInfo.generatedAt)}` : ''}`
  );
}

function geoglowsStationForNode(node) {
  return (state.climateMap.pointData.get('ina') || []).find(station => Number(station.siteCode) === Number(node.siteCode));
}

function renderGeoglowsNodeDetail(node) {
  const cached = state.climateMap.geoglowsForecasts.get(node.riverId);
  if (cached) return renderGeoglowsForecastDetail(node, cached);
  const station = geoglowsStationForNode(node);
  renderMapPointDetail({
    presentationType: 'forecast',
    title: `GEOGLOWS · ${node.stationName}`,
    intro: 'Nodo modelado del tramo fluvial más cercano a la coordenada de una estación hidrológica INA.',
    source: 'GEOGLOWS–ECMWF',
    nature: 'Modelado / pronóstico',
    availability: node.dataAvailability,
    type: 'Pronóstico de caudal modelado',
    value: 'Cargar pronóstico',
    date: 'Horizonte disponible al consultar',
    location: `${station?.river || 'Curso no informado'} · ${formatCoordinate(node.lat)}, ${formatCoordinate(node.lng)}`,
    id: `River ID ${node.riverId} · siteCode ${node.siteCode}`,
    status: 'Nodo resuelto',
    context: 'El River ID es el tramo de la red GEOGLOWS más cercano. El caudal es modelado y no equivale a la altura observada por INA.',
    updated: 'API GEOGLOWS v2 · consulta bajo demanda'
  }, { label: 'Cargar pronóstico de este nodo', handler: () => loadGeoglowsForecastForNode(node) });
}

async function loadGeoglowsForecastForNode(node) {
  const config = state.climateMap.externalConfig?.geoglows;
  const endpoint = `${config.baseUrl.replace(/\/$/, '')}/forecast/${encodeURIComponent(node.riverId)}`;
  $('mapPointDetailStatus').textContent = 'Consultando pronóstico…';
  try {
    const response = await fetchWithTimeout(endpoint, Number(config.timeoutMs) || 45000, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rows = parseGeoglowsForecastCsv(await response.text());
    if (!rows.length) throw new Error('Pronóstico vacío o con formato inesperado');
    const forecast = {
      first: rows[0],
      last: rows.at(-1),
      peak: rows.reduce((maximum, row) => row.median > maximum.median ? row : maximum, rows[0]),
      fetchedAt: new Date().toISOString()
    };
    state.climateMap.geoglowsForecasts.set(node.riverId, forecast);
    renderGeoglowsForecastDetail(node, forecast);
  } catch (error) {
    $('mapPointDetailStatus').textContent = `No disponible: ${error.message}`;
    throw error;
  }
}

function renderGeoglowsForecastDetail(node, forecast) {
  const station = geoglowsStationForNode(node);
  renderMapPointDetail({
    presentationType: 'forecast',
    title: `GEOGLOWS · ${node.stationName}`,
    intro: 'Pronóstico de caudal del tramo modelado asociado a la estación INA.',
    source: 'GEOGLOWS–ECMWF',
    nature: 'Modelado / pronóstico',
    availability: 'Consulta externa actualizada',
    type: 'Caudal modelado · mediana e incertidumbre',
    value: `${formatApiFlow(forecast.first.median)} · pico ${formatApiFlow(forecast.peak.median)}`,
    date: `${formatApiDateTime(forecast.first.datetime)} a ${formatApiDateTime(forecast.last.datetime)}`,
    location: `${station?.river || 'Curso no informado'} · ${formatCoordinate(node.lat)}, ${formatCoordinate(node.lng)}`,
    id: `River ID ${node.riverId} · siteCode ${node.siteCode}`,
    status: `Intervalo inicial ${formatApiFlow(forecast.first.lower)} – ${formatApiFlow(forecast.first.upper)}`,
    context: `Máximo mediano del horizonte: ${formatApiFlow(forecast.peak.median)} el ${formatApiDateTime(forecast.peak.datetime)}. No es altura hidrométrica observada.`,
    updated: `Consulta ${formatClimateUpdatedAt(forecast.fetchedAt)}`
  }, { label: 'Actualizar pronóstico', handler: () => loadGeoglowsForecastForNode(node) });
}

async function refreshGeoglowsCoverage(stations) {
  const config = state.climateMap.externalConfig?.geoglows;
  if (!config?.baseUrl) return;
  const hydrological = stations.filter(station => station.typeCode === 'H');
  const cached = new Map((state.climateMap.pointData.get('geoglows') || []).map(node => [Number(node.siteCode), node]));
  const nodes = [];
  const missing = [];
  hydrological.forEach(station => {
    const node = cached.get(Number(station.siteCode));
    if (node) nodes.push({ ...node, stationName: station.name, lat: station.lat, lng: station.lng });
    else missing.push(station);
  });
  const resolved = await mapWithConcurrency(missing, 5, async station => {
    const params = new URLSearchParams({ lat: station.lat, lon: station.lng });
    const response = await fetchWithTimeout(`${config.baseUrl.replace(/\/$/, '')}/getriverid?${params}`, Number(config.timeoutMs) || 45000, { cache: 'no-store' });
    if (!response.ok) return null;
    const payload = await response.json();
    const riverId = Number(payload.river_id);
    return Number.isFinite(riverId) ? { siteCode: station.siteCode, stationName: station.name, lat: station.lat, lng: station.lng, riverId } : null;
  });
  nodes.push(...resolved.filter(Boolean));
  renderGeoglowsPointLayer(nodes, { source: missing.length ? 'live' : 'cache' });
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await mapper(items[index], index);
      } catch (error) {
        console.warn(`No se pudo resolver un punto: ${error.message}`);
        results[index] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function initializePointRasterLayers() {
  const select = $('climateHydrologyLayer');
  state.climateMap.wmsLayers = new Map();
  state.climateMap.satelliteOpacities = new Map();
  if (!select) return;
  select.innerHTML = '<option value="none">Sin imagen de inundación</option>';
  (state.climateMap.externalConfig?.wmsLayers || []).forEach(layerConfig => {
    const satelliteStatus = state.climateMap.satelliteStatus?.layers?.[layerConfig.statusKey || layerConfig.id] || null;
    const initialOpacity = Math.max(0.1, Math.min(1, Number(layerConfig.opacity) || 0.65));
    const resolvedWmsTime = layerConfig.timeMode === 'source-status' && satelliteStatus?.date && layerConfig.usesTimeParameter !== false ? satelliteStatus.date : null;
    const options = {
      layers: layerConfig.layers,
      styles: '',
      format: layerConfig.format || 'image/png',
      transparent: layerConfig.transparent !== false,
      version: layerConfig.version || '1.1.1',
      opacity: initialOpacity,
      crossOrigin: 'anonymous',
      pane: 'climateRasterPane',
      attribution: layerConfig.attribution || layerConfig.shortLabel || layerConfig.label
    };
    if (resolvedWmsTime) options.time = resolvedWmsTime;
    const runtimeConfig = {
      ...layerConfig,
      resolvedTime: resolvedWmsTime,
      acquiredAt: satelliteStatus?.acquiredAt || null,
      sceneId: satelliteStatus?.sceneId || '',
      available: satelliteStatus?.available !== false,
      sourceUrl: satelliteStatus?.sourceUrl || ''
    };
    const layer = L.tileLayer.wms(layerConfig.serviceUrl, options);
    layer.on('tileerror', () => showClimateMapMessage(`La capa ${layerConfig.shortLabel || layerConfig.label} no devolvió una o más teselas.`, 5000));
    state.climateMap.wmsLayers.set(layerConfig.id, { layer, config: runtimeConfig });
    state.climateMap.satelliteOpacities.set(layerConfig.id, initialOpacity);
    const option = document.createElement('option');
    option.value = layerConfig.id;
    option.textContent = layerConfig.shortLabel || layerConfig.label;
    select.append(option);
  });
  select.addEventListener('change', event => selectClimateHydrologyLayer(event.target.value));
  selectClimateHydrologyLayer('none');
  updateSatelliteApiCard(state.climateMap.satelliteStatus, 'cache');
}

function applySatelliteStatusToRasterLayers(payload) {
  if (!payload?.layers) return;
  state.climateMap.satelliteStatus = payload;
  state.climateMap.wmsLayers.forEach(entry => {
    const status = payload.layers[entry.config.statusKey || entry.config.id];
    if (!status) return;
    const resolvedWmsTime = status.date && entry.config.usesTimeParameter !== false ? status.date : null;
    entry.config.resolvedTime = resolvedWmsTime;
    entry.config.acquiredAt = status.acquiredAt || null;
    entry.config.sceneId = status.sceneId || '';
    entry.config.available = status.available !== false;
    entry.config.sourceUrl = status.sourceUrl || '';
    if (resolvedWmsTime) entry.layer.setParams({ time: resolvedWmsTime });
  });
  const selected = state.climateMap.wmsLayers.get(state.climateMap.activeHydrologyLayer);
  if (selected) renderSatelliteLayerDetail(selected.config);
  renderClimateExternalLegend(selected?.config || null);
  updateClimatePointSummary();
}

function updateSatelliteApiCard(payload, source = 'cache', reason = '') {
  if (!payload?.layers) return;
  const available = Object.values(payload.layers).filter(layer => layer.available !== false && layer.date);
  const newest = [...available].sort((a, b) => String(b.acquiredAt || '').localeCompare(String(a.acquiredAt || '')))[0];
  const unavailable = Object.values(payload.layers).filter(layer => layer.available === false);
  const isLive = source === 'live';
  updateClimateApiCard(
    'satelliteApi',
    isLive ? 'live' : 'cache',
    isLive ? 'En vivo' : 'Respaldo local',
    `${available.length} capas observadas con escena identificada: OPERA Sentinel-1, Copernicus GFM y NASA VIIRS.`,
    `${newest?.acquiredAt ? `Escena más reciente: ${formatApiDateTime(newest.acquiredAt)}` : 'Sin fecha de escena'}${unavailable.length ? ` · ${unavailable.length} fuente(s) no respondieron` : ''}${reason ? ` · ${reason}` : ''}`
  );
}

async function refreshSatelliteFloodStatus() {
  const config = state.climateMap.externalConfig?.satelliteFloodStatus;
  if (!config?.proxyUrl || state.climateMap.refreshingSatelliteStatus || state.climateMap.satelliteProxyUnavailable) return;
  state.climateMap.refreshingSatelliteStatus = true;
  updateClimateApiCard('satelliteApi', 'loading', 'Consultando', 'La imagen respaldada permanece visible mientras se verifican las escenas.');
  try {
    const response = await fetchWithTimeout(config.proxyUrl, Number(config.timeoutMs) || 60000, { cache: 'no-store' });
    if (response.status === 404) {
      state.climateMap.satelliteProxyUnavailable = true;
      updateSatelliteApiCard(state.climateMap.satelliteStatus, 'cache', 'El hosting estático usa la instantánea diaria; npm start habilita metadatos intradía.');
      return;
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false || !payload.layers) throw new Error(payload.error || `HTTP ${response.status}`);
    applySatelliteStatusToRasterLayers(payload);
    updateSatelliteApiCard(payload, payload.degraded || payload.source === 'snapshot' ? 'cache' : 'live', payload.upstreamError || '');
  } catch (error) {
    updateSatelliteApiCard(state.climateMap.satelliteStatus, 'cache', `actualización fallida: ${error.name === 'AbortError' ? 'tiempo agotado' : error.message}`);
    console.warn(`No se pudieron actualizar los metadatos satelitales: ${error.message}`);
  } finally {
    state.climateMap.refreshingSatelliteStatus = false;
  }
}

function selectClimateHydrologyLayer(layerId) {
  sourceAudit.selectedId = ({operaS1:'opera', nasaViirsFlood:'viirs', gfmObservedFlood:'gfm'})[layerId] || sourceAudit.selectedId;
  state.climateMap.wmsLayers.forEach(({ layer }) => {
    if (state.climateMap.map.hasLayer(layer)) state.climateMap.map.removeLayer(layer);
  });
  state.climateMap.activeHydrologyLayer = state.climateMap.wmsLayers.has(layerId) ? layerId : 'none';
  if (state.climateMap.activeHydrologyLayer !== 'none') state.climateMap.preferredHydrologyLayer = state.climateMap.activeHydrologyLayer;
  const selected = state.climateMap.wmsLayers.get(state.climateMap.activeHydrologyLayer);
  if (selected) {
    const selectedOpacity = state.climateMap.satelliteOpacities.get(state.climateMap.activeHydrologyLayer) ?? Number(selected.config.opacity) ?? 0.65;
    setClimateSatelliteOpacity(selectedOpacity, { updateUrl: false });
  }
  if (selected && state.climateMap.mode === 'hydrology') selected.layer.addTo(state.climateMap.map);
  if (state.climateMap.mode === 'hydrology') state.climateMap.geoLayer?.setStyle(climatePointBoundaryStyle);
  if ($('climateHydrologyLayer')) $('climateHydrologyLayer').value = state.climateMap.activeHydrologyLayer;
  renderClimateExternalLegend(selected?.config || null);
  if (selected) renderSatelliteLayerDetail(selected.config);
  updateClimatePointSummary();
  updateClimateViewUrl();
}

function renderSatelliteLayerDetail(layerConfig) {
  const hasDate = layerConfig.displayTimeMode === 'wms-date' ? Boolean(layerConfig.resolvedTime) : Boolean(layerConfig.acquiredAt || layerConfig.resolvedTime);
  const available = layerConfig.available !== false && hasDate;
  const executiveDescription = {
    nasaViirsFlood: 'Áreas clasificadas por el satélite como agua superficial, inundación detectada o cobertura insuficiente.',
    operaS1: 'Superficies con agua abierta y vegetación inundada identificadas mediante observación satelital.',
    gfmObservedFlood: 'Áreas donde el producto satelital identifica extensión de inundación y agua observada.'
  }[layerConfig.id] || 'Información clasificada por el producto satelital seleccionado.';
  renderMapPointDetail({
    presentationType: 'satellite',
    sourceId: ({ operaS1: 'opera', nasaViirsFlood: 'viirs', gfmObservedFlood: 'gfm' })[layerConfig.id],
    title: 'Observación satelital',
    intro: '',
    source: ({ operaS1: 'NASA OPERA', nasaViirsFlood: 'NASA VIIRS', gfmObservedFlood: 'Copernicus GFM' })[layerConfig.id] || layerConfig.attribution,
    nature: 'Satelital',
    availability: available ? 'Escena disponible' : 'Datos insuficientes',
    type: 'Observación satelital',
    value: available ? executiveDescription : 'Datos insuficientes',
    date: layerConfig.displayTimeMode === 'wms-date' ? (layerConfig.resolvedTime ? formatDate(layerConfig.resolvedTime) : 'Datos insuficientes') : (layerConfig.acquiredAt ? formatApiDateTime(layerConfig.acquiredAt) : (layerConfig.resolvedTime ? formatDate(layerConfig.resolvedTime) : 'Datos insuficientes')),
    location: 'Área de Corrientes intersectada por la escena',
    status: available ? executiveDescription : 'Datos insuficientes',
    context: available ? 'La imagen evidencia áreas con agua superficial dentro del área visualizada.' : 'No hay información suficiente para interpretar la imagen seleccionada.',
    updated: layerConfig.displayTimeMode === 'wms-date' ? (layerConfig.resolvedTime || '') : (layerConfig.acquiredAt || layerConfig.resolvedTime || '')
  });
}

function renderClimateExternalLegend(layerConfig) {
  const element = $('climateExternalLegend');
  if (!element) return;
  if (!layerConfig) {
    element.hidden = true;
    element.innerHTML = '';
    return;
  }
  const method = 'Naturaleza: satelital · disponibilidad: capa remota con metadatos en respaldo local. No se convierte en estaciones ni en una estimación de hectáreas.';
  const legendUrls = Array.isArray(layerConfig.legendUrls) ? layerConfig.legendUrls : (layerConfig.legendUrl ? [layerConfig.legendUrl] : []);
  const images = layerConfig.hideLegendImage ? '' : legendUrls.map((url, index) => `<img src="${escapeHtml(url)}" alt="Leyenda ${index + 1} de ${escapeHtml(layerConfig.shortLabel || layerConfig.label)}">`).join('');
  const items = Array.isArray(layerConfig.legendItems) ? `<div class="climate-raster-legend-items">${layerConfig.legendItems.map(item => `<span class="legend-${escapeHtml(item.emphasis || 'secondary')}"><i style="--legend-color:${escapeHtml(item.color)}"></i>${escapeHtml(item.label)}</span>`).join('')}</div>` : '';
  const guideByLayer = {
    operaS1: 'Extensión dinámica de agua superficial derivada de radar Sentinel-1.',
    nasaViirsFlood: 'Agua superficial e inundación combinada de los últimos 3 días.',
    gfmObservedFlood: 'Extensión observada por el Global Flood Monitoring de Copernicus.'
  };
  const floodGuide = guideByLayer[layerConfig.id] || method;
  const date = layerConfig.displayTimeMode !== 'wms-date' && layerConfig.acquiredAt
    ? ` · escena ${formatApiDateTime(layerConfig.acquiredAt)}`
    : (layerConfig.resolvedTime ? ` · fecha ${formatDate(layerConfig.resolvedTime)}` : ' · fecha no verificada');
  const scene = layerConfig.sceneId ? ` · ID ${layerConfig.sceneId}` : '';
  const resolution = ` · resolución ${layerConfig.spatialResolution || 'Datos insuficientes'}`;
  const sufficiency = layerConfig.available === false || !layerConfig.resolvedTime ? ' Datos insuficientes para verificar una escena vigente.' : '';
  element.innerHTML = `<strong>${escapeHtml(layerConfig.label)}</strong>${items}${images}<small>${escapeHtml(floodGuide + date + scene + resolution)}<br>${escapeHtml(method)} La escena intersecta el área de Corrientes, pero eso no garantiza cobertura provincial completa.${escapeHtml(sufficiency)}</small>`;
  element.hidden = false;
}

function climatePointBoundaryStyle(feature) {
  const department = normalizeClimateDepartment(feature?.properties?.department || feature?.properties?.officialName);
  const selected = state.climateMap.selectedDepartment === department;
  const overSatellite = state.climateMap.activeHydrologyLayer !== 'none';
  return {
    className: 'climate-boundary',
    color: selected ? '#063f47' : (overSatellite ? '#334d4a' : '#5d716d'),
    weight: selected ? 3.2 : (overSatellite ? 1.8 : 1.15),
    opacity: selected ? 1 : (overSatellite ? 0.95 : 0.72),
    fillColor: '#dfe9e5',
    fillOpacity: selected ? 0.04 : 0,
    lineCap: 'round',
    lineJoin: 'round'
  };
}

function climateStatusForFeature(feature) {
  const department = normalizeClimateDepartment(feature?.properties?.department || feature?.properties?.officialName);
  return state.climateMap.statuses.get(department) || null;
}

function climateDepartmentStyle(feature) {
  const department = normalizeClimateDepartment(feature?.properties?.department || feature?.properties?.officialName);
  const status = climateStatusForFeature(feature);
  const selected = state.climateMap.selectedDepartment === department;
  return {
    color: selected ? '#052f3a' : '#315f59',
    weight: selected ? 4.5 : 1.4,
    opacity: 1,
    fillColor: climateMapColor(status?.[state.climateMap.variable], state.climateMap.variable),
    fillOpacity: selected ? 0.93 : 0.8,
    lineCap: 'round',
    lineJoin: 'round'
  };
}

function wireClimateMapFeature(feature, layer) {
  const department = normalizeClimateDepartment(feature?.properties?.department || feature?.properties?.officialName);
  layer.bindTooltip(() => climateMapTooltip(department), { sticky: true, direction: 'top' });
  layer.on({
    mouseover: () => {
      const selected = state.climateMap.selectedDepartment === department;
      layer.setStyle({
        color: selected ? '#052f3a' : '#087d94',
        weight: selected ? 5 : 3.25,
        fillOpacity: state.climateMap.mode === 'departments' ? 0.95 : 0.06
      });
      layer.bringToFront();
    },
    mouseout: () => {
      layer.setStyle(state.climateMap.mode === 'departments' ? climateDepartmentStyle(feature) : climatePointBoundaryStyle(feature));
      bringSelectedClimateDepartmentToFront();
    },
    click: () => selectClimateDepartment(department)
  });
}

function fitClimateMapToCorrientes() {
  if (!state.climateMap.map || !state.climateMap.geoLayer) return;
  const bounds = state.climateMap.geoLayer.getBounds();
  state.climateMap.map.setMinZoom(6);
  state.climateMap.map.fitBounds(bounds, { padding: [2, 2], animate: false });
  state.climateMap.map.setMinZoom(state.climateMap.map.getZoom());
  state.climateMap.map.setMaxBounds(bounds.pad(0.12));
}

function selectClimateDepartment(department) {
  const normalized = normalizeClimateDepartment(department);
  state.climateMap.selectedDepartment = normalized;
  state.climateMap.geoLayer?.setStyle(state.climateMap.mode === 'departments' ? climateDepartmentStyle : climatePointBoundaryStyle);
  bringSelectedClimateDepartmentToFront();
  const status = state.climateMap.statuses.get(normalized) || { department: normalized };
  if (state.climateMap.mode === 'departments') renderClimateDepartmentDetail(status);
  else renderMapPointDetail({
    title: normalized,
    intro: 'Contorno departamental utilizado como referencia espacial para las capas puntuales.',
    source: 'Base departamental local',
    nature: 'Referencia territorial',
    availability: 'Respaldo local',
    type: 'Contorno de referencia',
    value: Number.isFinite(status.rain7dMm) ? `${format(status.rain7dMm)} mm en 7 días` : 'Sin dato agregado',
    date: status.referenceDateDaily ? formatDate(status.referenceDateDaily) : 'Sin fecha',
    location: 'Departamento de Corrientes',
    id: normalized,
    status: status.monthlyCategory || 'Contexto territorial',
    context: 'El indicador agregado no reemplaza ni resume las mediciones puntuales visibles.',
    updated: status.updatedAt ? formatClimateUpdatedAt(status.updatedAt) : 'Base local'
  });
  updateClimateViewUrl();
}

function bringSelectedClimateDepartmentToFront() {
  if (!state.climateMap.geoLayer || !state.climateMap.selectedDepartment) return;
  state.climateMap.geoLayer.eachLayer(layer => {
    const department = normalizeClimateDepartment(layer.feature?.properties?.department || layer.feature?.properties?.officialName);
    if (department === state.climateMap.selectedDepartment) layer.bringToFront();
  });
}

function syncClimateMapWithGlobalFilter(currentFilters = filters()) {
  if (!state.climateMap.geoLayer) return;
  if (currentFilters.departments?.length === 1) {
    selectClimateDepartment(currentFilters.departments[0]);
    return;
  }
  clearClimateDepartmentSelection();
}

function clearClimateDepartmentSelection() {
  state.climateMap.selectedDepartment = null;
  state.climateMap.geoLayer?.setStyle(state.climateMap.mode === 'departments' ? climateDepartmentStyle : climatePointBoundaryStyle);
  if (state.climateMap.mode !== 'departments') return;
  if ($('mapDetailDepartment')) $('mapDetailDepartment').textContent = 'Seleccione un departamento para ver detalle';
  ['mapDetailDailyDate','mapDetailLastRain','mapDetailRain7','mapDetailRain15','mapDetailRain30','mapDetailCoverage','mapDetailMonthlyReference','mapDetailMonthlyObserved','mapDetailMonthlyHistorical','mapDetailMonthlyDifference','mapDetailMonthlyDifferencePct','mapDetailMonthlyCategory','mapDetailSource','mapDetailUpdated']
    .forEach(id => { if ($(id)) $(id).textContent = '—'; });
  updateClimateDepartmentReference();
}

function climateMapTooltip(department) {
  if (state.climateMap.mode !== 'departments') return `<strong>${escapeHtml(department)}</strong><br>Contorno departamental de referencia`;
  const status = state.climateMap.statuses.get(department);
  const variable = CLIMATE_MAP_VARIABLES[state.climateMap.variable];
  return `<strong>${escapeHtml(department)}</strong><br>${escapeHtml(variable.label)}: ${escapeHtml(formatClimateMapValue(status?.[state.climateMap.variable], state.climateMap.variable))}`;
}

function refreshClimateDepartmentMap() {
  if (!state.climateMap.geoLayer || state.climateMap.mode !== 'departments') return;
  state.climateMap.geoLayer.setStyle(climateDepartmentStyle);
  state.climateMap.geoLayer.eachLayer(layer => {
    const department = normalizeClimateDepartment(layer.feature?.properties?.department || layer.feature?.properties?.officialName);
    layer.setTooltipContent(climateMapTooltip(department));
  });
  renderClimateDepartmentLegend();
  updateClimateDepartmentReference();
  bringSelectedClimateDepartmentToFront();
}

function climateMapColor(value, variableKey) {
  if (value === null || value === undefined || value === '' || (typeof value === 'number' && !Number.isFinite(value))) return CLIMATE_MAP_NEUTRAL;
  const scale = CLIMATE_MAP_VARIABLES[variableKey]?.scale;
  if (scale === 'category') return ({
    'Muy por debajo': '#b88955', 'Por debajo': '#dfbd83', 'En torno al promedio': '#e7e4cf',
    'Por encima': '#8ac7ba', 'Muy por encima': '#2f8876', 'Sin referencia': CLIMATE_MAP_NEUTRAL
  })[value] || CLIMATE_MAP_NEUTRAL;
  const number = Number(value);
  if (!Number.isFinite(number)) return CLIMATE_MAP_NEUTRAL;
  if (scale === 'difference') {
    if (number <= -30) return '#b88955';
    if (number <= -10) return '#dfbd83';
    if (number < 10) return '#e7e4cf';
    if (number < 30) return '#8ac7ba';
    return '#2f8876';
  }
  if (number === 0) return '#edf4f2';
  if (number <= 10) return '#d5ebec';
  if (number <= 30) return '#acd7dc';
  if (number <= 60) return '#70bcc6';
  if (number <= 100) return '#3194a6';
  return '#08677d';
}

function climateLegendItems(variableKey) {
  const scale = CLIMATE_MAP_VARIABLES[variableKey]?.scale;
  if (scale === 'category') return [['#b88955','Muy por debajo'],['#dfbd83','Por debajo'],['#e7e4cf','En torno al promedio'],['#8ac7ba','Por encima'],['#2f8876','Muy por encima'],[CLIMATE_MAP_NEUTRAL,'Sin referencia']];
  if (scale === 'difference') return [['#b88955','≤ −30 %'],['#dfbd83','−29,9 a −10 %'],['#e7e4cf','−9,9 a 9,9 %'],['#8ac7ba','10 a 29,9 %'],['#2f8876','≥ 30 %'],[CLIMATE_MAP_NEUTRAL,'Sin dato']];
  return [['#edf4f2','0 mm'],['#d5ebec','0,1 a 10 mm'],['#acd7dc','10,1 a 30 mm'],['#70bcc6','30,1 a 60 mm'],['#3194a6','60,1 a 100 mm'],['#08677d','Más de 100 mm'],[CLIMATE_MAP_NEUTRAL,'Sin dato']];
}

function renderClimateDepartmentLegend() {
  const legend = $('climateMapLegend');
  if (!legend || state.climateMap.mode !== 'departments') return;
  const variable = CLIMATE_MAP_VARIABLES[state.climateMap.variable];
  legend.innerHTML = `<strong>${escapeHtml(variable.label)}</strong>${climateLegendItems(state.climateMap.variable).map(([color, label]) => `<span class="climate-legend-row"><i class="climate-legend-swatch" style="--legend-color:${color}"></i>${escapeHtml(label)}</span>`).join('')}`;
}

function updateClimateDepartmentReference() {
  const statuses = [...state.climateMap.statuses.values()];
  const selected = state.climateMap.statuses.get(state.climateMap.selectedDepartment) || null;
  const dailyReference = selected?.referenceDateDaily || statuses.find(status => status.referenceDateDaily)?.referenceDateDaily;
  const variable = CLIMATE_MAP_VARIABLES[state.climateMap.variable];
  const reference = variable.scale === 'rain'
    ? `Fecha diaria de referencia: ${dailyReference ? formatClimateReferenceDate(dailyReference) : 'Sin dato'} · ${statuses.length} departamentos en la base diaria`
    : `Referencia mensual: ${selected?.monthlyReference || 'último mes disponible por departamento'}`;
  if ($('climateMapReference')) $('climateMapReference').textContent = reference;
}

function renderClimateDepartmentDetail(status) {
  const values = {
    mapDetailDepartment: status.department || 'Sin dato', mapDetailDailyDate: status.referenceDateDaily ? formatDate(status.referenceDateDaily) : 'Sin dato',
    mapDetailLastRain: formatClimateMm(status.rainLastDateMm), mapDetailRain7: formatClimateMm(status.rain7dMm), mapDetailRain15: formatClimateMm(status.rain15dMm), mapDetailRain30: formatClimateMm(status.rain30dMm),
    mapDetailCoverage: [status.coverage7d, status.coverage15d, status.coverage30d].every(Boolean) ? `${status.coverage7d} · ${status.coverage15d} · ${status.coverage30d}` : 'Sin dato',
    mapDetailMonthlyReference: status.monthlyReference || 'Sin dato', mapDetailMonthlyObserved: formatClimateMm(status.monthlyObservedMm), mapDetailMonthlyHistorical: formatClimateMm(status.monthlyHistoricalAvgMm),
    mapDetailMonthlyDifference: formatClimateSigned(status.monthlyDifferenceMm, 'mm'), mapDetailMonthlyDifferencePct: formatClimateSigned(status.monthlyDifferencePct, '%'), mapDetailMonthlyCategory: status.monthlyCategory || 'Sin dato',
    mapDetailSource: status.sourceDaily || status.sourceMonthly ? `Diaria: ${status.sourceDaily || 'Sin dato'} · Mensual: ${status.sourceMonthly || 'Sin dato'}` : 'Sin dato', mapDetailUpdated: formatDailyDatasetUpdatedAt(state.dailyGeneratedAt)
  };
  Object.entries(values).forEach(([id, value]) => { if ($(id)) $(id).textContent = value; });
  updateClimateDepartmentReference();
}

function formatClimateMapValue(value, variableKey) {
  if (value === null || value === undefined || value === '' || (typeof value === 'number' && !Number.isFinite(value))) return 'Sin dato';
  if (CLIMATE_MAP_VARIABLES[variableKey]?.scale === 'category') return String(value);
  const unit = CLIMATE_MAP_VARIABLES[variableKey]?.unit || '';
  return `${format(Number(value))}${unit ? ` ${unit}` : ''}`;
}

function formatClimateSigned(value, unit) {
  if (!Number.isFinite(value)) return 'Sin dato';
  return `${value > 0 ? '+' : ''}${format(value)} ${unit}`;
}

function formatClimateReferenceDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function renderMapPointDetail(detail, action = null) {
  if (detail.presentationType !== 'ina-height') {
    state.climateMap.inaHistory.selectionToken += 1;
    destroyInaHydrometryChart();
  }
  sourceAudit.selectedId = detail.sourceId || ({'Apps Script · registro de lluvias':'rain','GEOGLOWS–ECMWF':'geoglows'}[detail.source]) || (String(detail.source || '').includes('NASA POWER') ? 'nasa' : String(detail.source || '').includes('SNIH') ? 'snih' : String(detail.source || '').includes('Salto') ? 'salto' : String(detail.source || '').includes('INA') ? 'ina' : sourceAudit.selectedId);
  if ($('mapPointDetailTitle')) $('mapPointDetailTitle').textContent = detail.title || 'Información seleccionada';
  const kind = detail.presentationType || (detail.nature === 'Satelital' ? 'satellite' : String(detail.nature || '').includes('Modelado') ? 'forecast' : 'station');
  if ($('mapPointDetailEyebrow')) $('mapPointDetailEyebrow').textContent = ({ rain: 'Precipitaciones', forecast: 'Modelos y pronósticos', satellite: 'Observación satelital', station: 'Hidrometría', 'ina-height': 'Hidrometría' })[kind] || 'Información seleccionada';
  let rows;
  if (kind === 'rain') {
    const territorial = state.climateMap.statuses.get(normalizeClimateDepartment(detail.department)) || {};
    rows = [['Lluvia registrada', detail.value], ['Acumulado 7 días', formatClimateMm(territorial.rain7dMm)], ['Acumulado 30 días', formatClimateMm(territorial.rain30dMm)], ['Última actualización', detail.updated || detail.date]];
  } else if (kind === 'satellite') {
    rows = [['Qué muestra esta capa', detail.value || detail.status], ['Fecha', detail.date], ['Fuente', detail.source], ['Observación', detail.context]];
  } else if (kind === 'forecast') {
    rows = [['Fuente', detail.source], ['Tendencia esperada', detail.value || detail.status], ['Horizonte temporal', detail.date]];
  } else {
    rows = [['Fuente', detail.source], ['Valor observado', detail.value], ['Fecha / hora', detail.date], ['Tendencia', detail.status || 'Sin tendencia disponible']];
  }
  if ($('mapPointOperationalDetail')) $('mapPointOperationalDetail').innerHTML = `<dl class="climate-detail-list climate-point-detail-list">${rows.map(([label, value], index) => `<div class="${index === rows.length - 1 ? 'climate-detail-wide' : ''}"><dt>${escapeHtml(label)}</dt><dd${label.startsWith('Tendencia') ? ' id="mapPointDetailStatus"' : ''}>${escapeHtml(value || 'Sin dato')}</dd></div>`).join('')}</dl>`;
  const button = $('mapPointDetailAction');
  state.climateMap.detailAction = action?.handler || null;
  if (button) {
    button.hidden = !action;
    button.textContent = action?.label || '';
    button.onclick = action ? async () => {
      button.disabled = true;
      try {
        await action.handler();
      } catch (error) {
        console.warn(`No se pudo completar la consulta del punto: ${error.message}`);
      } finally {
        button.disabled = false;
      }
    } : null;
  }
  scheduleClimateMapInvalidate();
}

function latestDateForSource(source) {
  return (state.climateMap.pointData.get(source) || []).reduce((latest, point) => point.date > latest ? point.date : latest, '');
}

function normalizeSourceKey(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function pointDistanceSquared(a, b) {
  return ((Number(a.lat) - Number(b.lat)) ** 2) + ((Number(a.lng ?? a.lon) - Number(b.lng ?? b.lon)) ** 2);
}

function formatCoordinate(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(4) : 'Sin coordenada';
}

function showClimateMapMessage(message, timeoutMs = 4500) {
  const element = $('climateMapMessage');
  if (!element) return;
  element.textContent = message;
  element.hidden = false;
  if (timeoutMs > 0) setTimeout(() => { element.hidden = true; }, timeoutMs);
}

function normalizeMonthlyComparisonYears(changedId) {
  const base = $('monthlyBaseYear');
  const compared = $('monthlyCompareYear');
  if (base.value !== compared.value) return;
  const target = changedId === 'monthlyBaseYear' ? compared : base;
  const alternative = [...target.options].find(option => option.value !== base.value);
  if (alternative) target.value = alternative.value;
}

// La referencia histórica diaria tiene un alcance temporal propio: siempre usa
// toda la base combinada (o su respaldo operativo) y solo responde al filtro de
// Departamento. Año y Mes pertenecen al análisis mensual y no recortan esta base.
function validDailyReferenceRecords(f = filters()) {
  return state.dailyRecords
    .filter(record =>
      record.date &&
      record.department &&
      Number.isFinite(record.rainfallMm) &&
      matchesSelection(record.department, f.departments)
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.department.localeCompare(b.department, 'es'));
}

function dailyCalendarParts(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: DAILY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month) - 1,
    day: Number(parts.day),
    isoDate: `${parts.year}-${parts.month}-${parts.day}`
  };
}

function dailyReferenceDate(f, today = new Date()) {
  const current = dailyCalendarParts(today);
  const selectedYear = f.years?.length ? Math.max(...f.years) : current.year;
  const selectedMonth = f.months?.length ? Math.max(...f.months) : null;
  if (selectedYear === current.year && (selectedMonth === null || selectedMonth === current.month)) return current.isoDate;
  if (selectedMonth !== null) {
    return `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-${String(daysInMonth(selectedYear, selectedMonth)).padStart(2, '0')}`;
  }
  return `${selectedYear}-12-31`;
}

function dailyScopeDepartments(f, includeAll = false) {
  const departments = state.metadata.departments || [];
  return includeAll || f.departments === null
    ? [...departments]
    : departments.filter(department => f.departments.includes(department));
}

function renderDaily(f, today = new Date()) {
  const records = validDailyRecords(f);
  const referenceRecords = validDailyReferenceRecords(f);
  const referenceDate = dailyReferenceDate(f, today);
  const departments = dailyScopeDepartments(f);
  const selectedWindow = +$('dailyWindowFilter').value || 7;
  const rows = dailyOperationalRows(records, referenceDate, departments);
  const selectedRows = rows.filter(row => row.windows[selectedWindow] > 0);
  const sortDirection = $('dailySortFilter')?.value === 'asc' ? 1 : -1;
  const rankingRows = [...rows].sort((a, b) => sortDirection * (a.windows[selectedWindow] - b.windows[selectedWindow]) || a.department.localeCompare(b.department, 'es'));
  const matrixRows = sortDailyMatrixRows(rows, $('dailyMatrixSortFilter')?.value || '7');
  const topDepartment = selectedRows.length ? [...selectedRows].sort((a, b) => b.windows[selectedWindow] - a.windows[selectedWindow] || a.department.localeCompare(b.department, 'es'))[0] : null;
  const maxRecord = dailyMaxRecord(records, referenceDate, selectedWindow);
  const singleDepartment = f.departments?.length === 1;

  $('dailyLatestDate').textContent = formatDate(referenceDate);
  const sourceLabel = state.dailyDataSource === 'combined' ? 'base diaria combinada' : 'base diaria operativa de respaldo';
  const observed = rows.reduce((sum, row) => sum + row.observations[selectedWindow], 0);
  const possible = selectedWindow * rows.length;
  $('dailyCoverage').textContent = `Referencia ${formatDate(referenceDate)} · cobertura real ${observed}/${possible} días-departamento · ${sourceLabel}`;
  updateDailyKpis(rows, referenceDate, topDepartment, maxRecord, selectedWindow, singleDepartment);
  renderDailyHistoricalSignals(referenceRecords, referenceDate, f);
  renderDailySeries(records, referenceDate, f, selectedWindow, departments);
  $('dailyRankingTable').innerHTML = rankingRows.map(row => `
    <tr>
      <td>${row.department}</td>
      <td>${dailyWindowDisplay(row, 7)}</td>
      <td>${dailyWindowDisplay(row, 30)}</td>
      <td>${formatDate(row.lastDate)}</td>
      <td>${formatTableRainfall(row.maxDaily)}</td>
    </tr>`).join('');
  $('dailyTable').innerHTML = matrixRows.map(row => `
    <tr>
      <td>${row.department}</td>
      <td>${formatDate(row.lastDate)}</td>
      <td>${dailyWindowDisplay(row, 1)}</td>
      <td>${dailyWindowDisplay(row, 7)}</td>
      <td>${dailyWindowDisplay(row, 30)}</td>
    </tr>`).join('');
  updateDailyQuickStats(f, today);
}

function dailyOperationalRows(records, referenceDate, departments = [...new Set(records.map(record => record.department))]) {
  return departments.map(department => {
    const departmentRecords = records.filter(record => record.department === department);
    const windows = Object.fromEntries(DAILY_WINDOWS.map(days => [days, dailyWindowTotal(departmentRecords, referenceDate, days)]));
    const observations = Object.fromEntries(DAILY_WINDOWS.map(days => [days, dailyWindowCoverage(departmentRecords, referenceDate, days).daysWithRecords]));
    const recentRecords = dailyWindowRecords(departmentRecords, referenceDate, 30);
    const recordsUntilReference = departmentRecords.filter(record => record.date <= referenceDate);
    const lastRecord = recordsUntilReference[recordsUntilReference.length - 1];
    return {
      department,
      lastDate: lastRecord?.date || null,
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
    const value = rows.length ? (singleDepartment ? rows[0].windows[days] : average(rows.map(row => row.windows[days]))) : null;
    const observed = rows.reduce((sum, row) => sum + row.observations[days], 0);
    const possible = rows.length * days;
    $(id).textContent = Number.isFinite(value) ? `${format(value)} mm` : 'Sin dato';
    $(detailId).textContent = `${singleDepartment ? 'acumulado temporal del departamento seleccionado' : `promedio departamental de acumulados (${rows.length} depto.)`} · cobertura ${observed}/${possible}`;
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
  return `${format(row.windows[days])} mm`;
}

function sortDailyMatrixRows(rows, criterion) {
  const alphabetical = (a, b) => a.department.localeCompare(b.department, 'es');
  if (criterion === 'department') return [...rows].sort(alphabetical);
  if (criterion === 'date') {
    return [...rows].sort((a, b) => {
      const aHasDate = Boolean(a.lastDate);
      const bHasDate = Boolean(b.lastDate);
      if (aHasDate !== bHasDate) return aHasDate ? -1 : 1;
      if (aHasDate && a.lastDate !== b.lastDate) return b.lastDate.localeCompare(a.lastDate);
      return alphabetical(a, b);
    });
  }
  const days = criterion === '30' ? 30 : 7;
  return [...rows].sort((a, b) => {
    if (a.windows[days] !== b.windows[days]) return b.windows[days] - a.windows[days];
    return alphabetical(a, b);
  });
}

function updateClimateDailyStatuses(f, today = new Date()) {
  if (!state.metadata.departments?.length) return;
  const referenceDate = dailyReferenceDate(f, today);
  const records = validDailyReferenceRecords({ ...f, departments: null });
  const rows = dailyOperationalRows(records, referenceDate, dailyScopeDepartments(f, true));
  rows.forEach(row => {
    const key = normalizeClimateDepartment(row.department);
    const previous = state.climateMap.statuses.get(key) || { department: row.department };
    state.climateMap.statuses.set(key, {
      ...previous,
      department: row.department,
      referenceDateDaily: referenceDate,
      rainLastDateMm: row.windows[1],
      rain7dMm: row.windows[7],
      coverage7d: `${row.observations[7]}/7`,
      rain15dMm: row.windows[15],
      coverage15d: `${row.observations[15]}/15`,
      rain30dMm: row.windows[30],
      coverage30d: `${row.observations[30]}/30`,
      sourceDaily: `${state.dailyDataSource === 'combined' ? 'rainfall-daily-combined' : 'rainfall-daily'} · cálculo operativo en memoria`
    });
  });
  const selected = state.climateMap.statuses.get(state.climateMap.selectedDepartment);
  if (selected && $('mapDetailDepartment')) renderClimateDepartmentDetail(selected);
}

function renderDailySeries(records, latestDate, f, selectedWindow, departments = dailyScopeDepartments(f)) {
  const windowDays = Number.isFinite(selectedWindow) && selectedWindow > 0 ? selectedWindow : 30;
  const startDate = addDays(latestDate, 1 - windowDays);
  const seriesRecords = records.filter(record => record.date >= startDate && record.date <= latestDate);
  const dates = Array.from({ length: windowDays }, (_, index) => addDays(startDate, index));
  const singleDepartment = f.departments?.length === 1;
  const values = dates.map(date => {
    const dayRecords = seriesRecords.filter(record => record.date === date);
    if (singleDepartment) return dayRecords[0]?.rainfallMm ?? 0;
    const valuesByDepartment = new Map(dayRecords.map(record => [record.department, record.rainfallMm]));
    return departments.length ? average(departments.map(department => valuesByDepartment.get(department) ?? 0)) : 0;
  });
  $('dailySeriesDescription').textContent = singleDepartment
    ? 'Lluvia diaria operativa del departamento seleccionado. Las fechas sin registro se calculan como 0 mm en memoria; la cobertura conserva solo observaciones reales.'
    : 'Promedio departamental diario operativo sobre todos los departamentos seleccionados. Las fechas sin registro se calculan como 0 mm en memoria.';
  chart('dailySeriesChart', 'bar', {
    labels: dates.map(formatShortDate),
    datasets: [dataset(singleDepartment ? 'Lluvia diaria departamental' : 'Promedio departamental diario', values, COLORS[0], false, 'mm')]
  }, barOptions('mm', false, false, 'Lluvia diaria (mm)'));
}

// Ventana inclusiva y acumulativa: [fecha de referencia - (dias - 1), fecha de referencia].
// Los acumulados operativos equivalen a una grilla completa con 0 mm para los
// registros departamento-fecha ausentes. La cobertura cuenta solo fechas reales.
function dailyWindowRecords(records, latestDate, days) {
  const startDate = addDays(latestDate, 1 - days);
  return records.filter(record => record.date >= startDate && record.date <= latestDate);
}

function dailyWindowGrid(records, referenceDate, days) {
  const startDate = addDays(referenceDate, 1 - days);
  const byDate = new Map(dailyWindowRecords(records, referenceDate, days).map(record => [record.date, record.rainfallMm]));
  return Array.from({ length: days }, (_, index) => {
    const date = addDays(startDate, index);
    return { date, rainfallMm: byDate.get(date) ?? 0, observed: byDate.has(date) };
  });
}

function dailyWindowTotal(records, latestDate, days) {
  return dailyWindowGrid(records, latestDate, days).reduce((sum, record) => sum + record.rainfallMm, 0);
}

function dailyWindowCoverage(records, latestDate, days) {
  const dates = new Set(dailyWindowRecords(records, latestDate, days).map(record => record.date));
  return { daysWithRecords: dates.size, daysInWindow: days };
}

// Referencia de la misma ventana calendario. Solo conserva años con al menos
// 70% de cobertura y no completa fechas ausentes con 0 mm.
function dailyHistoricalWindowReference(records, department, referenceDate, days) {
  const [referenceYear, month, day] = referenceDate.split('-').map(Number);
  const departmentRecords = records.filter(record => record.department === department);
  const years = [...new Set(departmentRecords.map(record => Number(record.date.slice(0, 4))))]
    .filter(year => Number.isInteger(year) && year < referenceYear)
    .sort((a, b) => a - b);
  const comparable = years.flatMap(year => {
    const endDate = isoDateOrNull(year, month, day);
    if (!endDate) return [];
    const windowRecords = dailyWindowRecords(departmentRecords, endDate, days);
    const coverage = dailyWindowCoverage(departmentRecords, endDate, days);
    if (coverage.daysWithRecords < Math.ceil(days * 0.7)) return [];
    return [{
      year,
      accumulatedMm: windowRecords.reduce((sum, record) => sum + record.rainfallMm, 0),
      ...coverage
    }];
  });
  const values = comparable.map(item => item.accumulatedMm);
  return {
    department,
    referenceDate,
    windowDays: days,
    yearsComparable: comparable.map(item => item.year),
    comparable,
    minimumMm: values.length ? Math.min(...values) : null,
    maximumMm: values.length ? Math.max(...values) : null,
    averageMm: values.length ? average(values) : null
  };
}

function renderDailyHistoricalSignals(records, latestDate, f) {
  const container = $('dailyHistoricalSignals');
  const scope = $('dailyReferenceScope');
  if (!container || !scope) return;
  const departments = dailyScopeDepartments(f);
  const selectedDepartments = [...departments].sort((a, b) => a.localeCompare(b, 'es'));
  const sourceLabel = state.dailyDataSource === 'combined' ? 'base diaria combinada' : 'base diaria operativa de respaldo';

  if (!latestDate || !selectedDepartments.length) {
    scope.textContent = 'Sin observaciones para los filtros activos';
    container.innerHTML = DAILY_REFERENCE_WINDOWS.map(days => dailyReferenceCard({
      days,
      periodStart: null,
      periodEnd: null,
      category: 'Referencia insuficiente',
      categoryKey: 'insufficient',
      observedMm: null,
      historicalAverageMm: null,
      differenceMm: null,
      differencePct: null,
      historicalMinimumMm: null,
      historicalMaximumMm: null,
      yearsComparable: [],
      observedDays: 0,
      possibleObservedDays: days,
      departmentsComparable: 0,
      departmentsRequested: selectedDepartments.length,
      singleDepartment: selectedDepartments.length === 1,
      sourceLabel
    })).join('');
    return;
  }

  const signals = DAILY_REFERENCE_WINDOWS.map(days => dailyReferenceSignal(records, selectedDepartments, latestDate, days, sourceLabel));
  const maximumComparableDepartments = Math.max(...signals.map(signal => signal.departmentsComparable));
  scope.textContent = selectedDepartments.length === 1
    ? selectedDepartments[0]
    : `Promedio departamental · hasta ${maximumComparableDepartments} de ${selectedDepartments.length} deptos.`;
  container.innerHTML = signals.map(dailyReferenceCard).join('');
}

function dailyReferenceSignal(records, departments, latestDate, days, sourceLabel) {
  const periodStart = addDays(latestDate, 1 - days);
  const departmentStats = departments.map(department => {
    const departmentRecords = records.filter(record => record.department === department);
    const observedRecords = dailyWindowRecords(departmentRecords, latestDate, days);
    const observedDates = new Set(observedRecords.map(record => record.date));
    const reference = dailyHistoricalWindowReference(records, department, latestDate, days);
    return {
      department,
      observedMm: observedRecords.reduce((sum, record) => sum + record.rainfallMm, 0),
      observedDays: observedDates.size,
      reference
    };
  });
  const comparable = departmentStats.filter(item =>
    item.reference.yearsComparable.length >= MINIMUM_COMPARABLE_YEARS &&
    Number.isFinite(item.reference.averageMm) &&
    item.reference.averageMm > 0
  );
  const observedMm = comparable.length ? average(comparable.map(item => item.observedMm)) : null;
  const historicalAverageMm = comparable.length ? average(comparable.map(item => item.reference.averageMm)) : null;
  const differenceMm = Number.isFinite(observedMm) && Number.isFinite(historicalAverageMm) ? observedMm - historicalAverageMm : null;
  const differencePct = Number.isFinite(differenceMm) && historicalAverageMm > 0 ? differenceMm / historicalAverageMm * 100 : null;
  const yearsComparable = [...new Set(comparable.flatMap(item => item.reference.yearsComparable))].sort((a, b) => a - b);
  const historicalMinimumMm = comparable.length ? average(comparable.map(item => item.reference.minimumMm)) : null;
  const historicalMaximumMm = comparable.length ? average(comparable.map(item => item.reference.maximumMm)) : null;
  const category = classifyDailyReference(differencePct, yearsComparable.length, comparable.length);

  return {
    days,
    periodStart,
    periodEnd: latestDate,
    category: category.label,
    categoryKey: category.key,
    observedMm,
    historicalAverageMm,
    differenceMm,
    differencePct,
    historicalMinimumMm,
    historicalMaximumMm,
    yearsComparable,
    observedDays: comparable.reduce((sum, item) => sum + item.observedDays, 0),
    possibleObservedDays: days * comparable.length,
    departmentsComparable: comparable.length,
    departmentsRequested: departments.length,
    singleDepartment: departments.length === 1,
    sourceLabel
  };
}

function classifyDailyReference(differencePct, yearsComparable, departmentsComparable) {
  if (!Number.isFinite(differencePct) || yearsComparable < MINIMUM_COMPARABLE_YEARS || departmentsComparable < 1) {
    return { label: 'Referencia insuficiente', key: 'insufficient' };
  }
  if (differencePct <= -50) return { label: 'Muy por debajo', key: 'very-low' };
  if (differencePct <= -20) return { label: 'Por debajo', key: 'low' };
  if (differencePct < 20) return { label: 'En torno al promedio', key: 'near' };
  if (differencePct < 50) return { label: 'Por encima', key: 'high' };
  return { label: 'Muy por encima', key: 'very-high' };
}

function dailyReferenceCard(signal) {
  const observed = formatReferenceRainfall(signal.observedMm);
  const historical = formatReferenceRainfall(signal.historicalAverageMm);
  const differencePct = formatSignedPercentage(signal.differencePct);
  const differenceMm = formatSignedRainfall(signal.differenceMm);
  const minimum = formatReferenceRainfall(signal.historicalMinimumMm);
  const maximum = formatReferenceRainfall(signal.historicalMaximumMm);
  const period = signal.periodStart && signal.periodEnd ? `${formatDate(signal.periodStart)} al ${formatDate(signal.periodEnd)}` : 'Sin período disponible';
  const coverage = signal.possibleObservedDays > 0 ? `${signal.observedDays}/${signal.possibleObservedDays}` : '0/0';
  const coverageUnit = signal.singleDepartment ? 'días' : 'días-departamento';
  const departmentDetail = signal.singleDepartment
    ? 'Departamento seleccionado'
    : `${signal.departmentsComparable} de ${signal.departmentsRequested} departamentos comparables`;
  const title = [
    `Período observado: ${period}`,
    `Acumulado observado: ${observed}`,
    `Promedio histórico: ${historical}`,
    `Diferencia: ${differenceMm}`,
    `Diferencia porcentual: ${differencePct}`,
    `Mínimo histórico: ${minimum}`,
    `Máximo histórico: ${maximum}`,
    `Años comparables: ${signal.yearsComparable.length}`,
    `Cobertura observada: ${coverage} ${coverageUnit}`,
    `Fuente: ${signal.sourceLabel}`
  ].join('\n');

  return `
    <article class="daily-reference-card reference-${signal.categoryKey}" title="${escapeAttr(title)}">
      <div class="daily-reference-card-top">
        <span class="daily-reference-window">Últimos ${signal.days} días</span>
        <span class="daily-reference-category">${signal.category}</span>
      </div>
      <div class="daily-reference-main">
        <strong>${observed}</strong>
        <span>acumulado observado</span>
      </div>
      <div class="daily-reference-comparison">
        <div><span>Promedio histórico</span><strong>${historical}</strong></div>
        <div><span>Diferencia</span><strong>${differencePct}</strong></div>
      </div>
      <div class="daily-reference-meta">
        <span><b>${signal.yearsComparable.length}</b> años comparables</span>
        <span><b>${coverage}</b> ${coverageUnit}</span>
      </div>
      <p class="daily-reference-scope">${departmentDetail}</p>
      <details class="daily-reference-details">
        <summary>Ver detalle</summary>
        <dl>
          <div><dt>Período observado</dt><dd>${period}</dd></div>
          <div><dt>Diferencia</dt><dd>${differenceMm} · ${differencePct}</dd></div>
          <div><dt>Rango histórico</dt><dd>${minimum} a ${maximum}</dd></div>
          <div><dt>Cobertura</dt><dd>${coverage} ${coverageUnit}</dd></div>
          <div><dt>Fuente</dt><dd>${signal.sourceLabel}</dd></div>
        </dl>
      </details>
    </article>`;
}

function formatReferenceRainfall(value) {
  return Number.isFinite(value) ? `${format(value)} mm` : '—';
}

function formatSignedRainfall(value) {
  if (!Number.isFinite(value)) return '—';
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${format(value)} mm`;
}

function formatSignedPercentage(value) {
  if (!Number.isFinite(value)) return '—';
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${format(value)}%`;
}

function isoDateOrNull(year, month, day) {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return null;
  return candidate.toISOString().slice(0, 10);
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
  return days === 1 ? 'día de referencia' : `${days} días`;
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

function updateDailyQuickStats(f, today = new Date()) {
  const records = validDailyRecords(f);
  const referenceDate = dailyReferenceDate(f, today);
  const rows = dailyOperationalRows(records, referenceDate, dailyScopeDepartments(f));
  [1, 7, 30].forEach(days => {
    const id = days === 1 ? 'quickRain24' : `quickRain${days}`;
    const value = rows.length ? average(rows.map(row => row.windows[days])) : null;
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
  const comparisonMode = $('monthlyViewMode')?.value === 'comparison';
  $('monthlyComparisonControls')?.classList.toggle('hidden', !comparisonMode);
  $('monthlyComparisonSummary')?.classList.toggle('hidden', !comparisonMode);
  if (comparisonMode) {
    renderMonthlyComparison(f);
    return;
  }
  const months = selectedMonths(f);
  const labels = months.map(month => MONTHS[month]);
  let datasets;
  if (f.departments === null) {
    datasets = [{
      ...dataset('Promedio departamental mensual observado', months.map(month =>
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
    $('monthlyChartDescription').textContent = 'Promedio departamental mensual observado frente al promedio y rango histórico del mismo mes calendario.';
  } else {
    datasets = f.departments.flatMap((department, index) => {
      const departmentRows = rows.filter(row => row.department === department);
      const historicalRows = monthlyRows().filter(row => row.department === department);
      return [
        {
          ...dataset(`${department} - acumulado mensual observado`, months.map(month =>
          averageFinite(departmentRows.map(row => row.months[month]))
          ), '#17a2d4', false, 'mm'),
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
  options.layout = { padding: { top: 8, right: 18, bottom: 4, left: 10 } };
  options.plugins.legend.position = 'top';
  options.plugins.legend.labels.padding = 16;
  $('monthlyChartMethodology').textContent = 'El rango histórico mensual compara cada mes contra los valores mínimos y máximos observados para ese mismo mes calendario en la serie mensual combinada. El tooltip identifica el año de cada extremo. No representa acumulados anuales.';
  chart('monthlyChart', 'bar', { labels, datasets }, options);
}

function renderMonthlyComparison(f) {
  const baseYear = +$('monthlyBaseYear').value;
  const compareYear = +$('monthlyCompareYear').value;
  const months = selectedMonths(f);
  const departments = state.metadata.departments.filter(department => matchesSelection(department, f.departments));
  const comparison = months.map(month => {
    const base = monthlyScopeObservation(departments, baseYear, month);
    const compared = monthlyScopeObservation(departments, compareYear, month);
    const comparable = Number.isFinite(base.value) && Number.isFinite(compared.value);
    const differenceMm = comparable ? compared.value - base.value : null;
    const differencePct = comparable && base.value !== 0 ? (differenceMm / base.value) * 100 : null;
    return {
      month,
      base,
      compared,
      comparable,
      differenceMm,
      differencePct,
      historical: monthlyScopeHistoricalStats(departments, month)
    };
  });
  const comparable = comparison.filter(item => item.comparable);
  const baseTotal = comparable.length ? comparable.reduce((sum, item) => sum + item.base.value, 0) : null;
  const compareTotal = comparable.length ? comparable.reduce((sum, item) => sum + item.compared.value, 0) : null;
  const totalDifference = Number.isFinite(baseTotal) && Number.isFinite(compareTotal) ? compareTotal - baseTotal : null;
  const totalDifferencePct = Number.isFinite(totalDifference) && baseTotal !== 0 ? (totalDifference / baseTotal) * 100 : null;
  const scopeLabel = departments.length === 1 ? departments[0] : `Promedio de ${departments.length} departamentos`;
  const comparisonInfo = comparison.map(item => ({
    baseYear,
    compareYear,
    baseValue: item.base.value,
    compareValue: item.compared.value,
    differenceMm: item.differenceMm,
    differencePct: item.differencePct
  }));
  const historicalData = comparison.map(item => item.comparable ? item.historical.average : null);
  const minimumData = comparison.map(item => item.comparable ? item.historical.min : null);
  const maximumData = comparison.map(item => item.comparable ? item.historical.max : null);
  const datasets = [
    {
      ...dataset(String(baseYear), comparison.map(item => item.comparable ? item.base.value : null), '#607d8b', false, 'mm'),
      sourceInfo: comparison.map(item => item.base.sourceLabel),
      order: 4
    },
    {
      ...dataset(String(compareYear), comparison.map(item => item.comparable ? item.compared.value : null), '#17a2d4', false, 'mm'),
      sourceInfo: comparison.map(item => item.compared.sourceLabel),
      comparisonInfo,
      order: 4
    },
    {
      ...dataset('Promedio histórico', historicalData, '#6f8794', false, 'mm'),
      type: 'line',
      backgroundColor: 'transparent',
      borderDash: [7, 4],
      borderWidth: 2.5,
      pointRadius: 3,
      order: 2
    },
    {
      ...dataset('Mínimo histórico', minimumData, '#2e7d5b', false, 'mm'),
      type: 'line',
      backgroundColor: 'transparent',
      borderDash: [5, 4],
      borderWidth: 3,
      pointRadius: 3,
      extremeYears: comparison.map(item => item.historical.minYears),
      spanGaps: true,
      order: 1
    },
    {
      ...dataset('Máximo histórico', maximumData, '#c34f59', false, 'mm'),
      type: 'line',
      backgroundColor: 'transparent',
      borderDash: [5, 4],
      borderWidth: 3,
      pointRadius: 3,
      extremeYears: comparison.map(item => item.historical.maxYears),
      spanGaps: true,
      order: 1
    }
  ];
  const options = barOptions('mm', false, true, 'Precipitación mensual comparable (mm)');
  options.interaction = { mode: 'index', intersect: false };
  options.layout = { padding: { top: 8, right: 18, bottom: 4, left: 10 } };
  options.plugins.legend.position = 'top';
  options.plugins.legend.labels.padding = 16;
  $('monthlyChartScope').textContent = scopeLabel;
  $('monthlyChartDescription').textContent = `${baseYear} y ${compareYear} se muestran por separado; el promedio histórico es una referencia independiente.`;
  $('monthlyChartMethodology').textContent = `La comparación utiliza únicamente meses calendario cerrados con datos en ambos años. Los acumulados resumen exactamente esos mismos meses; los faltantes no se imputan como 0 mm. El rango histórico se calcula para el alcance territorial seleccionado y el tooltip identifica el año de cada extremo.`;
  renderMonthlyComparisonSummary({ baseYear, compareYear, comparable, requestedMonths: months.length, baseTotal, compareTotal, totalDifference, totalDifferencePct });
  chart('monthlyChart', 'bar', { labels: months.map(month => MONTHS[month]), datasets }, options);
}

function monthlyScopeObservation(departments, year, month) {
  const today = new Date();
  if (year === today.getFullYear() && month >= today.getMonth()) {
    return { value: null, departments: 0, sourceLabel: 'mes calendario no cerrado' };
  }
  const rows = monthlyRows().filter(row => row.year === year && departments.includes(row.department) && Number.isFinite(row.months[month]));
  return {
    value: averageFinite(rows.map(row => row.months[month])),
    departments: rows.length,
    sourceLabel: monthlyObservationSourceLabel(rows, month)
  };
}

function monthlyScopeHistoricalStats(departments, month) {
  const years = [...new Set(monthlyRows().map(row => row.year))].sort((a, b) => a - b);
  const observations = years.map(year => ({ year, value: monthlyScopeObservation(departments, year, month).value }))
    .filter(item => Number.isFinite(item.value));
  if (!observations.length) return { min: null, max: null, average: null, minYears: [], maxYears: [] };
  const values = observations.map(item => item.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return {
    min,
    max,
    average: average(values),
    minYears: observations.filter(item => item.value === min).map(item => item.year),
    maxYears: observations.filter(item => item.value === max).map(item => item.year)
  };
}

function renderMonthlyComparisonSummary(summary) {
  const element = $('monthlyComparisonSummary');
  if (!element) return;
  const coverage = `${summary.comparable.length} de ${summary.requestedMonths} meses`;
  const baseValue = Number.isFinite(summary.baseTotal) ? `${format(summary.baseTotal)} mm` : 'Sin dato';
  const compareValue = Number.isFinite(summary.compareTotal) ? `${format(summary.compareTotal)} mm` : 'Sin dato';
  const difference = Number.isFinite(summary.totalDifference)
    ? `${formatSignedMm(summary.totalDifference)}${Number.isFinite(summary.totalDifferencePct) ? ` (${formatSignedPercent(summary.totalDifferencePct)})` : ''}`
    : 'Sin dato';
  const monthsAbove = summary.comparable.filter(item => item.differenceMm > 0).length;
  element.innerHTML = `
    <div><span>Meses comparables</span><strong>${coverage}</strong></div>
    <div><span>Acumulado ${summary.baseYear}</span><strong>${baseValue}</strong></div>
    <div><span>Acumulado ${summary.compareYear}</span><strong>${compareValue}</strong></div>
    <div><span>Diferencia ${summary.compareYear} vs. ${summary.baseYear}</span><strong>${difference}</strong></div>
    <div><span>${summary.compareYear} supera a ${summary.baseYear}</span><strong>${monthsAbove} de ${summary.comparable.length} meses</strong></div>`;
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
      extremeYears: months.map(month => monthlyHistoricalStats(department, month).minYears),
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
      extremeYears: months.map(month => monthlyHistoricalStats(department, month).maxYears),
      spanGaps: true,
      order: 1
    }
  ];
}

function monthlyHistoricalStats(department, month) {
  const observations = monthlyRows()
    .filter(row => (department === null || row.department === department) && Number.isFinite(row.months[month]))
    .map(row => ({ value: row.months[month], year: row.year }));
  const values = observations.map(item => item.value);
  const min = values.length ? Math.min(...values) : null;
  const max = values.length ? Math.max(...values) : null;
  return {
    min,
    max,
    average: values.length ? average(values) : null,
    minYears: Number.isFinite(min) ? [...new Set(observations.filter(item => item.value === min).map(item => item.year))] : [],
    maxYears: Number.isFinite(max) ? [...new Set(observations.filter(item => item.value === max).map(item => item.year))] : []
  };
}

function renderRanking(rows, f) {
  const requestedMonths = selectedMonths(f);
  const departments = [...new Set(rows.map(row => row.department))];
  const allYearsSelected = f.years === null;
  const entries = departments.map(department => rankingComparableEntry(department, rows, requestedMonths, f.years))
    .filter(entry => Number.isFinite(entry.selected))
    .sort((a,b) => b.selected - a.selected)
    .slice(0, 15);
  const datasets = allYearsSelected
    ? [rankingDataset('Promedio histórico comparable', entries.map(entry => entry.historical), '#7b8790', entries)]
    : [
      rankingDataset('Acumulado período seleccionado', entries.map(entry => entry.selected), COLORS[0], entries),
      rankingDataset('Promedio histórico comparable', entries.map(entry => entry.historical), '#7b8790', entries)
    ];
  const options = barOptions('mm', true, true, 'Precipitación acumulada comparable (mm)');
  options.layout = { padding: { top: 8, right: 24, bottom: 8, left: 12 } };
  options.plugins.tooltip = {
    filter: context => context.datasetIndex === 0,
    callbacks: {
      title: contexts => contexts[0]?.label || '',
      label: context => rankingTooltipLines(context.dataset.rankingMeta?.[context.dataIndex], allYearsSelected)
    }
  };
  chart('rankingChart', 'bar', {
    labels: entries.map(entry => entry.department),
    datasets
  }, options);
}

function rankingComparableEntry(department, filteredRows, requestedMonths, selectedYears) {
  const departmentRows = filteredRows.filter(row => row.department === department);
  const historicalRows = monthlyRows().filter(row => row.department === department);
  if (selectedYears === null) {
    const completeValues = historicalRows
      .filter(row => requestedMonths.every(month => Number.isFinite(row.months[month])))
      .map(row => requestedMonths.reduce((sum, month) => sum + row.months[month], 0));
    const historical = averageFinite(completeValues);
    return {
      department,
      selected: historical,
      historical,
      monthsLabel: requestedMonths.map(month => MONTHS[month]).join(', '),
      historicalYears: completeValues.length,
      differenceMm: 0,
      differencePct: 0
    };
  }

  const comparisons = departmentRows.map(row => {
    const includedMonths = requestedMonths.filter(month => Number.isFinite(row.months[month]));
    if (!includedMonths.length) return null;
    const observed = includedMonths.reduce((sum, month) => sum + row.months[month], 0);
    const comparableHistorical = historicalRows
      .filter(historicalRow => !selectedYears.includes(historicalRow.year))
      .filter(historicalRow => includedMonths.every(month => Number.isFinite(historicalRow.months[month])))
      .map(historicalRow => includedMonths.reduce((sum, month) => sum + historicalRow.months[month], 0));
    return {
      year: row.year,
      includedMonths,
      observed,
      historical: averageFinite(comparableHistorical),
      historicalYears: comparableHistorical.length
    };
  }).filter(Boolean);
  const selected = averageFinite(comparisons.map(comparison => comparison.observed));
  const historical = averageFinite(comparisons.map(comparison => comparison.historical));
  const monthSets = [...new Set(comparisons.map(comparison => comparison.includedMonths.join(',')))];
  const monthsLabel = monthSets.length === 1
    ? comparisons[0].includedMonths.map(month => MONTHS[month]).join(', ')
    : comparisons.map(comparison => `${comparison.year}: ${comparison.includedMonths.map(month => MONTHS[month]).join(', ')}`).join(' | ');
  const differenceMm = Number.isFinite(selected) && Number.isFinite(historical) ? selected - historical : null;
  const differencePct = Number.isFinite(differenceMm) && historical > 0 ? (differenceMm / historical) * 100 : null;
  return {
    department,
    selected,
    historical,
    monthsLabel,
    historicalYears: Math.min(...comparisons.map(comparison => comparison.historicalYears)),
    differenceMm,
    differencePct
  };
}

function rankingDataset(label, values, color, entries) {
  return {
    ...dataset(label, values, color, false, 'mm'),
    rankingMeta: entries
  };
}

function rankingTooltipLines(entry, allYearsSelected) {
  if (!entry) return ['Sin dato'];
  const observedLabel = allYearsSelected ? 'Promedio observado del período' : 'Acumulado observado del período';
  return [
    `Meses incluidos: ${entry.monthsLabel || 'Sin dato'}`,
    `${observedLabel}: ${formatNullable(entry.selected)}`,
    `Promedio histórico comparable: ${formatNullable(entry.historical)}`,
    `Diferencia: ${formatSignedMm(entry.differenceMm)}`,
    `Diferencia porcentual: ${formatSignedPercent(entry.differencePct)}`
  ];
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
      const displayValue = Number.isFinite(value) ? format(value) : '0';
      const titleValue = formatTableRainfall(value);
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
  const years = f.years;
  const months = selectedMonths(f);
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
  if (differencePct < 10) return 'En torno al promedio';
  if (differencePct < 30) return 'Por encima';
  return 'Muy por encima';
}

function getDepartmentMonthlyDeviationRows(f, today = new Date()) {
  const departments = state.metadata.departments.filter(department => matchesSelection(department, f.departments));
  const current = dailyCalendarParts(today);
  return departments.map(department => {
    const latest = getLatestMonthlyPeriodForDepartment(department, f);
    const isCurrentMonth = latest?.year === current.year && latest.month === current.month;
    const observedMm = isCurrentMonth
      ? summaryCurrentMonthFromDaily([department], latest.year, latest.month, current.isoDate).value
      : (latest ? latest.observedMm : null);
    const historicalAverageMm = isCurrentMonth
      ? getCurrentMonthHistoricalAverage(department, current.isoDate)
      : (latest ? getMonthlyHistoricalAverage(department, latest.month) : null);
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
  }).filter(row => Number.isFinite(row.observedMm));
}

function renderDepartmentDetail(rows, f) {
  const sortedRows = sortDepartmentDetailRows(rows, $('departmentDetailSortFilter')?.value || 'absolute-deviation');
  state.tableRows = sortedRows;
  updateDepartmentDetailMethodology(f);
  $('detailsTable').innerHTML = sortedRows.length ? sortedRows.map(row => {
    const period = Number.isInteger(row.latestMonth) && Number.isFinite(row.latestYear) ? `${MONTHS_FULL[row.latestMonth]} ${row.latestYear}` : 'Sin dato';
    return `<tr><td>${row.department}</td><td>${period}</td><td>${formatTableRainfall(row.observedMm)}</td><td>${formatTableRainfall(row.historicalAverageMm)}</td><td>${formatSignedMm(row.differenceMm)}</td><td>${formatSignedPercent(row.differencePct)}</td><td><span class="${deviationClass(row.category)}">${row.category}</span></td></tr>`;
  }).join('') : '<tr><td colspan="7">No hay registros válidos para el período seleccionado.</td></tr>';
}

function sortDepartmentDetailRows(rows, criterion) {
  const compareFinite = (a, b, direction) => {
    const aFinite = Number.isFinite(a);
    const bFinite = Number.isFinite(b);
    if (aFinite !== bFinite) return aFinite ? -1 : 1;
    return aFinite ? direction * (a - b) : 0;
  };
  const categoryOrder = new Map([
    ['Muy por encima', 0],
    ['Por encima', 1],
    ['En torno al promedio', 2],
    ['Normal', 2],
    ['Por debajo', 3],
    ['Muy por debajo', 4],
    ['Sin referencia', 5]
  ]);
  const compare = (a, b) => {
    if (criterion === 'observed-desc') return compareFinite(a.observedMm, b.observedMm, -1);
    if (criterion === 'observed-asc') return compareFinite(a.observedMm, b.observedMm, 1);
    if (criterion === 'difference-positive') return compareFinite(a.differenceMm, b.differenceMm, -1);
    if (criterion === 'difference-negative') return compareFinite(a.differenceMm, b.differenceMm, 1);
    if (criterion === 'category') return (categoryOrder.get(a.category) ?? 99) - (categoryOrder.get(b.category) ?? 99);
    if (criterion === 'latest') return b.latestYear - a.latestYear || b.latestMonth - a.latestMonth;
    if (criterion === 'department') return a.department.localeCompare(b.department, 'es');
    const deviationA = Number.isFinite(a.differencePct) ? Math.abs(a.differencePct) : (Number.isFinite(a.differenceMm) ? Math.abs(a.differenceMm) : null);
    const deviationB = Number.isFinite(b.differencePct) ? Math.abs(b.differencePct) : (Number.isFinite(b.differenceMm) ? Math.abs(b.differenceMm) : null);
    return compareFinite(deviationA, deviationB, -1);
  };
  return [...rows].sort((a, b) => compare(a, b) || a.department.localeCompare(b.department, 'es'));
}

function updateDepartmentDetailMethodology(f) {
  const note = $('departmentDetailMethodology');
  if (!note) return;
  if (f.years === null) {
    note.textContent = 'Con “Todos los años”, la tabla muestra el último registro mensual disponible de cada departamento en toda la base.';
    return;
  }
  const yearLabel = [...f.years].sort((a, b) => a - b).join(', ');
  note.textContent = `La tabla muestra, para cada departamento, el último registro mensual disponible dentro del año seleccionado (${yearLabel}). Cuando se elige “Año completo”, no representa acumulados anuales: compara el mes de referencia de cada departamento contra su promedio histórico del mismo mes calendario. Los departamentos sin registros en el año seleccionado no se incluyen en la tabla principal.`;
}

function deviationClass(category) {
  const classes = {
    'Muy por debajo': 'deviation-very-low',
    'Por debajo': 'deviation-low',
    'Normal': 'deviation-normal',
    'En torno al promedio': 'deviation-normal',
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

function formatSummaryRainfall(value) {
  return Number.isFinite(value) ? `${format(value)} mm` : 'Sin dato disponible';
}

function formatSummarySignedMm(value) {
  return Number.isFinite(value) ? `${value > 0 ? '+' : ''}${format(value)} mm` : 'Sin dato disponible';
}

function formatTableRainfall(value) {
  return Number.isFinite(value) ? `${format(value)} mm` : '0';
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
  const primary = `${label}: ${format(context.raw)}${unit ? ` ${unit}` : ''}${sourceInfo ? ` (${sourceInfo})` : ''}`;
  const extremeYears = context.dataset.extremeYears?.[context.dataIndex] || [];
  if (extremeYears.length) {
    return [primary, `${extremeYears.length === 1 ? 'Año' : 'Años'}: ${extremeYears.join(', ')}`];
  }
  const comparison = context.dataset.comparisonInfo?.[context.dataIndex];
  if (comparison && Number.isFinite(comparison.differenceMm)) {
    const comparisonLine = `Diferencia ${comparison.compareYear} vs. ${comparison.baseYear}: ${formatSignedMm(comparison.differenceMm)}${Number.isFinite(comparison.differencePct) ? ` (${formatSignedPercent(comparison.differencePct)})` : ''}`;
    return [primary, comparisonLine];
  }
  return primary;
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
