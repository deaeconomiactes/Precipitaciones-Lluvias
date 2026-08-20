#!/usr/bin/env node
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');
const rainfallBefore = fs.readFileSync('data/rainfall.json');

for (const id of ['climateFullscreenButton','climateExportPngButton','climateSatelliteOpacity','climateMapLegend','climateSatelliteDate','climateSatelliteDateStatus','climateSatelliteLatestButton']) {
  if (!html.includes(`id="${id}"`)) throw Error(`Falta el control ${id}`);
}
for (const group of ['Registros propios','Hidrometría','Satélite','Modelos','Administrativo (preparado)']) {
  if (!html.includes(`<summary>${group}</summary>`)) throw Error(`Falta el grupo ${group}`);
}
for (const id of ['mapPointDetailTitle','mapPointDetailEyebrow','mapPointOperationalDetail','inaHydrometryDetailCard']) {
  if (!html.includes(`id="${id}"`)) throw Error(`Falta el elemento operativo ${id}`);
}
for (const label of ['Referencia histórica comparable','Diferencia porcentual','Fuente','Fecha','Valor observado','Observación']) {
  if (!app.includes(label)) throw Error(`El panel no contempla ${label}`);
}
if (!app.includes('renderSatelliteLayerDetail') || !app.includes('exportClimateMapPng')) throw Error('Falta una función visible central del visor');
for (const requirement of [
  'https://alerta.ina.gob.ar/pub/datos/datos',
  'seriesId=',
  'timeStart=',
  'timeEnd=',
  'Cargando serie hidrométrica…',
  'No fue posible consultar el histórico en este momento.',
  'El último dato del gráfico puede diferir de la lectura más reciente.',
  'Umbrales publicados por INA / autoridades competentes',
  'Umbrales no disponibles para esta estación.',
  'No hay observaciones suficientes para graficar esta ventana.',
  'Serie observada disponible para la ventana seleccionada.',
  'data-ina-history-window="7d"',
  'data-ina-history-window="30d"',
  'inaHydrometryDetailCard',
  'container.hidden = false',
  'inaHistoryCacheKey(seriesId, windowKey)',
  "if (sourceId === 'ina') renderInaHydrometryPanel(station)"
]) if (!app.includes(requirement)) throw Error(`Falta el requisito del histórico INA: ${requirement}`);
if (!app.includes('ina-series-${seriesClass}')) throw Error('Los marcadores INA no permiten verificar inequívocamente su seriesId.');
for (const requirement of [
  'Evolución de la altura del río',
  "hourCycle: 'h23'",
  "'Última observación · '"
]) if (!app.includes(requirement)) throw Error(`Falta el ajuste UX INA: ${requirement}`);
const inaLayerSource = app.slice(app.indexOf('function renderInaPointLayer'), app.indexOf('function renderPrimaryHeightDetail'));
if (inaLayerSource.includes('bindPopup(')) throw Error('El marcador INA todavía abre un popup Leaflet redundante.');
if (app.includes('.slice(-14)')) throw Error('El visor todavía asume que 14 observaciones equivalen a 7 días.');
if (!app.includes('timeZone: INA_TIME_ZONE') || !app.includes('America/Argentina/Buenos_Aires')) throw Error('El histórico INA no explicita la hora local de Argentina.');
for (const requirement of [
  'function scheduleClimateMapInvalidate',
  'invalidateSize({ pan: false, animate: false })',
  'state.climateMap.resizeObserver = new ResizeObserver(() => scheduleClimateMapInvalidate(100))'
]) if (!app.includes(requirement)) throw Error(`Falta el recálculo controlado de Leaflet: ${requirement}`);
const css = fs.readFileSync('operational.css', 'utf8');
for (const requirement of ['align-items: start', 'isolation: isolate', 'scroll-margin-top:', '.ina-history-chart-wrap canvas', '.ina-hydrometry-card', 'grid-column: 1 / -1', '.ina-quick-indicators']) {
  if (!css.includes(requirement)) throw Error(`Falta el resguardo de layout del mapa: ${requirement}`);
}
const territorialMarkup = html.slice(html.indexOf('id="climateDepartmentDetail"'), html.indexOf('id="climatePointDetail"'));
for (const label of ['Período comparable','Observado del período','Promedio histórico comparable','Mínimo histórico comparable','Máximo histórico comparable','Diferencia','Diferencia porcentual','Actualización de datos']) {
  if (!territorialMarkup.includes(label)) throw Error(`Falta la métrica territorial: ${label}`);
}
for (const removed of ['Categoría descriptiva','<dt>Fuente</dt>','Cobertura 7 / 15 / 30 días']) {
  if (territorialMarkup.includes(removed)) throw Error(`El detalle territorial conserva información secundaria: ${removed}`);
}
for (const requirement of ['function updateClimateDailyStatuses', 'coverage7d: `${row.observations[7]}/7`']) {
  if (!app.includes(requirement)) throw Error(`El mapa no recalcula la lluvia diaria operativa: ${requirement}`);
}
if (!app.includes("fetchDataFile('rainfall-daily-summary.json').catch") || !app.includes('dailyGeneratedAt: typeof dailySummary?.generatedAt')) {
  throw Error('La metadata de actualización diaria no se carga con fallback opcional.');
}
if (!html.includes('<dt>Actualización de datos</dt>')) throw Error('Falta la etiqueta Actualización de datos.');
const territorialDetailSource = app.slice(app.indexOf('function renderClimateDepartmentDetail'), app.indexOf('function formatClimateMapValue'));
if (territorialDetailSource.includes('status.updatedAt') || !territorialDetailSource.includes('state.dailyGeneratedAt')) {
  throw Error('El detalle territorial todavía depende de status.updatedAt.');
}

const detailElements = new Map();
const context = {
  document: {
    addEventListener() {},
    getElementById(id) {
      if (!detailElements.has(id)) detailElements.set(id, { textContent: '' });
      return detailElements.get(id);
    }
  },
  Intl,
  Date,
  Map,
  URLSearchParams,
  console,
  setTimeout,
  clearTimeout
};
vm.createContext(context);
vm.runInContext(app, context);
const timestampChecks = vm.runInContext(`(() => {
  state.climateMap.statuses = new Map();
  const historicalRows = [2023, 2024, 2025].flatMap((year, yearIndex) => Array.from({ length: 18 }, (_, index) => ({
    department: 'Capital',
    date: year + '-08-' + String(index + 1).padStart(2, '0'),
    rainfallMm: yearIndex + 2
  })));
  const observedRows = Array.from({ length: 18 }, (_, index) => ({ department: 'Capital', date: '2026-08-' + String(index + 1).padStart(2, '0'), rainfallMm: 1 }));
  state.dailyRecords = [...historicalRows, ...observedRows];
  state.dailyGeneratedAt = '2026-08-13T10:56:09';
  renderClimateDepartmentDetail({ department: 'Capital', referenceDateDaily: '2026-08-18', updatedAt: '2026-08-11T10:16:18' });
  const loaded = {
    updated: document.getElementById('mapDetailUpdated').textContent,
    period: document.getElementById('mapDetailComparablePeriod').textContent,
    observed: document.getElementById('mapDetailMonthlyObserved').textContent,
    average: document.getElementById('mapDetailMonthlyHistorical').textContent,
    minimum: document.getElementById('mapDetailMonthlyMinimum').textContent,
    maximum: document.getElementById('mapDetailMonthlyMaximum').textContent,
    difference: document.getElementById('mapDetailMonthlyDifference').textContent,
    differencePct: document.getElementById('mapDetailMonthlyDifferencePct').textContent
  };
  state.dailyGeneratedAt = null;
  renderClimateDepartmentDetail({ department: 'Capital', referenceDateDaily: '2026-08-18', updatedAt: '2026-08-11T10:16:18' });
  return {
    ...loaded,
    fallback: document.getElementById('mapDetailUpdated').textContent,
    rainColors: [-40, -20, 0, 20, 40, null].map(rainComparisonColor)
  };
})()`, context);
if (timestampChecks.updated !== '13/08/2026 · 07:56') throw Error(`Formato horario argentino incorrecto: ${timestampChecks.updated}`);
if (timestampChecks.fallback !== 'Actualización no disponible') throw Error(`Fallback incorrecto: ${timestampChecks.fallback}`);
if (timestampChecks.period !== '01/08/2026–18/08/2026') throw Error(`El período comparable es incorrecto: ${timestampChecks.period}`);
if (timestampChecks.observed !== '18 mm' || timestampChecks.average !== '54 mm' || timestampChecks.minimum !== '36 mm' || timestampChecks.maximum !== '72 mm') {
  throw Error(`Los extremos parciales no usan la misma ventana: ${JSON.stringify(timestampChecks)}`);
}
if (timestampChecks.difference !== '-36 mm' || timestampChecks.differencePct !== '-66,7 %') throw Error(`La comparación parcial es incorrecta: ${JSON.stringify(timestampChecks)}`);
if (JSON.stringify(timestampChecks.rainColors) !== JSON.stringify(['#dceefa','#a9d3ef','#5aa7d6','#197bb7','#084f83','#d7dedd'])) throw Error(`La escala azul relativa es incorrecta: ${timestampChecks.rainColors}`);
if (app.includes("element.hidden = true;\n  element.innerHTML = '';\n  return;\n  if (!layerConfig)")) throw Error('La leyenda satelital permanece bloqueada');
const externalLegendSource = app.slice(app.indexOf('function renderClimateExternalLegend'), app.indexOf('function climatePointBoundaryStyle'));
for (const requirement of ["layerConfig.id === 'nasaViirsFlood' || item.emphasis !== 'auxiliary'", 'climate-external-legend-head', 'GFM · inundación observada', 'satelliteLayerDateLabel(layerConfig)']) {
  if (!externalLegendSource.includes(requirement)) throw Error(`La leyenda satelital compacta perdió un dato clave: ${requirement}`);
}
for (const removed of ['layerConfig.sceneId','layerConfig.spatialResolution','legendUrls','Naturaleza: satelital','No se convierte en estaciones']) {
  if (externalLegendSource.includes(removed)) throw Error(`La leyenda satelital conserva detalle técnico: ${removed}`);
}
const externalLegendCss = css.slice(css.indexOf('.climate-external-legend {'), css.indexOf('.climate-map-legend strong'));
if (!externalLegendCss.includes('max-width: 210px') || !externalLegendCss.includes('overflow: hidden') || externalLegendCss.includes('overflow: auto')) throw Error('La leyenda satelital todavía ocupa demasiado espacio o permite scroll interno.');
const satelliteConfig = fs.readFileSync('data/external-api-config.json', 'utf8');
for (const category of ['Agua superficial','Inundación recurrente','Inundación detectada','Datos insuficientes']) {
  if (!satelliteConfig.includes(category)) throw Error(`Falta la clase oficial VIIRS ${category}`);
}
const viirsChecks = vm.runInContext(`(() => {
  const transparent = classifyViirsRasterCoverage({ tileCount: 1, transparent: 65536, surfaceWater: 0, recurringFlood: 0, flood: 0, insufficientData: 0, other: 0 });
  const insufficient = classifyViirsRasterCoverage({ tileCount: 1, transparent: 100, surfaceWater: 0, recurringFlood: 0, flood: 0, insufficientData: 900, other: 0 });
  const audited = classifyViirsRasterCoverage({ tileCount: 1, transparent: 100, surfaceWater: 8, recurringFlood: 1, flood: 1, insufficientData: 890, other: 0 });
  const noRelevant = classifyViirsRasterCoverage({ tileCount: 1, transparent: 100, surfaceWater: 50, recurringFlood: 0, flood: 0, insufficientData: 10, other: 0 });
  const layerConfig = { id: 'nasaViirsFlood', resolvedTime: '2026-08-18', acquiredAt: '2026-08-18T23:00:00.000Z' };
  return {
    transparent,
    insufficient,
    audited,
    noRelevant,
    displayDate: satelliteLayerDateLabel(layerConfig),
    time: layerConfig.resolvedTime
  };
})()`, context);
if (viirsChecks.transparent.state !== 'no-coverage' || !viirsChecks.transparent.message.includes('sin cobertura raster')) throw Error('VIIRS no identifica una imagen totalmente transparente.');
if (viirsChecks.insufficient.state !== 'insufficient' || !viirsChecks.insufficient.message.includes('interpretación limitada')) throw Error('VIIRS no identifica el predominio de Datos insuficientes.');
if (viirsChecks.audited.state !== 'insufficient-with-detections' || viirsChecks.audited.message !== 'Cobertura insuficiente predominante — se observan pequeñas áreas clasificadas como agua e inundación.') throw Error('VIIRS no describe correctamente el caso auditado del 18/08.');
if (viirsChecks.noRelevant.state !== 'no-relevant-areas' || !viirsChecks.noRelevant.message.includes('sin áreas relevantes detectadas')) throw Error('VIIRS no distingue cobertura sin Flood/Recurring Flood.');
if (viirsChecks.displayDate !== '18/8/2026' || viirsChecks.time !== '2026-08-18') throw Error(`La fecha visible y TIME de VIIRS no coinciden: ${JSON.stringify(viirsChecks)}`);
const satelliteTimelineChecks = vm.runInContext(`(() => {
  const dates = satelliteRecentDates(['2026-08-18','2026-08-17','2026-08-16','2026-08-11','2026-08-10'], '2026-08-18');
  const layerConfig = {
    id: 'nasaViirsFlood',
    layers: 'VIIRS_Combined_Flood_3-Day',
    serviceUrl: 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi',
    format: 'image/png',
    transparent: true,
    availableDates: dates,
    latestUsableDate: '2026-08-17',
    coverageByDate: new Map([
      ['2026-08-18', { state: 'no-coverage' }],
      ['2026-08-17', { state: 'insufficient' }],
      ['2026-08-16', { state: 'detections' }]
    ])
  };
  return {
    dates,
    latest: resolveSatelliteDateTarget(layerConfig, null, false),
    previous: resolveSatelliteDateTarget(layerConfig, '2026-08-16', true),
    outside: resolveSatelliteDateTarget(layerConfig, '2026-08-10', true),
    noCoverage: satelliteCoverageLabel(layerConfig, '2026-08-18'),
    insufficient: satelliteCoverageLabel(layerConfig, '2026-08-17'),
    available: satelliteCoverageLabel(layerConfig, '2026-08-16'),
    requestUrl: viirsCoverageRequestUrl(layerConfig, '2026-08-17')
  };
})()`, context);
if (JSON.stringify(satelliteTimelineChecks.dates) !== JSON.stringify(['2026-08-18','2026-08-17','2026-08-16','2026-08-11'])) throw Error(`La ventana satelital excede siete días: ${JSON.stringify(satelliteTimelineChecks.dates)}`);
if (satelliteTimelineChecks.latest.targetDate !== '2026-08-17' || satelliteTimelineChecks.latest.dateExplicit) throw Error('Última disponible no omite correctamente una fecha sin cobertura.');
if (satelliteTimelineChecks.previous.targetDate !== '2026-08-16' || !satelliteTimelineChecks.previous.dateExplicit) throw Error('No se puede seleccionar una escena anterior real.');
if (satelliteTimelineChecks.outside.targetDate !== '2026-08-17' || satelliteTimelineChecks.outside.dateExplicit) throw Error('Una fecha fuera de la ventana de siete días fue aceptada.');
if (satelliteTimelineChecks.noCoverage !== 'Sin cobertura para Corrientes' || satelliteTimelineChecks.insufficient !== 'Cobertura insuficiente' || satelliteTimelineChecks.available !== 'Datos disponibles') throw Error(`Los estados temporales VIIRS son incorrectos: ${JSON.stringify(satelliteTimelineChecks)}`);
if (!satelliteTimelineChecks.requestUrl.includes('time=2026-08-17') || !satelliteTimelineChecks.requestUrl.includes('layers=VIIRS_Combined_Flood_3-Day')) throw Error('La verificación de cobertura no usa la fecha y producto VIIRS seleccionados.');
const dateSelectionSource = app.slice(app.indexOf('function selectClimateSatelliteDate'), app.indexOf('function selectClimateHydrologyLayer'));
if (!dateSelectionSource.includes('entry.layer.setParams({ time: targetDate })') || dateSelectionSource.includes('fitClimateMapToCorrientes') || dateSelectionSource.includes('setView(')) throw Error('Cambiar la fecha reinicia el mapa o no actualiza TIME.');
if (!app.includes("params.set('mapSatelliteDate', selectedRaster.config.resolvedTime)") || !app.includes("params.get('mapSatelliteDate')")) throw Error('La fecha satelital no persiste en la URL.');
for (const category of ['Agua abierta','Vegetación inundada','Sin agua','Datos no disponibles / máscaras']) {
  if (!satelliteConfig.includes(category)) throw Error(`Falta la clase ejecutiva OPERA ${category}`);
}
for (const category of ['Extensión de inundación observada','Agua observada','Cobertura / footprint']) {
  if (!satelliteConfig.includes(category)) throw Error(`Falta la clase ejecutiva GFM ${category}`);
}
if (!app.includes('Qué muestra esta capa') || app.includes("[['Estado observado', detail.status]")) throw Error('El panel satelital conserva una etiqueta técnica.');
if (!html.includes('Escenas recientes verificadas, hasta 7 días hacia atrás.') || html.includes('Ráster remoto con fecha de escena')) throw Error('El selector temporal satelital no comunica su límite operativo.');
if (!html.includes('app.js?v=20260819-1')) throw Error('El HTML no invalida la versión anterior del JavaScript del selector satelital.');
const satelliteControlChecks = vm.runInContext(`(() => {
  const elements = ['climateSatelliteDate','climateSatelliteDateStatus','climateSatelliteLatestButton']
    .reduce((result, id) => ({ ...result, [id]: document.getElementById(id) }), {});
  const makeConfig = (id, dates, extras = {}) => ({
    id,
    available: true,
    availableDates: dates,
    latestUsableDate: dates[0] || null,
    resolvedTime: dates[0] || null,
    dateExplicit: false,
    datesLoading: false,
    coverageByDate: new Map(),
    usesTimeParameter: true,
    ...extras
  });
  const viirs = makeConfig('nasaViirsFlood', ['2026-08-18','2026-08-17']);
  viirs.coverageByDate.set('2026-08-18', { state: 'detections' });
  viirs.coverageByDate.set('2026-08-17', { state: 'insufficient' });
  const opera = makeConfig('operaS1', ['2026-08-16','2026-08-14']);
  const gfm = makeConfig('gfmObservedFlood', ['2026-08-19','2026-08-16']);
  state.climateMap.wmsLayers = new Map([
    ['nasaViirsFlood', { config: viirs, layer: {} }],
    ['operaS1', { config: opera, layer: {} }],
    ['gfmObservedFlood', { config: gfm, layer: {} }]
  ]);

  state.climateMap.activeHydrologyLayer = 'nasaViirsFlood';
  renderSatelliteDateControl();
  const viirsSelected = {
    enabled: !elements.climateSatelliteDate.disabled,
    options: elements.climateSatelliteDate.innerHTML,
    status: elements.climateSatelliteDateStatus.textContent,
    activeId: activeSatelliteLayerEntry()?.config.id
  };

  state.climateMap.activeHydrologyLayer = 'none';
  renderSatelliteDateControl();
  const noneSelected = {
    disabled: elements.climateSatelliteDate.disabled,
    status: elements.climateSatelliteDateStatus.textContent
  };

  state.climateMap.activeHydrologyLayer = 'operaS1';
  opera.availableDates = [];
  opera.datesLoading = true;
  renderSatelliteDateControl();
  const loading = elements.climateSatelliteDateStatus.textContent;
  opera.datesLoading = false;
  renderSatelliteDateControl();
  const empty = elements.climateSatelliteDateStatus.textContent;

  opera.availableDates = ['2026-08-16','2026-08-14'];
  opera.latestUsableDate = '2026-08-16';
  opera.resolvedTime = '2026-08-16';
  renderSatelliteDateControl();
  const operaOptions = elements.climateSatelliteDate.innerHTML;
  state.climateMap.activeHydrologyLayer = 'gfmObservedFlood';
  renderSatelliteDateControl();
  const gfmOptions = elements.climateSatelliteDate.innerHTML;
  return { viirsSelected, noneSelected, loading, empty, operaOptions, gfmOptions };
})()`, context);
if (!satelliteControlChecks.viirsSelected.enabled || satelliteControlChecks.viirsSelected.activeId !== 'nasaViirsFlood') throw Error(`VIIRS seleccionado no habilita el control: ${JSON.stringify(satelliteControlChecks)}`);
if (!satelliteControlChecks.viirsSelected.options.includes('2026-08-18') || !satelliteControlChecks.viirsSelected.options.includes('2026-08-17')) throw Error('El selector VIIRS no carga sus fechas reales recientes.');
if (!satelliteControlChecks.noneSelected.disabled || satelliteControlChecks.noneSelected.status !== 'Seleccioná una capa satelital.') throw Error('El control no se deshabilita correctamente cuando no hay capa.');
if (satelliteControlChecks.loading !== 'Cargando fechas disponibles…' || satelliteControlChecks.empty !== 'No hay escenas recientes disponibles.') throw Error('Los estados de carga y ausencia de fechas son ambiguos.');
if (!satelliteControlChecks.operaOptions.includes('2026-08-16') || satelliteControlChecks.operaOptions.includes('2026-08-15')) throw Error('OPERA fabrica fechas no disponibles.');
if (!satelliteControlChecks.gfmOptions.includes('2026-08-19') || satelliteControlChecks.gfmOptions.includes('2026-08-18')) throw Error('GFM fabrica fechas no disponibles.');
for (const category of ['Precipitaciones','Altura de ríos','Observación satelital','Modelos / pronósticos']) {
  if (!html.includes(category)) throw Error(`Falta la categoría visual ${category}`);
}
for (const mapping of [
  "ina: { label: 'Altura del río · INA', category: 'hydrometry', color: CLIMATE_CATEGORY_COLORS.hydrometry",
  "snih: { label: 'Altura del río · SNIH', category: 'hydrometry', color: CLIMATE_CATEGORY_COLORS.hydrometry",
  "salto: { label: 'Altura del río · Salto Grande', category: 'hydrometry', color: CLIMATE_CATEGORY_COLORS.hydrometry",
  "nasa: { label: 'Precipitación modelada · NASA POWER', category: 'models', color: CLIMATE_CATEGORY_COLORS.models",
  "geoglows: { label: 'Caudal pronosticado · GEOGLOWS', category: 'models', color: CLIMATE_CATEGORY_COLORS.models"
]) if (!app.includes(mapping)) throw Error('Una fuente no comparte el color de su categoría');
const rainLayerSource = app.slice(app.indexOf('function rainPointComparison'), app.indexOf('function renderRainPointDetail'));
if (!app.includes('const RAIN_COMPARISON_SCALE')) throw Error('Falta la escala azul común de precipitación.');
for (const requirement of ['dailyHistoricalWindowReference(state.dailyRecords','Referencia histórica','Diferencia:','radius: 5.8','wireClimatePointSelection(marker, options)']) {
  if (!rainLayerSource.includes(requirement)) throw Error(`La lluvia no usa comparación visual homogénea: ${requirement}`);
}
if (rainLayerSource.includes('Math.sqrt') || rainLayerSource.includes('sourceInfo.color')) throw Error('La lluvia todavía varía tamaño o color por fuente/magnitud.');
const hydrometrySource = app.slice(app.indexOf('function renderInaPointLayer'), app.indexOf('function renderNasaPointLayer'));
for (const requirement of ["className: `climate-point-marker hydrometry-marker", "color: '#ffffff'", 'radius: 5.6', 'marker.__hydrometryLabel = true']) {
  if (!hydrometrySource.includes(requirement)) throw Error(`La hidrometría no comparte estilo común: ${requirement}`);
}
if (hydrometrySource.includes('permanent: true')) throw Error('Las etiquetas hidrométricas siguen visibles en todo nivel de zoom.');
if (!app.includes("const showHeightLabels = map.getZoom() >= 11") || !app.includes("state.climateMap.map.on('zoomend', updateHydrometryLabelsForZoom)")) throw Error('Las etiquetas hidrométricas no dependen del zoom.');
const modelSource = app.slice(app.indexOf('function renderNasaPointLayer'), app.indexOf('function refreshGeoglowsCoverage'));
for (const requirement of ["icon: climateModelIcon('rain')", "icon: climateModelIcon('flow')", 'Precipitación modelada · NASA POWER', 'Caudal pronosticado · GEOGLOWS']) {
  if (!modelSource.includes(requirement)) throw Error(`Los modelos no se distinguen por forma y variable: ${requirement}`);
}
if (!app.includes("className: `climate-model-div-icon model-${modelKind}-icon`") || modelSource.includes('Math.sqrt')) throw Error('Los modelos no usan símbolos huecos y estables.');
for (const requirement of ['function wireClimatePointSelection','selectedPointMarker','is-selected','Respecto de lo habitual','Muy por debajo','Muy por encima']) {
  if (!app.includes(requirement) && !css.includes(requirement)) throw Error(`Falta el requisito visual del mapa: ${requirement}`);
}
const modelLegendCss = css.slice(css.lastIndexOf('.climate-nature-legend .category-models'));
if (!modelLegendCss.includes('background: transparent') || !modelLegendCss.includes('border: 2px solid #7656a8')) throw Error('La leyenda no distingue los modelos con un círculo hueco.');
for (const requirement of ['Precipitación modelada','Caudal pronosticado','model-rain-symbol','model-flow-symbol']) {
  if (!app.includes(requirement)) throw Error(`Falta la leyenda secundaria de modelos: ${requirement}`);
}
for (const requirement of ['.model-rain-icon span','.model-flow-icon span','transform: rotate(45deg)','.climate-model-div-icon.is-selected']) {
  if (!css.includes(requirement)) throw Error(`Falta el estilo diferenciado o seleccionado de modelos: ${requirement}`);
}
for (const requirement of ['scrollWheelZoom: true','doubleClickZoom: true','touchZoom: true','wheelDebounceTime: 40','wheelPxPerZoomLevel: 80']) {
  if (!app.includes(requirement)) throw Error(`Falta la interacción práctica de zoom: ${requirement}`);
}
if (!rainfallBefore.length) throw Error('rainfall.json está vacío');
console.log('Visor: controles, panel operativo y simbología por categoría validados.');
