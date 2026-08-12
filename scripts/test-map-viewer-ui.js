#!/usr/bin/env node
const fs = require('fs');

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
if (!rainfallBefore.length) throw Error('rainfall.json está vacío');
console.log('Visor: controles, grupos y panel operativo validados.');
