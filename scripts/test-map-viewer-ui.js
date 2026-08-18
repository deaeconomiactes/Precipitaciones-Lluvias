#!/usr/bin/env node
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');
const rainfallBefore = fs.readFileSync('data/rainfall.json');

for (const id of ['climateFullscreenButton','climateExportPngButton','climateSatelliteOpacity','climateMapLegend']) {
  if (!html.includes(`id="${id}"`)) throw Error(`Falta el control ${id}`);
}
for (const group of ['Registros propios','Hidrometría','Satélite','Modelos','Administrativo (preparado)']) {
  if (!html.includes(`<summary>${group}</summary>`)) throw Error(`Falta el grupo ${group}`);
}
for (const id of ['mapPointDetailTitle','mapPointDetailEyebrow','mapPointOperationalDetail']) {
  if (!html.includes(`id="${id}"`)) throw Error(`Falta el elemento operativo ${id}`);
}
for (const label of ['Lluvia registrada','Acumulado 7 días','Acumulado 30 días','Fuente','Fecha','Valor observado','Observación']) {
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
for (const requirement of ['align-items: start', 'isolation: isolate', 'scroll-margin-top:', '.ina-history-chart-wrap canvas']) {
  if (!css.includes(requirement)) throw Error(`Falta el resguardo de layout del mapa: ${requirement}`);
}
for (const label of ['Lluvia del día de referencia','Fecha diaria de referencia']) {
  if (!html.includes(label) || !app.includes(label)) throw Error(`Falta la etiqueta temporal territorial: ${label}`);
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
  console,
  setTimeout,
  clearTimeout
};
vm.createContext(context);
vm.runInContext(app, context);
const timestampChecks = vm.runInContext(`(() => {
  state.climateMap.statuses = new Map();
  state.dailyGeneratedAt = '2026-08-13T10:56:09';
  renderClimateDepartmentDetail({ department: 'Capital', referenceDateDaily: '2026-08-18', updatedAt: '2026-08-11T10:16:18' });
  const loaded = { updated: document.getElementById('mapDetailUpdated').textContent, reference: document.getElementById('mapDetailDailyDate').textContent };
  state.dailyGeneratedAt = null;
  renderClimateDepartmentDetail({ department: 'Capital', referenceDateDaily: '2026-08-18', updatedAt: '2026-08-11T10:16:18' });
  return { ...loaded, fallback: document.getElementById('mapDetailUpdated').textContent };
})()`, context);
if (timestampChecks.updated !== '13/08/2026 · 07:56') throw Error(`Formato horario argentino incorrecto: ${timestampChecks.updated}`);
if (timestampChecks.fallback !== 'Actualización no disponible') throw Error(`Fallback incorrecto: ${timestampChecks.fallback}`);
if (timestampChecks.reference !== '18/8/2026') throw Error(`La fecha diaria de referencia dejó de ser independiente: ${timestampChecks.reference}`);
if (app.includes("element.hidden = true;\n  element.innerHTML = '';\n  return;\n  if (!layerConfig)")) throw Error('La leyenda satelital permanece bloqueada');
const satelliteConfig = fs.readFileSync('data/external-api-config.json', 'utf8');
for (const category of ['Agua superficial','Inundación recurrente','Inundación detectada','Datos insuficientes']) {
  if (!satelliteConfig.includes(category)) throw Error(`Falta la clase oficial VIIRS ${category}`);
}
for (const category of ['Agua abierta','Vegetación inundada','Sin agua','Datos no disponibles / máscaras']) {
  if (!satelliteConfig.includes(category)) throw Error(`Falta la clase ejecutiva OPERA ${category}`);
}
for (const category of ['Extensión de inundación observada','Agua observada','Cobertura / footprint']) {
  if (!satelliteConfig.includes(category)) throw Error(`Falta la clase ejecutiva GFM ${category}`);
}
if (!app.includes('Qué muestra esta capa') || app.includes("[['Estado observado', detail.status]")) throw Error('El panel satelital conserva una etiqueta técnica.');
if (!html.includes('Imagen satelital correspondiente a la fecha seleccionada.') || html.includes('Ráster remoto con fecha de escena')) throw Error('El selector conserva texto técnico.');
for (const category of ['Precipitaciones','Hidrometría','Observación satelital','Modelos y pronósticos']) {
  if (!html.includes(category) || !app.includes(category)) throw Error(`Falta la categoría visual ${category}`);
}
for (const mapping of [
  "ina: { label: 'Altura del río · INA', category: 'hydrometry', color: CLIMATE_CATEGORY_COLORS.hydrometry",
  "snih: { label: 'Altura del río · SNIH', category: 'hydrometry', color: CLIMATE_CATEGORY_COLORS.hydrometry",
  "salto: { label: 'Altura del río · Salto Grande', category: 'hydrometry', color: CLIMATE_CATEGORY_COLORS.hydrometry",
  "nasa: { label: 'Precipitación NASA', category: 'models', color: CLIMATE_CATEGORY_COLORS.models",
  "geoglows: { label: 'Pronóstico de caudal', category: 'models', color: CLIMATE_CATEGORY_COLORS.models"
]) if (!app.includes(mapping)) throw Error('Una fuente no comparte el color de su categoría');
if (!rainfallBefore.length) throw Error('rainfall.json está vacío');
console.log('Visor: controles, panel operativo y simbología por categoría validados.');
