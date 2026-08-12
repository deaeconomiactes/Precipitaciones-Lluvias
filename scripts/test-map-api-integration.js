#!/usr/bin/env node
"use strict";

const fs = require("fs");
const vm = require("vm");
const app = fs.readFileSync("app.js", "utf8");

const context = {
  document: {
    addEventListener() {},
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    hidden: false
  },
  Intl,
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  AbortController,
  URL,
  URLSearchParams,
  Date
};
vm.createContext(context);
vm.runInContext(app, context);

context.sampleApiRecords = [
  { date: "2026-08-10", department: "Capital", municipality: "Corrientes", rain: 0, lat: -27.4692, lng: -58.8306 },
  { date: "2026-08-11", department: "Capital", municipality: "Corrientes", rain: "12,5", lat: "-27.4692", lng: "-58.8306" },
  { date: "2026-08-09", department: "Goya", municipality: "Goya", rainfallMm: 8, lat: -29.1442, lng: -59.2635 },
  { date: "2026-08-12", department: "Goya", municipality: "Goya", rainfallMm: 99, lat: -29.1442, lng: -59.2635, status: "deleted" },
  { date: "2026-08-11", department: "Goya", municipality: "Fuera de rango", rain: 99, lat: -10, lng: -59.2635 },
  { date: "fecha-invalida", department: "Capital", municipality: "Corrientes", rain: 4, lat: -27.4692, lng: -58.8306 }
];

const rainChecks = vm.runInContext(`(() => {
  state.metadata = { departments: ["Capital", "Goya"] };
  const normalized = normalizeExternalRainRecords(sampleApiRecords);
  return { normalized, points: latestRainPoints(normalized) };
})()`, context);

if (rainChecks.normalized.length !== 3 || rainChecks.points.length !== 2) {
  throw new Error(`La normalización puntual de lluvia es incorrecta: ${JSON.stringify(rainChecks)}`);
}
const capital = rainChecks.points.find(point => point.department === "Capital");
if (!capital || capital.date !== "2026-08-11" || capital.rainfallMm !== 12.5) {
  throw new Error(`No se conservó la última observación de Capital: ${JSON.stringify(capital)}`);
}

context.samplePrimaryHeights = [
  { sourceId: "snih", stationId: "A", name: "Cero válido", lat: -28.1, lng: -58.1, valueM: 0, date: "2026-08-11T12:00:00Z" },
  { sourceId: "snih", stationId: "B", name: "Centinela", lat: -28.2, lng: -58.2, valueM: -999, date: "2026-08-11T12:00:00Z" },
  { sourceId: "snih", stationId: "C", name: "Fecha inválida", lat: -28.3, lng: -58.3, valueM: 2, date: "1900-01-01T00:00:00Z" }
];
const primaryChecks = vm.runInContext("normalizePrimaryHeightRecords(samplePrimaryHeights, 'snih')", context);
if (primaryChecks.length !== 1 || primaryChecks[0].latestHeight.valueM !== 0 || primaryChecks[0].stationId !== "A") {
  throw new Error(`El filtro de alturas válidas no conserva 0 m o admite centinelas: ${JSON.stringify(primaryChecks)}`);
}

context.sampleForecast = [
  "datetime,flow_uncertainty_upper,flow_median,flow_uncertainty_lower",
  "2026-08-11T00:00:00+00:00,120.5,100.25,80.1",
  "2026-08-11T03:00:00+00:00,130.5,110.25,90.1"
].join("\n");
const forecast = vm.runInContext("parseGeoglowsForecastCsv(sampleForecast)", context);
if (forecast.length !== 2 || forecast[1].median !== 110.25 || forecast[0].lower !== 80.1 || forecast[0].upper !== 120.5) {
  throw new Error(`El CSV de GEOGLOWS no se interpretó correctamente: ${JSON.stringify(forecast)}`);
}

context.sampleProvince = {
  type: "FeatureCollection",
  features: [{
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [[[-60, -31], [-55, -31], [-55, -27], [-60, -27], [-60, -31]]] },
    properties: {}
  }]
};
context.sampleNasa = {
  type: "FeatureCollection",
  header: { fill_value: -999, time_standard: "UTC", api: { version: "test" }, sources: ["GEOSIT"] },
  parameters: { PRECTOTCORR: { units: "mm/day", longname: "Precipitation Corrected" } },
  features: [
    { geometry: { type: "Point", coordinates: [-58.75, -29, 60] }, properties: { parameter: { PRECTOTCORR: { "20260809": 3.5, "20260810": -999 } } } },
    { geometry: { type: "Point", coordinates: [-50, -29, 60] }, properties: { parameter: { PRECTOTCORR: { "20260809": 8 } } } }
  ]
};
const nasa = vm.runInContext(`(() => {
  state.climateMap.provinceGeojson = sampleProvince;
  state.climateMap.externalConfig = { nasaPower: { parameter: "PRECTOTCORR" } };
  return normalizeNasaPowerPayload(sampleNasa);
})()`, context);
if (nasa.points.length !== 1 || nasa.points[0].precipitationMm !== 3.5 || nasa.date !== "2026-08-09") {
  throw new Error(`El recorte puntual de NASA POWER es incorrecto: ${JSON.stringify(nasa)}`);
}

const inaThresholdState = vm.runInContext(`inaHeightState({
  latestHeight: { valueM: 3.4, status: '', alertLevelM: 0, evacuationLevelM: 0, lowWaterLevelM: 0 }
})`, context);
if (inaThresholdState.key !== "reference") {
  throw new Error(`Los umbrales INA en 0 se interpretaron falsamente como referencia superada: ${JSON.stringify(inaThresholdState)}`);
}

const config = JSON.parse(fs.readFileSync("data/external-api-config.json", "utf8"));
const cache = JSON.parse(fs.readFileSync("data/map-point-sources.json", "utf8"));
if (config.version !== 3 || config.pointCacheFile !== "map-point-sources.json") {
  throw new Error("La configuración puntual versionada no está activa.");
}
if (config.defaultRasterLayer !== "gfmObservedFlood") {
  throw new Error("La vista inicial no activa la extensión de inundación observada de GFM.");
}
for (const source of ["rainObservations", "primaryRiverHeights", "satelliteFloodStatus", "ina", "nasaPower", "geoglows"]) {
  if (!config[source]) throw new Error(`Falta la configuración completa de ${source}.`);
}
if (config.geoglows.reaches) throw new Error("GEOGLOWS todavía contiene una lista piloto de reaches.");
if (Object.hasOwn(config, "floodHub")) throw new Error("La configuración todavía incluye la integración postergada de Flood Hub.");

const wmsById = new Map((config.wmsLayers || []).map(layer => [layer.id, layer]));
for (const id of ["operaS1", "gfmObservedFlood", "nasaViirsFlood"]) {
  if (!wmsById.has(id)) throw new Error(`Falta la capa observada ${id}.`);
  if (wmsById.get(id).kind !== "observed") throw new Error(`${id} no está identificada como observación.`);
}
if (wmsById.get("gfmObservedFlood").layers !== "observed_flood_extent_group_layer") {
  throw new Error("GFM usa un nombre WMS obsoleto o inexistente.");
}
if (wmsById.get("operaS1").layers !== "OPERA_L3_Dynamic_Surface_Water_Extent-Sentinel-1") {
  throw new Error("La capa OPERA Sentinel-1 no coincide con GIBS.");
}
if (wmsById.get("nasaViirsFlood").layers !== "VIIRS_Combined_Flood_3-Day") {
  throw new Error("La capa VIIRS de tres días no coincide con GIBS.");
}

if (cache.schemaVersion !== 3) throw new Error("map-point-sources.json usa un esquema inesperado.");
const referenceCounts = config.qualityReferenceCounts || {};
const warnBelowReference = (label, count, reference) => {
  if (Number.isFinite(reference) && count < reference) console.warn(`::warning::${label} bajó de ${reference} a ${count} observaciones; revisar cobertura sin invalidar la instantánea.`);
};

if (!Array.isArray(cache.rainObservations?.points) || cache.rainObservations.pointCount !== cache.rainObservations.points.length) {
  throw new Error("El respaldo de lluvia tiene un esquema o conteo inconsistente.");
}
warnBelowReference("Lluvia propia", cache.rainObservations.pointCount, referenceCounts.rain);
if (!Array.isArray(cache.ina?.stations) || cache.ina.stationCount !== cache.ina.stations.length) {
  throw new Error("El inventario INA está incompleto o es inconsistente.");
}
if (!Array.isArray(cache.ina.heightObservations) || cache.ina.heightObservationCount !== cache.ina.heightObservations.length) {
  throw new Error("El respaldo INA tiene un esquema o conteo inconsistente.");
}

function validateHeightObservations(label, observations, expectedSourceId, reference) {
  if (!Array.isArray(observations)) throw new Error(`${label} no contiene un arreglo de observaciones.`);
  warnBelowReference(label, observations.length, reference);
  if (!observations.length) console.warn(`::warning::${label} no tiene observaciones en esta instantánea; se mantiene la capa sin puntos.`);
  if (observations.some(observation =>
    !Number.isFinite(observation.valueM) || observation.valueM <= -100 ||
    Number.isNaN(new Date(observation.date).getTime()) || new Date(observation.date).getUTCFullYear() < 2000 ||
    !Number.isFinite(observation.lat) || !Number.isFinite(observation.lng)
  )) {
    throw new Error(`${label} contiene un punto sin altura, fecha o coordenadas válidas.`);
  }
  if (expectedSourceId && observations.some(observation => observation.sourceId !== expectedSourceId || !observation.stationId)) {
    throw new Error(`${label} perdió la fuente o el identificador de estación.`);
  }
  const keys = observations.map(observation => `${expectedSourceId || "ina"}:${observation.stationId || observation.seriesId || `${observation.name}|${observation.lat}|${observation.lng}`}`);
  if (new Set(keys).size !== observations.length) throw new Error(`${label} contiene estaciones duplicadas.`);
}

validateHeightObservations("INA", cache.ina.heightObservations, null, referenceCounts.ina);
if (cache.snih.pointCount !== cache.snih.observations.length) throw new Error("El conteo SNIH no coincide con sus observaciones.");
if (cache.salto.pointCount !== cache.salto.observations.length) throw new Error("El conteo Salto Grande no coincide con sus observaciones.");
validateHeightObservations("SNIH", cache.snih.observations, "snih", referenceCounts.snih);
validateHeightObservations("Salto Grande", cache.salto.observations, "salto", referenceCounts.salto);

const forbiddenSaltoStations = new Set(["Artigas", "Catalan Grande", "Cuareim Rio", "Paso de la Cruz"]);
if (cache.salto.observations.some(observation => forbiddenSaltoStations.has(observation.name))) {
  throw new Error("Salto Grande incluye estaciones del rectángulo amplio que no son pertinentes para Corrientes.");
}
if (!cache.salto.metadata?.spatialRule) {
  throw new Error("Salto Grande no documenta el filtro espacial provincial y de borde.");
}

const totalHeights = cache.ina.heightObservations.length + cache.snih.observations.length + cache.salto.observations.length;
if (cache.quality.primaryHeightCount !== totalHeights || cache.quality.noCrossSourceAveraging !== true) {
  throw new Error("La reconciliación de alturas primarias o la regla de no promediar fuentes es incorrecta.");
}
if (totalHeights + cache.rainObservations.pointCount + cache.nasaPower.pointCount + cache.geoglows.nodeCount === 0) {
  throw new Error("map-point-sources.json está vacío.");
}

if (!Array.isArray(cache.nasaPower?.points) || cache.nasaPower.pointCount !== cache.nasaPower.points.length) {
  throw new Error("El recorte NASA POWER tiene un esquema o conteo inconsistente.");
}
warnBelowReference("NASA POWER", cache.nasaPower.pointCount, referenceCounts.nasa);
if (!Array.isArray(cache.geoglows?.nodes) || cache.geoglows.nodeCount !== cache.geoglows.nodes.length) {
  throw new Error("GEOGLOWS tiene un esquema o conteo inconsistente.");
}
warnBelowReference("GEOGLOWS", cache.geoglows.nodeCount, referenceCounts.geoglows);
if (cache.geoglows.nodeCount !== cache.ina.hydrologicalCount) console.warn(`::warning::GEOGLOWS cubre ${cache.geoglows.nodeCount} nodos para ${cache.ina.hydrologicalCount} estaciones hidrológicas INA.`);

const satelliteLayers = cache.satelliteFlood?.layers || {};
for (const id of ["operaS1", "gfmObservedFlood", "nasaViirsFlood"]) {
  const layer = satelliteLayers[id];
  if (!layer || typeof layer.available !== "boolean" || !layer.sourceUrl) throw new Error(`La instantánea satelital tiene un esquema inválido para ${id}.`);
  if (!layer.available || !layer.date || !layer.acquiredAt || !layer.sceneId) console.warn(`::warning::${id} no tiene una escena completa en esta instantánea.`);
}

const allowedRainFields = new Set(config.privacy?.publicRainFields || []);
if (!allowedRainFields.size) throw new Error("La configuración no declara los campos públicos permitidos para lluvia.");
for (const point of cache.rainObservations.points) {
  const unexpected = Object.keys(point).filter(field => !allowedRainFields.has(field));
  if (unexpected.length) throw new Error(`Lluvia propia publica campos no autorizados: ${unexpected.join(", ")}.`);
  for (const coordinate of [point.lat, point.lng]) {
    const decimals = String(coordinate).split(".")[1]?.length || 0;
    if (decimals > Number(config.privacy.rainCoordinateDecimals || 4)) throw new Error("Una coordenada propia excede la precisión pública configurada.");
  }
}

const html = fs.readFileSync("index.html", "utf8");
for (const id of [
  "climateInaToggle", "climateSnihToggle", "climateSaltoToggle", "climateRainToggle", "climateNasaToggle", "climateGeoglowsToggle",
  "inaApiCard", "snihApiCard", "saltoApiCard", "satelliteApiCard", "rainApiCard", "nasaApiCard", "geoglowsApiCard", "mapPointDetailTitle",
  "mapPointDetailEyebrow", "mapPointOperationalDetail"
]) {
  if (!html.includes(`id="${id}"`)) throw new Error(`Falta el control o estado puntual ${id}.`);
}
if (!html.includes('id="climateMapMode"') || !html.includes('value="departments" selected') || !html.includes('value="hydrology"')) throw new Error("El mapa no separa los modos departamental e hidrológico.");
if (!html.includes('id="climateMapVariable"') || !html.includes('id="climateDepartmentDetail"') || !html.includes('id="climatePointDetail"')) throw new Error("Faltan los controles o paneles separados del mapa.");
for (const field of ["Fuente", "Fecha", "Valor observado", "Observación"]) {
  if (!app.includes(`'${field}'`) && !app.includes(`\"${field}\"`)) throw new Error(`El panel operativo no contempla el campo ${field}.`);
}
for (const removedId of ["mapPointDetailNature", "mapPointDetailAvailability", "mapPointDetailType", "mapPointDetailId", "mapPointDetailContext"]) {
  if (html.includes(`id="${removedId}"`)) throw new Error(`La interfaz volvió a exponer el campo técnico ${removedId}.`);
}
for (const group of ["Registros propios", "Hidrometría", "Modelos", "Satélite", "Administrativo (preparado)"]) {
  if (!html.includes(group)) throw new Error(`Falta el grupo metodológico: ${group}.`);
}
const toggleChecked = id => new RegExp(`<input[^>]*id="${id}"[^>]*\\schecked(?:\\s|>)`).test(html);
for (const id of ["climateInaToggle", "climateSnihToggle", "climateSaltoToggle"]) {
  if (!toggleChecked(id)) throw new Error(`${id} no está activo en la vista hidrométrica inicial.`);
}
for (const id of ["climateRainToggle", "climateNasaToggle", "climateGeoglowsToggle"]) {
  if (toggleChecked(id)) throw new Error(`${id} agrega una fuente secundaria a la vista inicial.`);
}

const server = fs.readFileSync("server.mjs", "utf8");
for (const required of ["/api/rain-observations", "/api/river-heights", "/api/satellite-flood-status", "fetchPrimaryRiverHeights", "fetchSatelliteFloodStatus"]) {
  if (!server.includes(required)) throw new Error(`El servidor no implementa ${required}.`);
}
for (const postponed of ["GOOGLE_FLOOD_HUB_API_KEY", "/api/floodhub/", "floodHub"]) {
  if (server.includes(postponed) || html.includes(postponed) || JSON.stringify(config).includes(postponed)) {
    throw new Error(`La integración postergada todavía aparece en el producto: ${postponed}.`);
  }
}
if (!server.includes("source: 'snapshot'") || !server.includes("map-point-sources.json")) {
  throw new Error("Los adaptadores Node no conservan la instantánea ante fallas upstream.");
}

for (const workflowPath of [".github/workflows/deploy-pages.yml", ".github/workflows/update-daily-rainfall.yml"]) {
  const workflow = fs.readFileSync(workflowPath, "utf8");
  if (!workflow.includes("data/map-point-sources.json")) {
    throw new Error(`${workflowPath} no publica el respaldo puntual.`);
  }
}
const rainfallWorkflow = fs.readFileSync(".github/workflows/update-daily-rainfall.yml", "utf8");
const mapWorkflow = fs.readFileSync(".github/workflows/update-map-sources.yml", "utf8");
if (rainfallWorkflow.includes("update-map-point-sources.py") || rainfallWorkflow.includes("data/map-point-sources.json data/department-climate-status.json")) {
  throw new Error("El workflow de lluvia todavía depende de la actualización hidrológica.");
}
if (!mapWorkflow.includes("update-map-point-sources.py") || !mapWorkflow.includes("continue-on-error: true") || !mapWorkflow.includes("git restore --source=HEAD -- data/map-point-sources.json")) {
  throw new Error("El workflow hidrológico no conserva la última instantánea válida ante fallas externas.");
}

console.log(`Alturas primarias: ${totalHeights} válidas (${cache.ina.heightObservationCount} INA + ${cache.snih.pointCount} SNIH + ${cache.salto.pointCount} Salto Grande).`);
console.log(`Satélite: ${Object.keys(satelliteLayers).length} capas con fecha e identificador de escena.`);
console.log(`Lluvia: ${cache.rainObservations.pointCount} ubicaciones puntuales respaldadas.`);
console.log(`NASA POWER: ${cache.nasaPower.pointCount} celdas; GEOGLOWS: ${cache.geoglows.nodeCount} nodos.`);
console.log("Sin puntos piloto, sin valores centinela y sin integración de Google Flood Hub.");
