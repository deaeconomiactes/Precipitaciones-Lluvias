const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const MONTHS_FULL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const COLORS = ['#1677a6','#25a9b5','#7667a8','#d9931a','#c34f59','#3d9a6b','#7b8790','#b46a9b'];
const ALL_MONTHS = MONTHS.map((_, index) => index);
const DAILY_WINDOWS = [1, 7, 15, 30];
const DAILY_REFERENCE_WINDOWS = [7, 15, 30];
const MINIMUM_COMPARABLE_YEARS = 3;
const CACHE_VERSION = '20260811-1';
const state = { rainfall: [], monthlyRainfall: [], monthlySourceStats: {}, operationalDailyRecords: [], dailyRecords: [], dailyDataSource: 'operational', stations: [], metadata: {}, charts: {}, tableRows: [], filterConfigs: {}, temporalFiltersExplicit: { years: false, months: false }, climateMetrics: new Set(['temperature','humidity','wind','rain24Total']), climateMap: { map: null, geoLayer: null, resizeObserver: null, statuses: new Map(), stationStatuses: [], selectedDepartment: null, variable: 'rain7dMm' } };
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
    const [rainfall, operationalDailyRecords, combinedDailyResult, stations, metadata] = await Promise.all([
      fetchDataFile('rainfall.json'),
      fetchDataFile('rainfall-daily.json'),
      fetchDataFile('rainfall-daily-combined.json')
        .then(records => ({ records, source: 'combined' }))
        .catch(error => {
          console.warn(`${error.message}. Se usara rainfall-daily.json como respaldo.`);
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
      stations,
      metadata
    });
    state.monthlySourceStats = buildCombinedMonthlyRainfall();
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

const CLIMATE_MAP_VARIABLES = {
  rainLastDateMm: { label: 'Lluvia última fecha', unit: 'mm', scale: 'rain' },
  rain7dMm: { label: 'Acumulado 7 días', unit: 'mm', scale: 'rain' },
  rain15dMm: { label: 'Acumulado 15 días', unit: 'mm', scale: 'rain' },
  rain30dMm: { label: 'Acumulado 30 días', unit: 'mm', scale: 'rain' },
  monthlyDifferencePct: { label: 'Desvío mensual vs histórico', unit: '%', scale: 'difference' },
  monthlyCategory: { label: 'Categoría mensual', unit: '', scale: 'category' }
};

const CLIMATE_MAP_NEUTRAL = '#d8e2df';

function fetchClimateMapData(path, optional = false) {
  const separator = path.includes('?') ? '&' : '?';
  return fetch(`data/${path}${separator}v=${Date.now()}`, { cache: 'no-store' }).then(response => {
    if (optional && response.status === 404) return [];
    if (!response.ok) throw new Error(`No se pudo cargar data/${path}`);
    return response.json();
  }).catch(error => {
    if (optional) {
      console.info(`${error.message}. La capa opcional queda sin datos.`);
      return [];
    }
    throw error;
  });
}

async function initializeClimateMap() {
  const container = $('climateMap');
  if (!container) return;
  try {
    if (typeof L === 'undefined') throw new Error('Leaflet no se encuentra disponible');
    const [statuses, geojson, stationStatuses] = await Promise.all([
      fetchClimateMapData('department-climate-status.json'),
      fetchClimateMapData('geo/corrientes-departamentos.geojson'),
      fetchClimateMapData('stations-climate-status.json', true)
    ]);
    if (!Array.isArray(statuses) || !statuses.length) throw new Error('El archivo departamental no contiene registros');
    if (!geojson || !Array.isArray(geojson.features) || !geojson.features.length) throw new Error('El GeoJSON no contiene departamentos');

    state.climateMap.statuses = new Map(statuses.map(status => [normalizeClimateDepartment(status.department), status]));
    state.climateMap.stationStatuses = Array.isArray(stationStatuses) ? stationStatuses : [];
    state.climateMap.variable = $('climateMapVariable')?.value || 'rain7dMm';
    state.climateMap.map = L.map(container, {
      zoomControl: true,
      minZoom: 6,
      maxZoom: 13,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      scrollWheelZoom: false
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      opacity: 0.55,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(state.climateMap.map);

    state.climateMap.geoLayer = L.geoJSON(geojson, {
      style: climateDepartmentStyle,
      onEachFeature: wireClimateDepartmentFeature
    }).addTo(state.climateMap.map);
    fitClimateMapToCorrientes();

    $('climateMapVariable')?.addEventListener('change', event => {
      state.climateMap.variable = event.target.value;
      refreshClimateMap();
    });
    refreshClimateMap();
    const initialDepartment = state.climateMap.statuses.has('Capital')
      ? 'Capital'
      : geojson.features[0]?.properties?.department;
    if (initialDepartment) selectClimateDepartment(initialDepartment);
    requestAnimationFrame(() => {
      state.climateMap.map.invalidateSize();
      fitClimateMapToCorrientes();
    });
    if ('ResizeObserver' in window) {
      let resizeTimer;
      state.climateMap.resizeObserver = new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          state.climateMap.map.invalidateSize();
          fitClimateMapToCorrientes();
        }, 100);
      });
      state.climateMap.resizeObserver.observe(container);
    }
  } catch (error) {
    showClimateMapMessage('No fue posible cargar la información territorial. El resto del dashboard continúa disponible.');
    $('climateMapReference').textContent = 'Información territorial no disponible';
    console.error(error);
  }
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

function wireClimateDepartmentFeature(feature, layer) {
  const department = normalizeClimateDepartment(feature?.properties?.department || feature?.properties?.officialName);
  layer.bindTooltip(() => climateMapTooltip(department), { sticky: true, direction: 'top' });
  layer.on({
    mouseover: () => {
      const selected = state.climateMap.selectedDepartment === department;
      layer.setStyle({
        weight: selected ? 5 : 3.25,
        color: selected ? '#052f3a' : '#087d94',
        fillOpacity: 0.95
      });
      layer.bringToFront();
    },
    mouseout: () => {
      state.climateMap.geoLayer?.resetStyle(layer);
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

function climateMapTooltip(department) {
  const status = state.climateMap.statuses.get(department);
  const variable = CLIMATE_MAP_VARIABLES[state.climateMap.variable];
  return `<strong>${department}</strong><br>${variable.label}: ${formatClimateMapValue(status?.[state.climateMap.variable], state.climateMap.variable)}`;
}

function refreshClimateMap() {
  if (!state.climateMap.geoLayer) return;
  state.climateMap.geoLayer.setStyle(climateDepartmentStyle);
  state.climateMap.geoLayer.eachLayer(layer => {
    const department = normalizeClimateDepartment(layer.feature?.properties?.department || layer.feature?.properties?.officialName);
    layer.setTooltipContent(climateMapTooltip(department));
  });
  renderClimateMapLegend();
  updateClimateMapReference();
}

function selectClimateDepartment(department) {
  const normalized = normalizeClimateDepartment(department);
  state.climateMap.selectedDepartment = normalized;
  state.climateMap.geoLayer?.setStyle(climateDepartmentStyle);
  bringSelectedClimateDepartmentToFront();
  renderClimateDepartmentDetail(state.climateMap.statuses.get(normalized) || { department: normalized });
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
  state.climateMap.geoLayer?.setStyle(climateDepartmentStyle);
  fitClimateMapToCorrientes();
  $('mapDetailDepartment').textContent = 'Seleccione un departamento para ver detalle';
  [
    'mapDetailDailyDate',
    'mapDetailLastRain',
    'mapDetailRain7',
    'mapDetailRain15',
    'mapDetailRain30',
    'mapDetailCoverage',
    'mapDetailMonthlyReference',
    'mapDetailMonthlyObserved',
    'mapDetailMonthlyHistorical',
    'mapDetailMonthlyDifference',
    'mapDetailMonthlyDifferencePct',
    'mapDetailMonthlyCategory',
    'mapDetailSource',
    'mapDetailUpdated'
  ].forEach(id => { $(id).textContent = '—'; });
  updateClimateMapReference();
}

function climateMapColor(value, variableKey) {
  if (value === null || value === undefined || value === '' || (typeof value === 'number' && !Number.isFinite(value))) return CLIMATE_MAP_NEUTRAL;
  const scale = CLIMATE_MAP_VARIABLES[variableKey]?.scale;
  if (scale === 'category') {
    return {
      'Muy por debajo': '#b88955',
      'Por debajo': '#dfbd83',
      'En torno al promedio': '#e7e4cf',
      'Por encima': '#8ac7ba',
      'Muy por encima': '#2f8876',
      'Sin referencia': CLIMATE_MAP_NEUTRAL
    }[value] || CLIMATE_MAP_NEUTRAL;
  }
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
  if (scale === 'category') return [
    ['#b88955', 'Muy por debajo'],
    ['#dfbd83', 'Por debajo'],
    ['#e7e4cf', 'En torno al promedio'],
    ['#8ac7ba', 'Por encima'],
    ['#2f8876', 'Muy por encima'],
    [CLIMATE_MAP_NEUTRAL, 'Sin referencia']
  ];
  if (scale === 'difference') return [
    ['#b88955', '≤ −30 %'],
    ['#dfbd83', '−29,9 a −10 %'],
    ['#e7e4cf', '−9,9 a 9,9 %'],
    ['#8ac7ba', '10 a 29,9 %'],
    ['#2f8876', '≥ 30 %'],
    [CLIMATE_MAP_NEUTRAL, 'Sin dato']
  ];
  return [
    ['#edf4f2', '0 mm'],
    ['#d5ebec', '0,1 a 10 mm'],
    ['#acd7dc', '10,1 a 30 mm'],
    ['#70bcc6', '30,1 a 60 mm'],
    ['#3194a6', '60,1 a 100 mm'],
    ['#08677d', 'Más de 100 mm'],
    [CLIMATE_MAP_NEUTRAL, 'Sin dato']
  ];
}

function renderClimateMapLegend() {
  const variable = CLIMATE_MAP_VARIABLES[state.climateMap.variable];
  $('climateMapLegend').innerHTML = `<strong>${variable.label}</strong>${climateLegendItems(state.climateMap.variable)
    .map(([color, label]) => `<span class="climate-legend-row"><i class="climate-legend-swatch" style="--legend-color:${color}"></i>${label}</span>`)
    .join('')}`;
}

function updateClimateMapReference() {
  const statuses = [...state.climateMap.statuses.values()];
  const selected = state.climateMap.statuses.get(state.climateMap.selectedDepartment) || null;
  const dailyReference = selected?.referenceDateDaily || statuses.find(status => status.referenceDateDaily)?.referenceDateDaily;
  const variable = CLIMATE_MAP_VARIABLES[state.climateMap.variable];
  const reference = variable.scale === 'rain'
    ? `Fecha diaria de referencia: ${dailyReference ? formatClimateReferenceDate(dailyReference) : 'Sin dato'} · base diaria combinada`
    : `Referencia mensual: ${selected?.monthlyReference || 'último mes disponible por departamento'}`;
  $('climateMapReference').textContent = reference;
}

function renderClimateDepartmentDetail(status) {
  $('mapDetailDepartment').textContent = status.department || 'Sin dato';
  $('mapDetailDailyDate').textContent = status.referenceDateDaily ? formatDate(status.referenceDateDaily) : 'Sin dato';
  $('mapDetailLastRain').textContent = formatClimateMm(status.rainLastDateMm);
  $('mapDetailRain7').textContent = formatClimateMm(status.rain7dMm);
  $('mapDetailRain15').textContent = formatClimateMm(status.rain15dMm);
  $('mapDetailRain30').textContent = formatClimateMm(status.rain30dMm);
  $('mapDetailCoverage').textContent = [status.coverage7d, status.coverage15d, status.coverage30d].every(Boolean)
    ? `${status.coverage7d} · ${status.coverage15d} · ${status.coverage30d}`
    : 'Sin dato';
  $('mapDetailMonthlyReference').textContent = status.monthlyReference || 'Sin dato';
  $('mapDetailMonthlyObserved').textContent = formatClimateMm(status.monthlyObservedMm);
  $('mapDetailMonthlyHistorical').textContent = formatClimateMm(status.monthlyHistoricalAvgMm);
  $('mapDetailMonthlyDifference').textContent = formatClimateSigned(status.monthlyDifferenceMm, 'mm');
  $('mapDetailMonthlyDifferencePct').textContent = formatClimateSigned(status.monthlyDifferencePct, '%');
  $('mapDetailMonthlyCategory').textContent = status.monthlyCategory || 'Sin dato';
  $('mapDetailSource').textContent = status.sourceDaily || status.sourceMonthly
    ? `Diaria: ${status.sourceDaily || 'Sin dato'} · Mensual: ${status.sourceMonthly || 'Sin dato'}`
    : 'Sin dato';
  $('mapDetailUpdated').textContent = formatClimateUpdatedAt(status.updatedAt);
  updateClimateMapReference();
}

function formatClimateMapValue(value, variableKey) {
  if (value === null || value === undefined || value === '' || (typeof value === 'number' && !Number.isFinite(value))) return 'Sin dato';
  if (CLIMATE_MAP_VARIABLES[variableKey]?.scale === 'category') return String(value);
  const unit = CLIMATE_MAP_VARIABLES[variableKey]?.unit || '';
  return `${format(Number(value))}${unit ? ` ${unit}` : ''}`;
}

function formatClimateMm(value) {
  return Number.isFinite(value) ? `${format(value)} mm` : 'Sin dato';
}

function formatClimateSigned(value, unit) {
  if (!Number.isFinite(value)) return 'Sin dato';
  const sign = value > 0 ? '+' : '';
  return `${sign}${format(value)} ${unit}`;
}

function formatClimateUpdatedAt(value) {
  if (!value) return 'Sin dato';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('es-AR');
}

function formatClimateReferenceDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function showClimateMapMessage(message) {
  const element = $('climateMapMessage');
  if (!element) return;
  element.textContent = message;
  element.hidden = false;
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

function renderDaily(f) {
  const records = validDailyRecords(f);
  const referenceRecords = validDailyReferenceRecords(f);
  const referenceLatestDate = referenceRecords.length ? referenceRecords[referenceRecords.length - 1].date : null;
  if (!records.length) {
    $('dailyLatestDate').textContent = '\u2014';
    $('dailyCoverage').textContent = 'Sin observaciones diarias para los filtros activos';
    ['dailyRain24','dailyRain7','dailyRain30','dailyTopDepartment','dailyWetDepartments','dailyMaxRecord'].forEach(id => $(id).textContent = 'Sin dato');
    ['dailyRain24Detail','dailyRain7Detail','dailyRain30Detail','dailyTopDepartmentDetail','dailyWetDepartmentsDetail','dailyMaxRecordDetail'].forEach(id => $(id).textContent = 'sin observaciones');
    $('dailyRankingTable').innerHTML = '';
    $('dailyTable').innerHTML = '<tr><td colspan="5">No hay observaciones diarias para los filtros activos.</td></tr>';
    renderDailyHistoricalSignals(referenceRecords, referenceLatestDate, f);
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
  const matrixRows = sortDailyMatrixRows(rows, $('dailyMatrixSortFilter')?.value || '7');
  const topDepartment = selectedRows.length ? [...selectedRows].sort((a, b) => b.windows[selectedWindow] - a.windows[selectedWindow] || a.department.localeCompare(b.department, 'es'))[0] : null;
  const maxRecord = dailyMaxRecord(records, latestDate, selectedWindow);
  const singleDepartment = f.departments?.length === 1;

  $('dailyLatestDate').textContent = formatDate(latestDate);
  const sourceLabel = state.dailyDataSource === 'combined' ? 'base diaria combinada' : 'base diaria operativa de respaldo';
  $('dailyCoverage').textContent = `${records[0].date} a ${latestDate} - ${records.length} observaciones departamentales (${sourceLabel})`;
  updateDailyKpis(rows, latestDate, topDepartment, maxRecord, selectedWindow, singleDepartment);
  renderDailyHistoricalSignals(referenceRecords, referenceLatestDate, f);
  renderDailySeries(records, latestDate, f, selectedWindow);
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
  return row.observations[days] > 0 ? `${format(row.windows[days])} mm` : formatTableRainfall(null);
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
    const aHasData = a.observations[days] > 0;
    const bHasData = b.observations[days] > 0;
    if (aHasData !== bHasData) return aHasData ? -1 : 1;
    if (aHasData && a.windows[days] !== b.windows[days]) return b.windows[days] - a.windows[days];
    return alphabetical(a, b);
  });
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
  const departments = [...new Set(records.map(record => record.department))].sort((a, b) => a.localeCompare(b, 'es'));
  const selectedDepartments = f.departments?.length ? f.departments.filter(department => departments.includes(department)) : departments;
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
    item.observedDays > 0 &&
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
