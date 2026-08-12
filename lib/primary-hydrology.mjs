import { readFile } from 'node:fs/promises';

const INA_STATIONS_URL = 'https://alerta.ina.gob.ar/pub/datos/estaciones&distrito=Corrientes&format=json';
const INA_HEIGHTS_WFS_URL = 'https://alerta.ina.gob.ar/geoserver/public2/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=public2%3Aultimas_alturas_con_timeseries&outputFormat=application%2Fjson&srsName=EPSG%3A4326&bbox=-59.9%2C-30.8%2C-55.5%2C-27.0%2CEPSG%3A4326';
const SNIH_STATIONS_URL = 'https://snih.hidricosargentina.gob.ar/Filtros.aspx/LeerEstaciones';
const SNIH_CURRENT_URL = 'https://snih.hidricosargentina.gob.ar/MuestraDatos.aspx/LeerDatosActuales';
const SALTO_GRANDE_ENDPOINT = 'https://www.saltogrande.org/ws.php';
const SALTO_GRANDE_WSDL = 'https://www.saltogrande.org/ws.php?wsdl';
const REQUEST_TIMEOUT_MS = 55_000;
const CORRIENTES_BBOX = Object.freeze({
  latitudeMin: -30.8,
  latitudeMax: -27.0,
  longitudeMin: -59.9,
  longitudeMax: -55.5
});

const SOURCE_DEFINITIONS = Object.freeze({
  ina: {
    label: 'INA SIyAH',
    url: 'https://alerta.ina.gob.ar/pub/gui/apibase',
    validation: 'publicada por INA'
  },
  snih: {
    label: 'Sistema Nacional de Información Hídrica',
    url: 'https://snih.hidricosargentina.gob.ar/',
    validation: 'telemétrica sin validación definitiva'
  },
  salto: {
    label: 'Comisión Técnica Mixta de Salto Grande',
    url: 'https://www.saltogrande.org/servicios.php',
    validation: 'operativa telemétrica'
  }
});

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function withinCorrientesBox(latitude, longitude) {
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= CORRIENTES_BBOX.latitudeMin
    && latitude <= CORRIENTES_BBOX.latitudeMax
    && longitude >= CORRIENTES_BBOX.longitudeMin
    && longitude <= CORRIENTES_BBOX.longitudeMax;
}

function ringContains(ring, longitude, latitude) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[previous];
    if ((y1 > latitude) !== (y2 > latitude)
      && longitude < ((x2 - x1) * (latitude - y1)) / (y2 - y1) + x1) inside = !inside;
  }
  return inside;
}

function geometryContains(geometry, longitude, latitude) {
  const polygonContains = polygon => ringContains(polygon[0] || [], longitude, latitude)
    && !(polygon.slice(1).some(hole => ringContains(hole, longitude, latitude)));
  if (geometry?.type === 'Polygon') return polygonContains(geometry.coordinates || []);
  if (geometry?.type === 'MultiPolygon') return (geometry.coordinates || []).some(polygonContains);
  return false;
}

function pointToSegmentDistanceKm(latitude, longitude, start, end) {
  const latitudeScale = 111.32;
  const longitudeScale = latitudeScale * Math.cos(latitude * Math.PI / 180);
  const ax = (start[0] - longitude) * longitudeScale;
  const ay = (start[1] - latitude) * latitudeScale;
  const bx = (end[0] - longitude) * longitudeScale;
  const by = (end[1] - latitude) * latitudeScale;
  const dx = bx - ax;
  const dy = by - ay;
  const denominator = dx * dx + dy * dy;
  const fraction = denominator ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / denominator)) : 0;
  return Math.hypot(ax + fraction * dx, ay + fraction * dy);
}

function ringBoundaryDistanceKm(ring, longitude, latitude) {
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < ring.length - 1; index += 1) {
    distance = Math.min(distance, pointToSegmentDistanceKm(latitude, longitude, ring[index], ring[index + 1]));
  }
  return distance;
}

function geometryBoundaryDistanceKm(geometry, longitude, latitude) {
  const polygonDistance = polygon => Math.min(...(polygon || []).map(ring => ringBoundaryDistanceKm(ring, longitude, latitude)));
  if (geometry?.type === 'Polygon') return polygonDistance(geometry.coordinates || []);
  if (geometry?.type === 'MultiPolygon') return Math.min(...(geometry.coordinates || []).map(polygonDistance));
  return Number.POSITIVE_INFINITY;
}

function isRelevantToCorrientes(latitude, longitude, provinceFeatures, borderMarginKm = 8) {
  return provinceFeatures.some(feature => geometryContains(feature.geometry, longitude, latitude)
    || geometryBoundaryDistanceKm(feature.geometry, longitude, latitude) <= borderMarginKm);
}

let provinceFeaturesPromise;
async function corrientesProvinceFeatures() {
  if (!provinceFeaturesPromise) {
    provinceFeaturesPromise = readFile(new URL('../data/geo/corrientes-departamentos.geojson', import.meta.url), 'utf8')
      .then(text => JSON.parse(text).features || []);
  }
  return provinceFeaturesPromise;
}

function isoDate(value) {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseDotNetDate(value) {
  const match = String(value || '').match(/\/Date\((-?\d+)/);
  return match ? isoDate(new Date(Number(match[1]))) : null;
}

function parseInaTimeseries(value) {
  if (!value) return [];
  try {
    const rows = typeof value === 'string' ? JSON.parse(value) : value;
    return (Array.isArray(rows) ? rows : [])
      .map(row => [String(row?.[0] || ''), finiteNumber(row?.[1])])
      .filter(row => row[0] && Number.isFinite(row[1]))
      .slice(-14);
  } catch {
    return [];
  }
}

async function request(url, { method = 'GET', body, headers = {}, timeoutMs = REQUEST_TIMEOUT_MS, fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl(url, {
    method,
    headers: {
      Accept: 'application/json, text/xml;q=0.9, */*;q=0.8',
      'User-Agent': 'Precipitaciones-Lluvias-primary-hydrology/1.0',
      ...headers
    },
    body,
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`${new URL(url).hostname} respondió HTTP ${response.status}`);
  return response;
}

async function requestJson(url, { method = 'GET', body, fetchImpl = globalThis.fetch } = {}) {
  const response = await request(url, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? {} : { 'Content-Type': 'application/json; charset=utf-8' },
    fetchImpl
  });
  return response.json();
}

function sourceObservation(sourceId, fields) {
  const source = SOURCE_DEFINITIONS[sourceId];
  return {
    sourceId,
    sourceLabel: source.label,
    sourceUrl: source.url,
    validation: source.validation,
    unit: 'm',
    ...fields
  };
}

export function normalizeInaHeightPayload(payload) {
  const observations = (payload?.features || []).map(feature => {
    const properties = feature?.properties || {};
    const coordinates = feature?.geometry?.coordinates || [];
    const latitude = finiteNumber(coordinates[1]);
    const longitude = finiteNumber(coordinates[0]);
    const valueM = finiteNumber(properties.valor);
    const date = isoDate(properties.fecha);
    if (!withinCorrientesBox(latitude, longitude) || !Number.isFinite(valueM) || !date) return null;
    return sourceObservation('ina', {
      stationId: properties.series_id === null || properties.series_id === undefined
        ? `${normalizeText(properties.nombre)}|${latitude.toFixed(5)}|${longitude.toFixed(5)}`
        : String(properties.series_id),
      seriesId: properties.series_id ?? null,
      name: String(properties.nombre || 'Estación hidrométrica'),
      river: String(properties.rio || ''),
      department: '',
      lat: latitude,
      lng: longitude,
      valueM,
      date,
      previousValueM: finiteNumber(properties.valor_precedente),
      trend: String(properties.tendencia || ''),
      status: String(properties.estado || ''),
      condition: String(properties.condicion || ''),
      alertLevelM: finiteNumber(properties.nivel_de_alerta),
      evacuationLevelM: finiteNumber(properties.nivel_de_evacuacion),
      lowWaterLevelM: finiteNumber(properties.nivel_de_aguas_bajas),
      timeseries: parseInaTimeseries(properties.timeseries),
      automatic: null
    });
  }).filter(Boolean);
  return [...new Map(observations.map(observation => [observation.stationId, observation])).values()]
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

export async function fetchInaHeights({ fetchImpl = globalThis.fetch } = {}) {
  const [payload, stationPayload, provinceFeatures] = await Promise.all([
    requestJson(INA_HEIGHTS_WFS_URL, { fetchImpl }),
    requestJson(INA_STATIONS_URL, { fetchImpl }),
    corrientesProvinceFeatures()
  ]);
  const rawObservations = normalizeInaHeightPayload(payload);
  const hydrologicalStations = (stationPayload?.data || []).map(row => ({
    name: normalizeText(row.nombre),
    lat: finiteNumber(row.lat),
    lng: finiteNumber(row.lon),
    type: String(row.tipo || '')
  })).filter(station => station.type === 'H' && withinCorrientesBox(station.lat, station.lng));
  const observations = rawObservations.filter(observation => {
    if (provinceFeatures.some(feature => geometryContains(feature.geometry, observation.lng, observation.lat))) return true;
    return hydrologicalStations.some(station => station.name === normalizeText(observation.name)
      || (Math.abs(station.lat - observation.lat) <= 0.004 && Math.abs(station.lng - observation.lng) <= 0.004));
  });
  if (!observations.length) throw new Error('INA no devolvió alturas numéricas para el área de Corrientes');
  return {
    observations,
    inventoryCount: hydrologicalStations.length,
    requestedCount: rawObservations.length,
    failedCount: 0,
    excludedOutsideProvinceCount: rawObservations.length - observations.length,
    stationEndpoint: INA_STATIONS_URL,
    endpoint: INA_HEIGHTS_WFS_URL
  };
}

export function selectSnihStations(payload) {
  return (payload?.d || []).map(row => {
    const latitude = -Math.abs(finiteNumber(row.Latitud));
    const longitude = -Math.abs(finiteNumber(row.Longitud));
    return {
      stationId: String(row.Codigo),
      code: row.Codigo,
      provinceCode: Number(row.Provincia),
      name: String(row.Descripcion || `${row.Rio || ''} - ${row.Lugar || ''}`).trim(),
      river: String(row.Rio || row.Subcuenca || ''),
      department: String(row.Departamento || ''),
      networkCode: row.Red,
      transmission: String(row.Transmision || ''),
      type: String(row.Tipo || ''),
      lat: latitude,
      lng: longitude,
      zeroScaleM: finiteNumber(row.CeroEscala),
      elevationSystem: row.SistemaCota ?? null,
      enabled: row.Habilitada === true,
      current: String(row.Actual || '').toUpperCase() !== 'N',
      registeredAt: parseDotNetDate(row.Registro)
    };
  }).filter(station => station.enabled
    && station.current
    && station.provinceCode === 20
    && station.transmission === 'T'
    && station.type.toUpperCase().includes('H')
    && withinCorrientesBox(station.lat, station.lng));
}

export function normalizeSnihCurrentPayload(station, payload) {
  const measurements = payload?.d?.Mediciones || [];
  const candidates = measurements.map(row => {
    const valueM = finiteNumber(row.Valor);
    const date = parseDotNetDate(row.FechaHora);
    const isHeight = Number(row.Codigo) === 1 || normalizeText(row.NombreCodigo).includes('altura');
    const year = date ? new Date(date).getUTCFullYear() : 0;
    if (!isHeight || !Number.isFinite(valueM) || valueM <= -100 || valueM >= 1000 || year < 2000) return null;
    return { valueM, date };
  }).filter(Boolean).sort((a, b) => b.date.localeCompare(a.date));
  const latest = candidates[0];
  if (!latest) return null;
  return sourceObservation('snih', {
    stationId: station.stationId,
    name: station.name,
    river: station.river,
    department: station.department,
    lat: station.lat,
    lng: station.lng,
    valueM: latest.valueM,
    date: latest.date,
    previousValueM: null,
    trend: '',
    status: 'Dato telemétrico preliminar',
    condition: '',
    alertLevelM: null,
    evacuationLevelM: null,
    lowWaterLevelM: null,
    timeseries: [],
    automatic: true,
    transmission: station.transmission,
    zeroScaleM: station.zeroScaleM,
    elevationSystem: station.elevationSystem
  });
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = { status: 'fulfilled', value: await mapper(items[index], index) };
      } catch (error) {
        results[index] = { status: 'rejected', reason: error };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

export async function fetchSnihHeights({ fetchImpl = globalThis.fetch } = {}) {
  const inventoryPayload = await requestJson(SNIH_STATIONS_URL, { method: 'POST', body: {}, fetchImpl });
  const stations = selectSnihStations(inventoryPayload);
  if (!stations.length) throw new Error('SNIH no devolvió estaciones telemétricas hidrométricas para Corrientes');
  const settled = await mapWithConcurrency(stations, 6, async station => {
    const payload = await requestJson(SNIH_CURRENT_URL, {
      method: 'POST',
      body: { estacion: station.stationId },
      fetchImpl
    });
    return normalizeSnihCurrentPayload(station, payload);
  });
  const observations = settled
    .filter(result => result.status === 'fulfilled' && result.value)
    .map(result => result.value)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  if (!observations.length) throw new Error('SNIH no devolvió alturas telemétricas válidas');
  return {
    observations,
    inventoryCount: stations.length,
    requestedCount: stations.length,
    failedCount: settled.filter(result => result.status === 'rejected').length,
    missingHeightCount: settled.filter(result => result.status === 'fulfilled' && !result.value).length,
    stationEndpoint: SNIH_STATIONS_URL,
    measurementEndpoint: SNIH_CURRENT_URL
  };
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function xmlTag(block, tag) {
  const match = String(block || '').match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeXml(match[1]).trim() : '';
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function soapEnvelope(operation, parameters = '') {
  return `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="https://www.saltogrande.org/ws.php"><soapenv:Body><tns:${operation}>${parameters}</tns:${operation}></soapenv:Body></soapenv:Envelope>`;
}

async function saltoSoap(operation, parameters, fetchImpl) {
  const response = await request(SALTO_GRANDE_ENDPOINT, {
    method: 'POST',
    body: soapEnvelope(operation, parameters),
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: `https://www.saltogrande.org/ws.php#${operation}`
    },
    fetchImpl
  });
  const xml = await response.text();
  if (/<(?:SOAP-ENV:)?Fault\b/i.test(xml)) throw new Error(`Salto Grande devolvió una falla SOAP en ${operation}`);
  return xml;
}

export function parseSaltoStations(xml) {
  const observations = [];
  const pattern = /<item\b[^>]*xsi:type="[^"]*:Estacion"[^>]*>([\s\S]*?)<\/Variables>\s*<\/item>/gi;
  for (const match of String(xml || '').matchAll(pattern)) {
    const block = match[1];
    const latitude = finiteNumber(xmlTag(block, 'Latitud'));
    const longitude = finiteNumber(xmlTag(block, 'Longitud'));
    const variablesBlock = xmlTag(`${block}</Variables>`, 'Variables');
    const variables = [...variablesBlock.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)]
      .map(item => decodeXml(item[1]).trim().toUpperCase());
    if (!withinCorrientesBox(latitude, longitude) || !variables.includes('H')) continue;
    observations.push({
      stationId: xmlTag(block, 'Id'),
      name: xmlTag(block, 'Nombre'),
      lat: latitude,
      lng: longitude,
      lastTransmissionAt: parseSaltoDate(xmlTag(block, 'Fecha')),
      variables
    });
  }
  return observations.filter(station => station.stationId && station.name);
}

function parseSaltoDate(value) {
  const normalized = String(value || '').trim().replace(' ', 'T');
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(normalized)
    ? isoDate(`${normalized}-03:00`)
    : isoDate(normalized);
}

export function parseSaltoHydrometeorological(xml, station) {
  const candidates = [];
  const pattern = /<item\b[^>]*xsi:type="[^"]*:DatoHidrometeorologico"[^>]*>([\s\S]*?)<\/item>/gi;
  for (const match of String(xml || '').matchAll(pattern)) {
    const block = match[1];
    const valueM = finiteNumber(xmlTag(block, 'H'));
    const date = parseSaltoDate(xmlTag(block, 'Fecha'));
    if (!Number.isFinite(valueM) || valueM <= -100 || valueM >= 1000 || !date) continue;
    candidates.push({ valueM, date });
  }
  candidates.sort((a, b) => b.date.localeCompare(a.date));
  const latest = candidates[0];
  if (!latest) return null;
  return sourceObservation('salto', {
    stationId: station.stationId,
    name: station.name,
    river: 'Cuenca del río Uruguay',
    department: '',
    lat: station.lat,
    lng: station.lng,
    valueM: latest.valueM,
    date: latest.date,
    previousValueM: candidates[1]?.valueM ?? null,
    trend: Number.isFinite(candidates[1]?.valueM)
      ? (latest.valueM > candidates[1].valueM ? 'sube' : latest.valueM < candidates[1].valueM ? 'baja' : 'estable')
      : '',
    status: 'Dato operativo telemétrico',
    condition: '',
    alertLevelM: null,
    evacuationLevelM: null,
    lowWaterLevelM: null,
    timeseries: candidates.slice(0, 14).reverse().map(row => [row.date, row.valueM]),
    automatic: true,
    variables: station.variables,
    lastTransmissionAt: station.lastTransmissionAt
  });
}

function formatSourceDateTime(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(value).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export async function fetchSaltoGrandeHeights({ fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  const [stationXml, provinceFeatures] = await Promise.all([
    saltoSoap(
      'ListaEstacionesTelemetricas',
      '<Activas xsi:type="xsd:boolean" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">true</Activas>',
      fetchImpl
    ),
    corrientesProvinceFeatures()
  ]);
  const areaCandidates = parseSaltoStations(stationXml);
  const stations = areaCandidates.filter(station => isRelevantToCorrientes(station.lat, station.lng, provinceFeatures));
  if (!stations.length) throw new Error('Salto Grande no devolvió estaciones de altura dentro del área');
  const start = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const from = formatSourceDateTime(start);
  const to = formatSourceDateTime(now);
  const settled = await mapWithConcurrency(stations, 6, async station => {
    const parameters = [
      `<idEstacion>${xmlEscape(station.stationId)}</idEstacion>`,
      `<fechaDesde>${xmlEscape(from)}</fechaDesde>`,
      `<fechaHasta>${xmlEscape(to)}</fechaHasta>`
    ].join('');
    const xml = await saltoSoap('DatosHidrometeorologicos', parameters, fetchImpl);
    return parseSaltoHydrometeorological(xml, station);
  });
  const observations = settled
    .filter(result => result.status === 'fulfilled' && result.value)
    .map(result => result.value)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  if (!observations.length) throw new Error('Salto Grande no devolvió alturas válidas de las últimas 48 horas');
  return {
    observations,
    inventoryCount: stations.length,
    requestedCount: stations.length,
    failedCount: settled.filter(result => result.status === 'rejected').length,
    missingHeightCount: settled.filter(result => result.status === 'fulfilled' && !result.value).length,
    areaCandidateCount: areaCandidates.length,
    excludedOutsideCorrientesCount: areaCandidates.length - stations.length,
    spatialRule: 'Dentro del límite provincial o hasta 8 km de su borde para conservar estaciones sobre ríos limítrofes',
    endpoint: SALTO_GRANDE_ENDPOINT,
    wsdl: SALTO_GRANDE_WSDL
  };
}

function sourceStatus(sourceId, settled) {
  if (settled.status === 'rejected') {
    return {
      ok: false,
      label: SOURCE_DEFINITIONS[sourceId].label,
      error: settled.reason instanceof Error ? settled.reason.message : String(settled.reason)
    };
  }
  return {
    ok: true,
    label: SOURCE_DEFINITIONS[sourceId].label,
    count: settled.value.observations.length,
    inventoryCount: settled.value.inventoryCount,
    requestedCount: settled.value.requestedCount,
    failedCount: settled.value.failedCount,
    missingHeightCount: settled.value.missingHeightCount || 0
  };
}

export async function fetchPrimaryRiverHeights({ fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  const [ina, snih, salto] = await Promise.allSettled([
    fetchInaHeights({ fetchImpl }),
    fetchSnihHeights({ fetchImpl }),
    fetchSaltoGrandeHeights({ fetchImpl, now })
  ]);
  const settledBySource = { ina, snih, salto };
  const sources = {};
  for (const [sourceId, settled] of Object.entries(settledBySource)) {
    sources[sourceId] = settled.status === 'fulfilled'
      ? { observations: settled.value.observations, metadata: { ...settled.value, observations: undefined } }
      : { observations: [], metadata: {} };
  }
  const totalCount = Object.values(sources).reduce((total, source) => total + source.observations.length, 0);
  if (!totalCount) {
    const detail = Object.entries(settledBySource)
      .map(([sourceId, settled]) => `${sourceId}: ${sourceStatus(sourceId, settled).error || 'sin observaciones'}`)
      .join('; ');
    throw new Error(`Ninguna fuente primaria devolvió alturas: ${detail}`);
  }
  return {
    ok: true,
    generatedAt: now.toISOString(),
    totalCount,
    refreshPolicy: {
      browserRequestMinutes: 5,
      upstreamCacheMinutes: 15,
      noCrossSourceAveraging: true
    },
    sourceStatus: Object.fromEntries(
      Object.entries(settledBySource).map(([sourceId, settled]) => [sourceId, sourceStatus(sourceId, settled)])
    ),
    sources
  };
}

export const PRIMARY_HYDROLOGY_ENDPOINTS = Object.freeze({
  inaStations: INA_STATIONS_URL,
  ina: INA_HEIGHTS_WFS_URL,
  snihStations: SNIH_STATIONS_URL,
  snihCurrent: SNIH_CURRENT_URL,
  saltoGrande: SALTO_GRANDE_ENDPOINT,
  saltoGrandeWsdl: SALTO_GRANDE_WSDL
});
