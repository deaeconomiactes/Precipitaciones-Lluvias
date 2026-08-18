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
  const argentinaNoon = isoDate => new Date(isoDate + "T12:00:00-03:00");
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
    row("A", 2024, { 0: 100, 2: 140, 4: 120, 7: 60, 9: 180, 11: 200 }),
    row("B", 2024, { 0: 120, 2: 160, 4: 140, 7: 80, 9: 220, 11: 240 }),
    row("A", 2025, { 0: 120, 2: 180, 4: 120, 7: 80, 9: 200, 11: 220 }),
    row("B", 2025, { 0: 140, 2: 200, 4: 140, 7: 100, 9: 240, 11: 260 }),
    row("A", 2026, { 0: 140, 2: 220, 4: 90, 7: 999 }),
    row("B", 2026, { 0: 160, 2: 240, 4: 110, 7: 999 })
  ];
  state.operationalDailyRecords = [];
  const historicalAugust = (department, year, rainfallMm) => Array.from({ length: 18 }, (_, index) => ({
    department,
    date: year + "-08-" + String(index + 1).padStart(2, "0"),
    rainfallMm
  }));
  state.dailyRecords = [
    ...historicalAugust("A", 2024, 2),
    ...historicalAugust("B", 2024, 4),
    ...historicalAugust("A", 2025, 3),
    ...historicalAugust("B", 2025, 5),
    { department: "A", date: "2026-08-01", rainfallMm: 10 },
    { department: "A", date: "2026-08-02", rainfallMm: 0 }
  ];
  const august = monthlySummaryComparison({ departments: null, years: [2026], months: null }, argentinaNoon("2026-08-18"));
  const augustDepartments = getDepartmentMonthlyDeviationRows({ departments: null, years: [2026], months: null }, argentinaNoon("2026-08-18"));
  const closedDecember = getDepartmentMonthlyDeviationRows({ departments: ["A"], years: [2024], months: [11] }, argentinaNoon("2026-08-18"));
  const october = monthlySummaryComparison({ departments: null, years: [2026], months: [9] }, argentinaNoon("2026-08-18"));
  const historical = monthlySummaryComparison({ departments: null, years: [2024], months: null }, argentinaNoon("2026-08-18"));
  state.monthlyRainfall.push(
    row("A", 2027, { 0: 20 }, { 0: "daily_derived" }, { 0: { daysWithRecords: 10, daysInMonth: 31 } }),
    row("B", 2027, { 0: 40 }, { 0: "daily_derived" }, { 0: { daysWithRecords: 10, daysInMonth: 31 } })
  );
  state.operationalDailyRecords = [
    { department: "A", date: "2027-01-10", rainfallMm: 20 },
    { department: "B", date: "2027-01-10", rainfallMm: 40 }
  ];
  state.dailyRecords = [...state.operationalDailyRecords];
  const partial = monthlySummaryComparison({ departments: null, years: [2027], months: [0] }, argentinaNoon("2027-01-10"));
  return {
    augustPeriod: august.period,
    augustObserved: august.observedMm,
    augustHistorical: august.historicalAverageMm,
    augustDifference: august.differenceMm,
    augustDifferencePct: august.differencePct,
    augustCategory: august.category,
    augustDepartments,
    closedDecember,
    annualAverage: august.annualAverageMm,
    annualMonths: august.annualMonths,
    comparableHistorical: august.comparableHistoricalMm,
    comparableYears: august.comparableYears,
    octoberPeriod: october.period,
    octoberObserved: october.observedMm,
    historicalPeriod: historical.period,
    historicalAnnual: historical.annualAverageMm,
    partialDetail: partial.observedDetail,
    partialHistorical: partial.historicalAverageMm,
    partialDifference: partial.differenceMm,
    partialCategory: partial.category,
    augustDetail: august.observedDetail
  };
})()`, context);

if (checks.augustPeriod.year !== 2026 || checks.augustPeriod.month !== 7) {
  throw new Error(`Año actual / año completo retrocedió de agosto: ${JSON.stringify(checks.augustPeriod)}`);
}
if (checks.augustObserved !== 5 || checks.augustHistorical !== 63 || checks.augustDifference !== -58) {
  throw new Error(`El mes actual no comparó acumulados diarios con el mismo corte histórico: ${JSON.stringify(checks)}`);
}
if (Math.abs(checks.augustDifferencePct - (-58 / 63 * 100)) > 1e-9 || checks.augustCategory !== "Muy por debajo") {
  throw new Error(`El desvío porcentual o la categoría mensual no se recalcularon: ${JSON.stringify(checks)}`);
}
const departmentA = checks.augustDepartments.find(row => row.department === "A");
if (departmentA?.observedMm !== 10 || departmentA?.historicalAverageMm !== 45 || departmentA?.differenceMm !== -35 || departmentA?.category !== "Muy por debajo") {
  throw new Error(`El detalle departamental no usa el corte mensual comparable: ${JSON.stringify(departmentA)}`);
}
const closedDecemberA = checks.closedDecember.find(row => row.department === "A");
if (closedDecemberA?.observedMm !== 200 || closedDecemberA?.historicalAverageMm !== 210) {
  throw new Error(`Un mes cerrado dejó de compararse mes completo contra mes completo: ${JSON.stringify(closedDecemberA)}`);
}
if (checks.octoberPeriod.month !== 9 || checks.octoberObserved !== null) {
  throw new Error(`El mes explícito no se respetó: ${JSON.stringify(checks.octoberPeriod)}`);
}
if (checks.historicalPeriod.year !== 2024 || checks.historicalPeriod.month !== 11) {
  throw new Error(`El año histórico no usó su último mes válido: ${JSON.stringify(checks.historicalPeriod)}`);
}
if (checks.annualAverage !== 121.25 || JSON.stringify(checks.annualMonths) !== JSON.stringify([0, 2, 4, 7])) {
  throw new Error(`El promedio 2026 no incorporó el parcial diario de agosto: ${JSON.stringify(checks)}`);
}
if (checks.comparableHistorical !== 125 || JSON.stringify(checks.comparableYears) !== JSON.stringify([2024, 2025])) {
  throw new Error(`El histórico anual no usó el mismo conjunto de meses: ${JSON.stringify(checks)}`);
}
if (Math.abs(checks.historicalAnnual - 146.66666666666666) > 1e-9) {
  throw new Error(`Las métricas anuales no respondieron al año 2024: ${checks.historicalAnnual}`);
}
if (!checks.partialDetail.includes("Acumulado parcial al 10/01/2027")) {
  throw new Error(`El acumulado diario incompleto no quedó rotulado como parcial: ${checks.partialDetail}`);
}
if (checks.partialHistorical !== null || checks.partialDifference !== null || checks.partialCategory !== "Sin referencia") {
  throw new Error(`La falta de histórico diario comparable activó una referencia silenciosa: ${JSON.stringify(checks)}`);
}
if (!checks.augustDetail.includes("Acumulado parcial al 18/08/2026") || !checks.augustDetail.includes("cobertura real 2/36")) {
  throw new Error(`El mes actual no informa corte y cobertura real: ${checks.augustDetail}`);
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
  state.dailyRecords = realOperationalDaily;
  state.metadata = realMetadata;
  state.monthlyRainfall = [];
  buildCombinedMonthlyRainfall();
  const summary = monthlySummaryComparison({ departments: null, years: [2026], months: null }, new Date("2026-08-14T12:00:00-03:00"));
  return { period: summary.period, annualMonths: summary.annualMonths, annualAverageMm: summary.annualAverageMm };
})()`, context);
if (realCurrentYear.period.year !== 2026 || realCurrentYear.period.month !== 7) {
  throw new Error(`La base real retrocedió desde agosto 2026: ${JSON.stringify(realCurrentYear)}`);
}
console.log(`Base real 2026: agosto permanece como referencia; ${realCurrentYear.annualMonths.length} meses válidos en el promedio anual.`);
