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
    row("A", 2024, { 0: 100, 2: 140, 4: 120, 5: 40, 7: 60, 9: 180, 11: 200 }),
    row("B", 2024, { 0: 120, 2: 160, 4: 140, 7: 80, 9: 220, 11: 240 }),
    row("A", 2025, { 0: 120, 2: 180, 4: 120, 5: 60, 7: 80, 9: 200, 11: 220 }),
    row("B", 2025, { 0: 140, 2: 200, 4: 140, 7: 100, 9: 240, 11: 260 }),
    row("A", 2026, { 0: 140, 2: 220, 4: 90, 5: 30, 7: 999 }),
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
  const augustPresentation = summaryExecutivePresentation(august, { departments: null, years: [2026], months: null }, argentinaNoon("2026-08-18"));
  const departmentAugust = monthlySummaryComparison({ departments: ["A"], years: [2026], months: null }, argentinaNoon("2026-08-18"));
  const departmentPresentation = summaryExecutivePresentation(departmentAugust, { departments: ["A"], years: [2026], months: null }, argentinaNoon("2026-08-18"));
  const closedSummary = monthlySummaryComparison({ departments: null, years: [2024], months: [11] }, argentinaNoon("2026-08-18"));
  const closedPresentation = summaryExecutivePresentation(closedSummary, { departments: null, years: [2024], months: [11] }, argentinaNoon("2026-08-18"));
  const positiveMonthNegativeYear = summaryExecutivePresentation({
    ...august,
    observedMm: 110,
    historicalAverageMm: 100,
    differenceMm: 10,
    differencePct: 10,
    annualAverageMm: 80,
    comparableHistoricalMm: 100
  }, { departments: null, years: [2026], months: null }, argentinaNoon("2026-08-18"));
  const negativeMonthPositiveYear = summaryExecutivePresentation({
    ...august,
    observedMm: 80,
    historicalAverageMm: 100,
    differenceMm: -20,
    differencePct: -20,
    annualAverageMm: 120,
    comparableHistoricalMm: 100
  }, { departments: null, years: [2026], months: null }, argentinaNoon("2026-08-18"));
  const noReferencePresentation = summaryExecutivePresentation({
    ...august,
    historicalAverageMm: null,
    differenceMm: null,
    differencePct: null,
    comparableHistoricalMm: null
  }, { departments: null, years: [2026], months: null }, argentinaNoon("2026-08-18"));
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
    annualDetail: august.annualDetail,
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
    augustDetail: august.observedDetail,
    augustPresentation,
    departmentPresentation,
    closedPresentation,
    positiveMonthNegativeYear,
    negativeMonthPositiveYear,
    noReferencePresentation
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
if (checks.annualAverage !== 103 || JSON.stringify(checks.annualMonths) !== JSON.stringify([0, 2, 4, 5, 7])) {
  throw new Error(`El promedio 2026 no incorporó todos los meses con datos: ${JSON.stringify(checks)}`);
}
if (!checks.annualDetail.includes("cobertura 1–2 de 2 deptos.")) {
  throw new Error(`El promedio anual no informa su cobertura territorial variable: ${checks.annualDetail}`);
}
if (checks.comparableHistorical !== 110 || JSON.stringify(checks.comparableYears) !== JSON.stringify([2024, 2025])) {
  throw new Error(`El histórico anual no usó el mismo conjunto de meses: ${JSON.stringify(checks)}`);
}
if (Math.abs(checks.historicalAnnual - 131.42857142857142) > 1e-9) {
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
if (checks.augustPresentation.periodValue !== "1–18 de agosto de 2026" || checks.augustPresentation.periodDetail !== "Período parcial") {
  throw new Error(`El período parcial ejecutivo es incorrecto: ${JSON.stringify(checks.augustPresentation)}`);
}
if (checks.augustPresentation.observedTitle !== "Lluvia acumulada promedio por departamento" || checks.augustPresentation.historicalTitle !== "Lluvia habitual por departamento" || checks.augustPresentation.annualTitle !== "Lluvia acumulada promedio por departamento en 2026") {
  throw new Error(`Los títulos provinciales no son ejecutivos: ${JSON.stringify(checks.augustPresentation)}`);
}
if (checks.departmentPresentation.observedTitle !== "Lluvia acumulada en A" || checks.departmentPresentation.historicalTitle !== "Lluvia habitual en A" || checks.departmentPresentation.annualTitle !== "Lluvia acumulada en A en 2026" || checks.departmentPresentation.readingTitle !== "Lectura de A") {
  throw new Error(`Los títulos departamentales no responden al filtro: ${JSON.stringify(checks.departmentPresentation)}`);
}
if (checks.closedPresentation.periodValue !== "Diciembre 2024" || checks.closedPresentation.periodDetail !== "Mes completo" || checks.closedPresentation.historicalDetail !== "Para diciembre completo") {
  throw new Error(`El mes cerrado no tiene una presentación limpia: ${JSON.stringify(checks.closedPresentation)}`);
}
if (checks.positiveMonthNegativeYear.monthComparisonValue !== "+10 %" || !checks.positiveMonthNegativeYear.monthComparisonDetail.includes("por encima") || !checks.positiveMonthNegativeYear.annualComparisonValue.startsWith("−20")) {
  throw new Error(`La comparación positiva mensual / negativa anual es incorrecta: ${JSON.stringify(checks.positiveMonthNegativeYear)}`);
}
if (checks.negativeMonthPositiveYear.monthComparisonValue !== "−20 %" || !checks.negativeMonthPositiveYear.monthComparisonDetail.includes("por debajo") || !checks.negativeMonthPositiveYear.annualComparisonValue.startsWith("+20")) {
  throw new Error(`La comparación negativa mensual / positiva anual es incorrecta: ${JSON.stringify(checks.negativeMonthPositiveYear)}`);
}
if (!checks.positiveMonthNegativeYear.reading.includes("10 % por encima") || !checks.positiveMonthNegativeYear.reading.includes("20 % por debajo")) {
  throw new Error(`La lectura ejecutiva no combina mes y año: ${checks.positiveMonthNegativeYear.reading}`);
}
if (checks.noReferencePresentation.monthComparisonValue !== "Sin referencia histórica" || checks.noReferencePresentation.annualComparisonValue !== "Sin referencia histórica" || checks.noReferencePresentation.reading !== "No hay referencia histórica suficiente para realizar la comparación.") {
  throw new Error(`El caso sin referencia no está resguardado: ${JSON.stringify(checks.noReferencePresentation)}`);
}

const html = fs.readFileSync("index.html", "utf8");
const summaryMarkup = html.slice(html.indexOf('class="kpi-grid operational-kpis"'), html.indexOf('class="decision-grid"'));
for (const removed of ["Avance sobre histórico", "id=\"kpiMonthlyCategory\"", "Mes de referencia", "Observado del mes", "Diferencia vs. histórico", "Promedio histórico anual comparable", "Nota metodológica"]) {
  if (summaryMarkup.includes(removed)) throw new Error(`El detalle metodológico anterior sigue en la portada: ${removed}`);
}
for (const required of ["Período analizado", "Lluvia acumulada promedio por departamento", "Lluvia habitual por departamento", "Comparación con lo habitual", "Comparación anual con lo habitual", "Lectura provincial", "Situación reciente", "Observación satelital"]) {
  if (!summaryMarkup.includes(required)) throw new Error(`Falta el elemento ejecutivo: ${required}`);
}
const css = fs.readFileSync("operational.css", "utf8");
if (!css.includes('.operational-kpis .executive-comparison strong')) throw new Error('Las comparaciones principales no tienen mayor jerarquía visual.');

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
  const referenceDate = new Date("2026-08-14T12:00:00-03:00");
  const current = dailyCalendarParts(referenceDate);
  const departments = state.metadata.departments;
  const summary = monthlySummaryComparison({ departments: null, years: [2026], months: null }, referenceDate);
  const currentObservation = summaryCurrentMonthFromDaily(departments, 2026, current.month, current.isoDate);
  const monthAudit = ALL_MONTHS.map(month => {
    const entries = departments.map(department => {
      const row = monthlyRows().find(item => item.department === department && item.year === 2026);
      return { department, value: row?.months?.[month], source: row?.monthSources?.[month] };
    }).filter(entry => Number.isFinite(entry.value));
    const isCurrent = month === current.month;
    const monthPrefix = '2026-' + String(month + 1).padStart(2, '0') + '-';
    const dailyDepartments = new Set(state.operationalDailyRecords
      .filter(record => record.department && record.date?.startsWith(monthPrefix) && Number.isFinite(record.rainfallMm))
      .map(record => record.department));
    const referenceDailyDepartments = new Set(state.operationalDailyRecords
      .filter(record => record.department && record.date?.startsWith(monthPrefix) && (!isCurrent || record.date <= current.isoDate) && Number.isFinite(record.rainfallMm))
      .map(record => record.department));
    const rawMonthlyDepartments = state.rainfall
      .filter(row => row.year === 2026 && departments.includes(row.department) && Number.isFinite(row.months?.[month]))
      .map(row => row.department);
    const monthlyDepartments = entries.filter(entry => entry.source === 'monthly').map(entry => entry.department);
    const dailyDerivedDepartments = entries.filter(entry => entry.source === 'daily_derived').map(entry => entry.department);
    return {
      month,
      rawMonthlyDepartments,
      monthlyDepartments,
      dailyDerivedDepartments,
      combinedDepartments: entries.map(entry => entry.department),
      dailyDepartments: [...dailyDepartments],
      expectedDailyDerivedDepartments: [...dailyDepartments].filter(department => !rawMonthlyDepartments.includes(department)),
      operationalZeroDepartments: isCurrent ? departments.filter(department => !referenceDailyDepartments.has(department)) : [],
      expectedIncluded: isCurrent ? departments.length > 0 : entries.length > 0,
      expectedCoverage: isCurrent ? departments.length : entries.length
    };
  });
  return {
    period: summary.period,
    annualMonths: summary.annualMonths,
    annualAverageMm: summary.annualAverageMm,
    annualDetail: summary.annualDetail,
    departmentCount: departments.length,
    currentOperationalEntries: currentObservation.entries.map(entry => ({ department: entry.department, value: entry.value, daysWithRecords: entry.daysWithRecords })),
    monthAudit
  };
})()`, context);
if (realCurrentYear.period.year !== 2026 || realCurrentYear.period.month !== 7) {
  throw new Error(`La base real retrocedió desde agosto 2026: ${JSON.stringify(realCurrentYear)}`);
}
const monthNames = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const expectedAnnualMonths = realCurrentYear.monthAudit.filter(item => item.expectedIncluded).map(item => item.month);
if (JSON.stringify(realCurrentYear.annualMonths) !== JSON.stringify(expectedAnnualMonths)) {
  const expectedNames = expectedAnnualMonths.map(month => monthNames[month]);
  const actualNames = realCurrentYear.annualMonths.map(month => monthNames[month]);
  throw new Error(`Meses 2026 incorrectos. Esperados: ${expectedNames.join(", ")}. Obtenidos: ${actualNames.join(", ")}. Auditoría: ${JSON.stringify(realCurrentYear.monthAudit)}`);
}
const includedAudit = realCurrentYear.monthAudit.filter(item => item.expectedIncluded);
const expectedCoverages = includedAudit.map(item => item.expectedCoverage);
const minimumCoverage = Math.min(...expectedCoverages);
const maximumCoverage = Math.max(...expectedCoverages);
const expectedCoverageLabel = `cobertura ${minimumCoverage === maximumCoverage ? minimumCoverage : `${minimumCoverage}–${maximumCoverage}`} de ${realCurrentYear.departmentCount} deptos.`;
if (!realCurrentYear.annualDetail.includes(expectedCoverageLabel)) {
  throw new Error(`Cobertura 2026 incorrecta. Esperada: ${expectedCoverageLabel}. Obtenida: ${realCurrentYear.annualDetail}. Auditoría: ${JSON.stringify(realCurrentYear.monthAudit)}`);
}
const sortedJson = values => JSON.stringify([...values].sort((a, b) => a.localeCompare(b, "es")));
const provenanceMismatches = realCurrentYear.monthAudit.filter(item =>
  sortedJson(item.rawMonthlyDepartments) !== sortedJson(item.monthlyDepartments) ||
  sortedJson(item.expectedDailyDerivedDepartments) !== sortedJson(item.dailyDerivedDepartments) ||
  sortedJson([...item.rawMonthlyDepartments, ...item.expectedDailyDerivedDepartments]) !== sortedJson(item.combinedDepartments)
);
if (provenanceMismatches.length) {
  throw new Error(`La base combinada no preservó la procedencia mensual/diaria: ${JSON.stringify(provenanceMismatches)}`);
}
const futureMonthsWithData = realCurrentYear.monthAudit.filter(item => item.month > realCurrentYear.period.month && item.combinedDepartments.length);
const futureMonthsIncluded = realCurrentYear.annualMonths.filter(month => month > realCurrentYear.period.month);
if (futureMonthsWithData.length || futureMonthsIncluded.length) {
  throw new Error(`Los meses futuros deben permanecer sin datos y fuera del promedio: ${JSON.stringify({ futureMonthsWithData, futureMonthsIncluded })}`);
}
const currentAudit = realCurrentYear.monthAudit[realCurrentYear.period.month];
const invalidOperationalZeros = currentAudit.operationalZeroDepartments.filter(department => {
  const entry = realCurrentYear.currentOperationalEntries.find(item => item.department === department);
  return entry?.value !== 0 || entry?.daysWithRecords !== 0;
});
if (invalidOperationalZeros.length) {
  throw new Error(`Los ceros operativos del mes actual no quedaron separados de las observaciones reales: ${JSON.stringify(currentAudit)}`);
}
console.log(`Base real 2026: agosto permanece como referencia; ${realCurrentYear.annualMonths.length} meses válidos en el promedio anual.`);
