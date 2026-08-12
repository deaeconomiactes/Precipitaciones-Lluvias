#!/usr/bin/env node
const fs = require('fs');

const snapshot = JSON.parse(fs.readFileSync('data/map-point-sources.json', 'utf8'));
const validatedAt = new Date().toISOString();
const generatedAt = snapshot.generatedAt || validatedAt;
const count = value => Array.isArray(value) ? value.length : 0;
const row = (id, lastUpdate, total, label, status = 'OK') => ({
  id,
  status: total > 0 ? status : 'UNAVAILABLE',
  lastUpdate: lastUpdate || null,
  lastValidation: validatedAt,
  responseTimeMs: null,
  availability: total > 0 ? 'Instantánea local disponible' : 'Sin registros válidos en la instantánea',
  message: `${total} ${label}`
});

const satelliteLayers = snapshot.satelliteFlood?.layers || {};
const health = [
  row('rain', snapshot.rainObservations?.latestDate, count(snapshot.rainObservations?.points), 'registros propios'),
  row('ina', generatedAt, count(snapshot.ina?.heightObservations), 'lecturas observadas'),
  row('snih', generatedAt, count(snapshot.snih?.observations), 'lecturas preliminares'),
  row('salto', generatedAt, count(snapshot.salto?.observations), 'lecturas observadas'),
  row('nasa', snapshot.nasaPower?.date || generatedAt, count(snapshot.nasaPower?.points), 'celdas modeladas'),
  row('geoglows', generatedAt, count(snapshot.geoglows?.nodes), 'nodos disponibles'),
  row('viirs', satelliteLayers.nasaViirsFlood?.date || snapshot.satelliteFlood?.generatedAt, satelliteLayers.nasaViirsFlood ? 1 : 0, 'referencia satelital'),
  row('opera', satelliteLayers.operaS1?.date || snapshot.satelliteFlood?.generatedAt, satelliteLayers.operaS1 ? 1 : 0, 'referencia satelital'),
  row('gfm', satelliteLayers.gfmObservedFlood?.date || snapshot.satelliteFlood?.generatedAt, satelliteLayers.gfmObservedFlood ? 1 : 0, 'referencia satelital')
];

fs.writeFileSync('data/source-health.json', `${JSON.stringify(health, null, 2)}\n`);
console.log(`Estado técnico actualizado para ${health.length} fuentes.`);
