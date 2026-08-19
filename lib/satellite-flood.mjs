const CMR_GRANULES_URL = 'https://cmr.earthdata.nasa.gov/search/granules.json';
const GFM_STAC_SEARCH_URL = 'https://stac.eodc.eu/api/v1/search';
const CORRIENTES_BBOX = [-59.9, -30.8, -55.5, -27.0];
const REQUEST_TIMEOUT_MS = 45_000;

const LAYER_SOURCES = Object.freeze({
  operaS1: {
    label: 'NASA OPERA DSWx-S1',
    collectionId: 'C2949811996-POCLOUD',
    sourceUrl: 'https://www.earthdata.nasa.gov/data/catalog/pocloud-opera-l3-dswx-s1-v1-1.0'
  },
  nasaViirsFlood: {
    label: 'NASA LANCE VIIRS · inundación 3 días',
    collectionId: 'C4064643747-LANCEMODIS',
    sourceUrl: 'https://www.earthdata.nasa.gov/data/catalog/lancemodis-vcdwd-l3-nrt-2'
  },
  gfmObservedFlood: {
    label: 'Copernicus GFM · inundación observada',
    sourceUrl: 'https://global-flood.emergency.copernicus.eu/technical-information/glofas-gfm/'
  }
});

async function requestJson(url, options = {}, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Precipitaciones-Lluvias-satellite-status/1.0',
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`${new URL(url).hostname} respondió HTTP ${response.status}`);
  return response.json();
}

function validIso(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function granuleNominalDate(sceneId) {
  const match = String(sceneId || '').match(/\.A(\d{4})(\d{3})(?:\.|$)/);
  if (!match) return null;
  const year = Number(match[1]);
  const dayOfYear = Number(match[2]);
  if (!Number.isInteger(year) || dayOfYear < 1 || dayOfYear > 366) return null;
  const date = new Date(Date.UTC(year, 0, dayOfYear));
  return date.getUTCFullYear() === year ? date.toISOString().slice(0, 10) : null;
}

export async function fetchLatestCmrGranule(layerId, { fetchImpl = globalThis.fetch } = {}) {
  const definition = LAYER_SOURCES[layerId];
  if (!definition?.collectionId) throw new Error(`Colección CMR desconocida: ${layerId}`);
  const params = new URLSearchParams({
    collection_concept_id: definition.collectionId,
    bounding_box: CORRIENTES_BBOX.join(','),
    sort_key: '-start_date',
    page_size: '1'
  });
  const payload = await requestJson(`${CMR_GRANULES_URL}?${params}`, {}, fetchImpl);
  const granule = payload?.feed?.entry?.[0];
  const acquiredAt = validIso(granule?.time_start);
  if (!granule || !acquiredAt) throw new Error(`${definition.label} no devolvió escenas para Corrientes`);
  const endAt = validIso(granule.time_end);
  const sceneId = String(granule.producer_granule_id || granule.id || '');
  const nominalDate = layerId === 'nasaViirsFlood' ? granuleNominalDate(sceneId) : null;
  return {
    id: layerId,
    label: definition.label,
    available: true,
    acquiredAt,
    endAt,
    date: nominalDate || acquiredAt.slice(0, 10),
    sceneId,
    sourceUrl: definition.sourceUrl,
    discovery: 'NASA CMR · intersección espacial con Corrientes'
  };
}

export async function fetchLatestGfmScene({ fetchImpl = globalThis.fetch } = {}) {
  const payload = await requestJson(GFM_STAC_SEARCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      collections: ['GFM'],
      bbox: CORRIENTES_BBOX,
      limit: 1,
      sortby: [{ field: 'properties.datetime', direction: 'desc' }]
    })
  }, fetchImpl);
  const scene = payload?.features?.[0];
  const acquiredAt = validIso(scene?.properties?.datetime);
  if (!scene || !acquiredAt) throw new Error('Copernicus GFM no devolvió escenas para Corrientes');
  return {
    id: 'gfmObservedFlood',
    label: LAYER_SOURCES.gfmObservedFlood.label,
    available: true,
    acquiredAt,
    endAt: null,
    date: acquiredAt.slice(0, 10),
    sceneId: String(scene.id || ''),
    sourceUrl: LAYER_SOURCES.gfmObservedFlood.sourceUrl,
    discovery: 'Catálogo STAC oficial de GFM · intersección espacial con Corrientes'
  };
}

function rejectedLayer(layerId, reason) {
  const definition = LAYER_SOURCES[layerId];
  return {
    id: layerId,
    label: definition.label,
    available: false,
    acquiredAt: null,
    endAt: null,
    date: null,
    sceneId: '',
    sourceUrl: definition.sourceUrl,
    error: reason instanceof Error ? reason.message : String(reason)
  };
}

export async function fetchSatelliteFloodStatus({ fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  const [opera, viirs, gfm] = await Promise.allSettled([
    fetchLatestCmrGranule('operaS1', { fetchImpl }),
    fetchLatestCmrGranule('nasaViirsFlood', { fetchImpl }),
    fetchLatestGfmScene({ fetchImpl })
  ]);
  const settled = { operaS1: opera, nasaViirsFlood: viirs, gfmObservedFlood: gfm };
  const layers = Object.fromEntries(Object.entries(settled).map(([layerId, result]) => [
    layerId,
    result.status === 'fulfilled' ? result.value : rejectedLayer(layerId, result.reason)
  ]));
  const availableCount = Object.values(layers).filter(layer => layer.available).length;
  if (!availableCount) throw new Error('No fue posible descubrir ninguna escena satelital para Corrientes');
  return {
    ok: true,
    generatedAt: now.toISOString(),
    availableCount,
    refreshPolicy: {
      metadataCacheMinutes: 60,
      note: 'La fecha corresponde a la escena más reciente que intersecta el rectángulo de Corrientes; no implica cobertura completa de toda la provincia.'
    },
    layers
  };
}

export const SATELLITE_FLOOD_ENDPOINTS = Object.freeze({
  cmr: CMR_GRANULES_URL,
  gfmStac: GFM_STAC_SEARCH_URL
});
