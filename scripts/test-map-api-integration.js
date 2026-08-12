#!/usr/bin/env node
"use strict";

const fs = require("fs");
const vm = require("vm");

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
vm.runInContext(fs.readFileSync("app.js", "utf8"), context);

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
if (inaThresholdState.key !== "normal") {
  throw new Error(`Los umbrales INA en 0 se interpretaron falsamente como alerta: ${JSON.stringify(inaThresholdState)}`);
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
if (cache.rainObservations.pointCount !== cache.rainObservations.points.length || cache.rainObservations.pointCount < 40) {
  throw new Error("El respaldo de lluvia no contiene todas las ubicaciones normalizadas.");
}
if (cache.ina.stationCount !== cache.ina.stations.length || cache.ina.hydrologicalCount < 40) {
  throw new Error("El inventario INA está incompleto o es inconsistente.");
}
if (cache.ina.heightObservationCount !== cache.ina.heightObservations.length || cache.ina.heightObservationCount < 30) {
  throw new Error("El respaldo INA no contiene las lecturas numéricas pertinentes para Corrientes.");
}

function validateHeightObservations(label, observations, minimum, expectedSourceId) {
  if (!Array.isArray(observations) || observations.length < minimum) {
    throw new Error(`${label} contiene menos de ${minimum} alturas: ${observations?.length || 0}.`);
  }
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

validateHeightObservations("INA", cache.ina.heightObservations, 30);
if (cache.snih.pointCount !== cache.snih.observations.length) throw new Error("El conteo SNIH no coincide con sus observaciones.");
if (cache.salto.pointCount !== cache.salto.observations.length) throw new Error("El conteo Salto Grande no coincide con sus observaciones.");
validateHeightObservations("SNIH", cache.snih.observations, 20, "snih");
validateHeightObservations("Salto Grande", cache.salto.observations, 8, "salto");

const forbiddenSaltoStations = new Set(["Artigas", "Catalan Grande", "Cuareim Rio", "Paso de la Cruz"]);
if (cache.salto.observations.some(observation => forbiddenSaltoStations.has(observation.name))) {
  throw new Error("Salto Grande incluye estaciones del rectángulo amplio que no son pertinentes para Corrientes.");
}
if (!(cache.salto.metadata.excludedOutsideCorrientesCount >= 4) || !cache.salto.metadata.spatialRule) {
  throw new Error("Salto Grande no documenta el filtro espacial provincial y de borde.");
}

const totalHeights = cache.ina.heightObservations.length + cache.snih.observations.length + cache.salto.observations.length;
if (cache.quality.primaryHeightCount !== totalHeights || cache.quality.noCrossSourceAveraging !== true) {
  throw new Error("La reconciliación de alturas primarias o la regla de no promediar fuentes es incorrecta.");
}

if (cache.nasaPower.pointCount !== cache.nasaPower.points.length || cache.nasaPower.pointCount < 20) {
  throw new Error("El recorte NASA POWER está incompleto.");
}
if (cache.geoglows.nodeCount !== cache.geoglows.nodes.length || cache.geoglows.nodeCount !== cache.ina.hydrologicalCount) {
  throw new Error("GEOGLOWS no cubre todo el inventario hidrológico INA.");
}

const satelliteLayers = cache.satelliteFlood?.layers || {};
for (const id of ["operaS1", "gfmObservedFlood", "nasaViirsFlood"]) {
  const layer = satelliteLayers[id];
  if (!layer?.available || !layer.date || !layer.acquiredAt || !layer.sceneId || !layer.sourceUrl) {
    throw new Error(`La instantánea satelital no tiene procedencia y fecha completas para ${id}.`);
  }
}

const html = fs.readFileSync("index.html", "utf8");
for (const id of [
  "climateInaToggle", "climateSnihToggle", "climateSaltoToggle", "climateRainToggle", "climateNasaToggle", "climateGeoglowsToggle",
  "inaApiCard", "snihApiCard", "saltoApiCard", "satelliteApiCard", "rainApiCard", "nasaApiCard", "geoglowsApiCard", "mapPointDetailTitle"
]) {
  if (!html.includes(`id="${id}"`)) throw new Error(`Falta el control o estado puntual ${id}.`);
}
if (html.includes('id="climateMapMode"')) throw new Error("El mapa todavía inicia con el selector coroplético anterior.");
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

console.log(`Alturas primarias: ${totalHeights} válidas (${cache.ina.heightObservationCount} INA + ${cache.snih.pointCount} SNIH + ${cache.salto.pointCount} Salto Grande).`);
console.log(`Satélite: ${Object.keys(satelliteLayers).length} capas con fecha e identificador de escena.`);
console.log(`Lluvia: ${cache.rainObservations.pointCount} ubicaciones puntuales respaldadas.`);
console.log(`NASA POWER: ${cache.nasaPower.pointCount} celdas; GEOGLOWS: ${cache.geoglows.nodeCount} nodos.`);
console.log("Sin puntos piloto, sin valores centinela y sin integración de Google Flood Hub.");
