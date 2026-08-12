#!/usr/bin/env node

import {
  normalizeSnihCurrentPayload,
  parseSaltoHydrometeorological,
  parseSaltoStations,
  selectSnihStations
} from '../lib/primary-hydrology.mjs';
import { fetchSatelliteFloodStatus } from '../lib/satellite-flood.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const dotNetDate = milliseconds => `/Date(${milliseconds})/`;
const validTime = Date.UTC(2026, 7, 11, 15, 0, 0);
const snihInventory = {
  d: [
    {
      Codigo: 1,
      Provincia: 20,
      Descripcion: 'Estación válida',
      Rio: 'Paraná',
      Departamento: 'Capital',
      Transmision: 'T',
      Tipo: 'H',
      Latitud: 27.47,
      Longitud: 58.83,
      CeroEscala: 40.5,
      Habilitada: true,
      Actual: 'S',
      Registro: dotNetDate(validTime)
    },
    { Codigo: 2, Provincia: 16, Descripcion: 'Otra provincia', Transmision: 'T', Tipo: 'H', Latitud: 27.5, Longitud: 58.8, Habilitada: true, Actual: 'S' },
    { Codigo: 3, Provincia: 20, Descripcion: 'Manual', Transmision: 'M', Tipo: 'H', Latitud: 27.5, Longitud: 58.8, Habilitada: true, Actual: 'S' },
    { Codigo: 4, Provincia: 20, Descripcion: 'Meteorológica', Transmision: 'T', Tipo: 'P', Latitud: 27.5, Longitud: 58.8, Habilitada: true, Actual: 'S' },
    { Codigo: 5, Provincia: 20, Descripcion: 'Deshabilitada', Transmision: 'T', Tipo: 'H', Latitud: 27.5, Longitud: 58.8, Habilitada: false, Actual: 'S' }
  ]
};

const selectedSnih = selectSnihStations(snihInventory);
assert(selectedSnih.length === 1 && selectedSnih[0].stationId === '1', 'SNIH no aplicó todos los filtros de provincia, telemetría, tipo y vigencia.');
assert(selectedSnih[0].lat === -27.47 && selectedSnih[0].lng === -58.83, 'SNIH no normalizó las coordenadas sur/oeste.');

const validSnih = normalizeSnihCurrentPayload(selectedSnih[0], {
  d: {
    Mediciones: [
      { Codigo: 1, NombreCodigo: 'Altura', Valor: -999, FechaHora: dotNetDate(validTime + 60_000) },
      { Codigo: 2, NombreCodigo: 'Caudal', Valor: 300, FechaHora: dotNetDate(validTime + 120_000) },
      { Codigo: 1, NombreCodigo: 'Altura', Valor: 2.75, FechaHora: dotNetDate(validTime) }
    ]
  }
});
assert(validSnih?.valueM === 2.75 && validSnih.stationId === '1', 'SNIH no descartó el centinela o confundió otra variable con altura.');
assert(validSnih.zeroScaleM === 40.5 && validSnih.validation.includes('sin validación'), 'SNIH perdió el cero de escala o el estado preliminar.');

const saltoStationsXml = `
  <item xsi:type="ns:Estacion">
    <Id>CORR-1</Id><Nombre>Yapeyú</Nombre><Latitud>-29.47</Latitud><Longitud>-56.81</Longitud><Fecha>2026-08-11 12:00:00</Fecha>
    <Variables><item>H</item><item>P</item></Variables>
  </item>
  <item xsi:type="ns:Estacion">
    <Id>NO-H</Id><Nombre>Solo lluvia</Nombre><Latitud>-29.40</Latitud><Longitud>-56.80</Longitud><Fecha>2026-08-11 12:00:00</Fecha>
    <Variables><item>P</item></Variables>
  </item>`;
const saltoStations = parseSaltoStations(saltoStationsXml);
assert(saltoStations.length === 1 && saltoStations[0].stationId === 'CORR-1', 'Salto Grande no descubrió correctamente las estaciones con variable H.');

const saltoDataXml = `
  <item xsi:type="ns:DatoHidrometeorologico"><Fecha>2026-08-11 11:45:00</Fecha><H>-999</H></item>
  <item xsi:type="ns:DatoHidrometeorologico"><Fecha>2026-08-11 11:30:00</Fecha><H>4.20</H></item>
  <item xsi:type="ns:DatoHidrometeorologico"><Fecha>2026-08-11 12:00:00</Fecha><H>4.25</H></item>`;
const saltoObservation = parseSaltoHydrometeorological(saltoDataXml, saltoStations[0]);
assert(saltoObservation?.valueM === 4.25 && saltoObservation.previousValueM === 4.2, 'Salto Grande no seleccionó la altura válida más reciente.');
assert(saltoObservation.trend === 'sube' && saltoObservation.timeseries.length === 2, 'Salto Grande no construyó correctamente tendencia y serie.');

const cmrEntries = {
  'C2949811996-POCLOUD': {
    producer_granule_id: 'OPERA_SCENE',
    time_start: '2026-08-09T09:13:00Z',
    time_end: '2026-08-09T09:14:00Z'
  },
  'C4064643747-LANCEMODIS': {
    producer_granule_id: 'VIIRS_SCENE',
    time_start: '2026-08-10T00:00:00Z',
    time_end: '2026-08-11T23:59:59Z'
  }
};
const fetchImpl = async (url, options = {}) => {
  if (String(url).includes('cmr.earthdata.nasa.gov')) {
    const collectionId = new URL(url).searchParams.get('collection_concept_id');
    assert(String(url).includes('bounding_box=-59.9%2C-30.8%2C-55.5%2C-27'), 'NASA CMR no recibió el área de Corrientes.');
    return { ok: true, json: async () => ({ feed: { entry: [cmrEntries[collectionId]] } }) };
  }
  if (String(url).includes('stac.eodc.eu')) {
    const body = JSON.parse(options.body);
    assert(body.collections[0] === 'GFM' && body.bbox.join(',') === '-59.9,-30.8,-55.5,-27', 'GFM STAC no recibió colección y área correctas.');
    return {
      ok: true,
      json: async () => ({ features: [{ id: 'GFM_SCENE', properties: { datetime: '2026-08-11T08:57:00Z' } }] })
    };
  }
  throw new Error(`URL simulada inesperada: ${url}`);
};

const satellite = await fetchSatelliteFloodStatus({ fetchImpl, now: new Date('2026-08-11T12:00:00Z') });
assert(satellite.availableCount === 3, 'No se descubrieron las tres fuentes satelitales.');
assert(satellite.layers.operaS1.sceneId === 'OPERA_SCENE', 'OPERA perdió el identificador CMR.');
assert(satellite.layers.nasaViirsFlood.date === '2026-08-11', 'VIIRS no usa el final del compuesto como fecha WMS.');
assert(satellite.layers.gfmObservedFlood.sceneId === 'GFM_SCENE', 'GFM perdió el identificador STAC.');

console.log('Parsers primarios: filtros SNIH, SOAP Salto Grande y centinelas validados.');
console.log('Catálogos satelitales: CMR OPERA/VIIRS y STAC GFM validados con área de Corrientes.');
