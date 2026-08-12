#!/usr/bin/env node
const fs = require('fs');

const html = fs.readFileSync('index.html', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');
const config = JSON.parse(fs.readFileSync('data/external-api-config.json', 'utf8'));
const rainfallBefore = fs.readFileSync('data/rainfall.json');

for (const id of ['climateFullscreenButton','climateExportPngButton','climateSatelliteOpacity','climateMapLegend']) {
  if (!html.includes(`id="${id}"`)) throw Error(`Falta el control ${id}`);
}
for (const group of ['Registros propios','Hidrometría','Satélite','Modelos','Administrativo (preparado)']) {
  if (!html.includes(`<summary>${group}</summary>`)) throw Error(`Falta el grupo ${group}`);
}
if (!app.includes('renderSatelliteLayerDetail') || !app.includes('applyClimateViewFromUrl') || !app.includes('exportClimateMapPng')) throw Error('Falta una función central del visor');
if (!config.satelliteTimeline || config.satelliteTimeline.enabled !== false) throw Error('La línea temporal futura no está preparada correctamente');
for (const layer of config.wmsLayers || []) {
  for (const key of ['serviceUrl','layers','spatialResolution','crsLabel','statusKey']) if (!layer[key]) throw Error(`${layer.id}: falta ${key}`);
  if (!/^https:\/\//.test(layer.serviceUrl)) throw Error(`${layer.id}: WMS no seguro`);
}
if (!rainfallBefore.length) throw Error('rainfall.json está vacío');
console.log(`Visor: ${config.wmsLayers.length} capas satelitales con metadatos y controles estructurales válidos.`);
