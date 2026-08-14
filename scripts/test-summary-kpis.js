#!/usr/bin/env node
"use strict";

const fs = require("fs");
const vm = require("vm");

const context = {
  document: { addEventListener() {} },
  Intl,
  console,
  setTimeout,
  clearTimeout
};
vm.createContext(context);
vm.runInContext(fs.readFileSync("app.js", "utf8"), context);

const checks = vm.runInContext(`(() => {
  const row = (department, year, values, sources = {}, meta = {}) => {
    const months = Array(12).fill(null);
    const monthSources = Array(12).fill(null);
    const dailyDerivedMeta = Array.from({ length: 12 }, () => null);
    Object.entries(values).forEach(([month, value]) => { months[Number(month)] = value; });
    Object.entries(sources).forEach(([month, value]) => { monthSources[Number(month)] = value; });
    Object.entries(meta).forEach(([month, value]) => { dailyDerivedMeta[Number(month)] = value; });
    return { department, year, months, monthSources, dailyDerivedMeta };
  };
  state.metadata = { departments: ["A", "B"] };
  state.monthlyRainfall = [
    row("A", 2023, { 0: 80 }),
    row("B", 2023, { 0: 100, 2: 140 }),
    row("A", 2024, { 0: 100, 2: 140, 4: 120, 9: 180, 11: 200 }),
    row("B", 2024, { 0: 120, 2: 160, 4: 140, 9: 220, 11: 240 }),
    row("A", 2025, { 0: 120, 2: 180, 4: 120, 9: 200, 11: 220 }),
    row("B", 2025, { 0: 140, 2: 200, 4: 140, 9: 240, 11: 260 }),
    row("A", 2026, { 0: 140, 2: 220, 4: 90 }),
    row("B", 2026, { 0: 160, 2: 240, 4: 110 })
  ];
  state.operationalDailyRecords = [];
  const august = monthlySummaryComparison({ departments: null, years: [2026], months: null }, new Date(2026, 7, 14));
  const october = monthlySummaryComparison({ departments: null, years: [2026], months: [9] }, new Date(2026, 7, 14));
  const historical = monthlySummaryComparison({ departments: null, years: [2024], months: null }, new Date(2026, 7, 14));
  state.monthlyRainfall.push(
    row("A", 2027, { 0: 20 }, { 0: "daily_derived" }, { 0: { daysWithRecords: 10, daysInMonth: 31 } }),
    row("B", 2027, { 0: 40 }, { 0: "daily_derived" }, { 0: { daysWithRecords: 10, daysInMonth: 31 } })
  );
  state.operationalDailyRecords = [
    { department: "A", date: "2027-01-10", rainfallMm: 20 },
    { department: "B", date: "2027-01-10", rainfallMm: 40 }
  ];
  const partial = monthlySummaryComparison({ departments: null, years: [2027], months: [0] }, new Date(2027, 0, 10));
  return {
    augustPeriod: august.period,
    augustObserved: august.observedMm,
    augustDifference: august.differenceMm,
    annualAverage: august.annualAverageMm,
    annualMonths: august.annualMonths,
    comparableHistorical: august.comparableHistoricalMm,
    comparableYears: august.comparableYears,
    octoberPeriod: october.period,
    octoberObserved: october.observedMm,
    historicalPeriod: historical.period,
    historicalAnnual: historical.annualAverageMm,
    partialDetail: partial.observedDetail
  };
})()`, context);

if (checks.augustPeriod.year !== 2026 || checks.augustPeriod.month !== 7) {
  throw new Error(`Año actual / año completo retrocedió de agosto: ${JSON.stringify(checks.augustPeriod)}`);
}
if (checks.augustObserved !== null || checks.augustDifference !== null) {
  throw new Error("Un mes sin observaciones se convirtió en cero o produjo una diferencia.");
}
if (checks.octoberPeriod.month !== 9 || checks.octoberObserved !== null) {
  throw new Error(`El mes explícito no se respetó: ${JSON.stringify(checks.octoberPeriod)}`);
}
if (checks.historicalPeriod.year !== 2024 || checks.historicalPeriod.month !== 11) {
  throw new Error(`El año histórico no usó su último mes válido: ${JSON.stringify(checks.historicalPeriod)}`);
}
if (checks.annualAverage !== 160 || JSON.stringify(checks.annualMonths) !== JSON.stringify([0, 2, 4])) {
  throw new Error(`El promedio 2026 incluyó faltantes como cero: ${JSON.stringify(checks)}`);
}
if (checks.comparableHistorical !== 140 || JSON.stringify(checks.comparableYears) !== JSON.stringify([2024, 2025])) {
  throw new Error(`El histórico anual no usó el mismo conjunto de meses: ${JSON.stringify(checks)}`);
}
if (checks.historicalAnnual !== 162) {
  throw new Error(`Las métricas anuales no respondieron al año 2024: ${checks.historicalAnnual}`);
}
if (!checks.partialDetail.includes("Acumulado parcial al 10/01/2027")) {
  throw new Error(`El acumulado diario incompleto no quedó rotulado como parcial: ${checks.partialDetail}`);
}

const html = fs.readFileSync("index.html", "utf8");
for (const removed of ["Avance sobre histórico", "id=\"kpiMonthlyCategory\""]) {
  if (html.includes(removed)) throw new Error(`La tarjeta eliminada sigue presente: ${removed}`);
}
for (const required of ["Promedio del año", "Promedio histórico anual comparable"]) {
  if (!html.includes(required)) throw new Error(`Falta la tarjeta: ${required}`);
}

console.log("Resumen provincial: período actual/seleccionado y faltantes validados.");
console.log("Promedios anuales: meses válidos y referencia histórica comparable validados.");

context.realRainfall = JSON.parse(fs.readFileSync("data/rainfall.json", "utf8"));
context.realOperationalDaily = JSON.parse(fs.readFileSync("data/rainfall-daily.json", "utf8"));
context.realMetadata = JSON.parse(fs.readFileSync("data/metadata.json", "utf8"));
const realCurrentYear = vm.runInContext(`(() => {
  state.rainfall = realRainfall;
  state.operationalDailyRecords = realOperationalDaily;
  state.metadata = realMetadata;
  state.monthlyRainfall = [];
  buildCombinedMonthlyRainfall();
  const summary = monthlySummaryComparison({ departments: null, years: [2026], months: null }, new Date(2026, 7, 14));
  return { period: summary.period, annualMonths: summary.annualMonths, annualAverageMm: summary.annualAverageMm };
})()`, context);
if (realCurrentYear.period.year !== 2026 || realCurrentYear.period.month !== 7) {
  throw new Error(`La base real retrocedió desde agosto 2026: ${JSON.stringify(realCurrentYear)}`);
}
console.log(`Base real 2026: agosto permanece como referencia; ${realCurrentYear.annualMonths.length} meses válidos en el promedio anual.`);
