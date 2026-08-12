import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchPrimaryRiverHeights } from './lib/primary-hydrology.mjs';
import { fetchSatelliteFloodStatus } from './lib/satellite-flood.mjs';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number.parseInt(process.env.PORT || '8000', 10);
const RAIN_OBSERVATIONS_URL = process.env.DAILY_RAIN_JSON_URL || 'https://script.google.com/macros/s/AKfycbyWxsaNypgJegUB419DKjF5tXhTRAyY4mT7aH34L3fwUwmGpy_J4ywwwZAsEhJWcEY/exec';
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8'
};
const ROOT_FILES = new Set(['/index.html', '/app.js', '/styles.css', '/climate-controls.css', '/operational.css']);
const rainCache = { expiresAt: 0, payload: null };
const riverHeightsCache = { expiresAt: 0, payload: null };
const satelliteFloodCache = { expiresAt: 0, payload: null };

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(body);
}

function publicStaticPath(pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const extension = extname(requested).toLowerCase();
  const isDataFile = requested.startsWith('/data/') && ['.json', '.geojson'].includes(extension);
  if (!ROOT_FILES.has(requested) && !isDataFile) return null;
  const absolute = normalize(join(ROOT, decodeURIComponent(requested)));
  const childPath = relative(ROOT, absolute);
  if (!childPath || childPath.startsWith('..') || childPath.includes('/.')) return null;
  return absolute;
}

async function serveStatic(request, response, pathname) {
  const absolute = publicStaticPath(pathname);
  if (!absolute) {
    sendJson(response, 404, { ok: false, error: 'Recurso no publicado.' });
    return;
  }
  try {
    const info = await stat(absolute);
    if (!info.isFile()) throw new Error('not-file');
    response.writeHead(200, {
      'Content-Type': MIME_TYPES[extname(absolute).toLowerCase()] || 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(absolute).pipe(response);
  } catch {
    sendJson(response, 404, { ok: false, error: 'Recurso no encontrado.' });
  }
}

async function readMapSnapshot() {
  return JSON.parse(await readFile(join(ROOT, 'data', 'map-point-sources.json'), 'utf8'));
}

async function primaryRiverHeights(response) {
  if (riverHeightsCache.payload && riverHeightsCache.expiresAt > Date.now()) {
    return sendJson(response, 200, riverHeightsCache.payload);
  }
  try {
    const payload = await fetchPrimaryRiverHeights();
    riverHeightsCache.payload = payload;
    riverHeightsCache.expiresAt = Date.now() + 15 * 60 * 1000;
    sendJson(response, 200, payload);
  } catch (error) {
    try {
      const snapshot = await readMapSnapshot();
      const sources = {
        ina: {
          observations: snapshot?.ina?.heightObservations || [],
          metadata: snapshot?.ina?.metadata || {}
        },
        snih: {
          observations: snapshot?.snih?.observations || [],
          metadata: snapshot?.snih?.metadata || {}
        },
        salto: {
          observations: snapshot?.salto?.observations || [],
          metadata: snapshot?.salto?.metadata || {}
        }
      };
      const sourceStatus = Object.fromEntries(Object.entries(sources).map(([sourceId, source]) => [
        sourceId,
        {
          ok: source.observations.length > 0,
          source: 'snapshot',
          count: source.observations.length
        }
      ]));
      const totalCount = Object.values(sources).reduce((sum, source) => sum + source.observations.length, 0);
      if (!totalCount) throw new Error('respaldo vacío');
      sendJson(response, 200, {
        ok: true,
        degraded: true,
        source: 'snapshot',
        generatedAt: snapshot.generatedAt || null,
        totalCount,
        refreshPolicy: {
          clientPollMinutes: 5,
          upstreamCacheMinutes: 15,
          snapshotSchedule: 'diario'
        },
        sourceStatus,
        sources,
        quality: {
          noCrossSourceAveraging: true,
          note: 'Cada lectura conserva fuente, estación y cero de escala propios.'
        },
        upstreamError: error.message
      });
    } catch {
      sendJson(response, 502, { ok: false, error: error.message });
    }
  }
}

async function satelliteFloodStatus(response) {
  if (satelliteFloodCache.payload && satelliteFloodCache.expiresAt > Date.now()) {
    return sendJson(response, 200, satelliteFloodCache.payload);
  }
  try {
    const payload = await fetchSatelliteFloodStatus();
    satelliteFloodCache.payload = payload;
    satelliteFloodCache.expiresAt = Date.now() + 60 * 60 * 1000;
    sendJson(response, 200, payload);
  } catch (error) {
    try {
      const snapshot = await readMapSnapshot();
      const payload = snapshot?.satelliteFlood;
      if (!payload?.layers || !Object.keys(payload.layers).length) throw new Error('respaldo vacío');
      sendJson(response, 200, {
        ...payload,
        ok: true,
        degraded: true,
        source: 'snapshot',
        generatedAt: snapshot.generatedAt || payload.generatedAt || null,
        upstreamError: error.message
      });
    } catch {
      sendJson(response, 502, { ok: false, error: error.message });
    }
  }
}

async function rainObservations(response) {
  if (rainCache.payload && rainCache.expiresAt > Date.now()) {
    return sendJson(response, 200, rainCache.payload);
  }
  try {
    const upstream = await fetch(RAIN_OBSERVATIONS_URL, {
      cache: 'no-store',
      redirect: 'follow',
      signal: AbortSignal.timeout(115_000)
    });
    if (!upstream.ok) throw new Error(`Apps Script respondió HTTP ${upstream.status}`);
    const payload = await upstream.json();
    if (payload?.ok === false) throw new Error(payload.error || 'Apps Script informó un error');
    rainCache.payload = payload;
    rainCache.expiresAt = Date.now() + 5 * 60 * 1000;
    sendJson(response, 200, payload);
  } catch (error) {
    try {
      const snapshot = await readMapSnapshot();
      const records = snapshot?.rainObservations?.points;
      if (!Array.isArray(records) || !records.length) throw new Error('respaldo vacío');
      sendJson(response, 200, {
        ok: true,
        degraded: true,
        source: 'snapshot',
        generatedAt: snapshot.generatedAt || null,
        records,
        upstreamError: error.message
      });
    } catch {
      sendJson(response, 502, { ok: false, error: error.message });
    }
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || `${HOST}:${PORT}`}`);
  if (!['GET', 'HEAD'].includes(request.method || 'GET')) {
    return sendJson(response, 405, { ok: false, error: 'Método no permitido.' });
  }
  if (url.pathname === '/api/health') {
    return sendJson(response, 200, {
      ok: true,
      service: 'precipitaciones-lluvias',
      primarySources: ['ina', 'snih', 'salto'],
      upstreamCacheMinutes: {
        rain: 5,
        riverHeights: 15,
        satelliteMetadata: 60
      }
    });
  }
  if (url.pathname === '/api/rain-observations') return rainObservations(response);
  if (url.pathname === '/api/river-heights') return primaryRiverHeights(response);
  if (url.pathname === '/api/satellite-flood-status') return satelliteFloodStatus(response);
  return serveStatic(request, response, url.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`Mapa disponible en http://${HOST}:${PORT}/`);
  console.log('Alturas primarias: INA + SNIH + Salto Grande (caché upstream de 15 minutos)');
  console.log('Inundación satelital: OPERA + GFM + VIIRS (metadatos en caché por 60 minutos)');
});
