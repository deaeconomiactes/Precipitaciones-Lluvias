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

const categories = vm.runInContext(`[
  classifyDailyReference(10, 2, 1).label,
  classifyDailyReference(-50, 3, 1).label,
  classifyDailyReference(-20, 3, 1).label,
  classifyDailyReference(20, 3, 1).label,
  classifyDailyReference(50, 3, 1).label
]`, context);

const expectedCategories = [
  "Referencia insuficiente",
  "Muy por debajo",
  "Por debajo",
  "Por encima",
  "Muy por encima"
];
if (JSON.stringify(categories) !== JSON.stringify(expectedCategories)) {
  throw new Error(`Categorias inesperadas: ${JSON.stringify(categories)}`);
}

const coverageChecks = vm.runInContext(`(() => {
  const completeZeros = [];
  const sparseZeros = [];
  [2022, 2023, 2024, 2025].forEach(year => {
    for (let day = 1; day <= 7; day += 1) {
      completeZeros.push({ department: "Completo", date: year + "-08-" + String(day).padStart(2, "0"), rainfallMm: 0 });
      if (day <= 4) sparseZeros.push({ department: "Incompleto", date: year + "-08-" + String(day).padStart(2, "0"), rainfallMm: 0 });
    }
  });
  const complete = dailyHistoricalWindowReference(completeZeros, "Completo", "2026-08-07", 7);
  const sparse = dailyHistoricalWindowReference(sparseZeros, "Incompleto", "2026-08-07", 7);
  return {
    completeYears: complete.yearsComparable,
    completeCoverage: complete.comparable.map(item => item.daysWithRecords),
    completeAverage: complete.averageMm,
    sparseYears: sparse.yearsComparable
  };
})()`, context);

if (coverageChecks.completeYears.length !== 4 || coverageChecks.completeCoverage.some(value => value !== 7)) {
  throw new Error(`Los ceros explicitos no se contaron como dias observados: ${JSON.stringify(coverageChecks)}`);
}
if (coverageChecks.completeAverage !== 0) {
  throw new Error("Los acumulados de 0 mm no se conservaron como valores validos.");
}
if (coverageChecks.sparseYears.length !== 0) {
  throw new Error("Una ventana con menos de 5/7 dias supero incorrectamente la cobertura minima.");
}

context.inputRecords = JSON.parse(fs.readFileSync("data/rainfall-daily-combined.json", "utf8"));
context.inputDepartments = [...new Set(context.inputRecords.map(record => record.department))];
context.inputLatestDate = context.inputRecords.reduce((latest, record) => record.date > latest ? record.date : latest, "");
const temporalFilterChecks = vm.runInContext(`(() => {
  state.dailyRecords = inputRecords;
  const records = validDailyReferenceRecords({ departments: null, years: [2026], months: [7] });
  const years = [...new Set(records.map(record => Number(record.date.slice(0, 4))))].sort((a, b) => a - b);
  return {
    firstYear: years[0],
    lastYear: years[years.length - 1],
    latestDate: records[records.length - 1].date,
    totalRecords: records.length
  };
})()`, context);

if (temporalFilterChecks.firstYear !== 2015 || temporalFilterChecks.lastYear !== 2026) {
  throw new Error(`Año o Mes recortaron la referencia diaria: ${JSON.stringify(temporalFilterChecks)}`);
}
if (temporalFilterChecks.latestDate !== context.inputLatestDate || temporalFilterChecks.totalRecords !== context.inputRecords.length) {
  throw new Error(`La referencia diaria no uso toda la base combinada: ${JSON.stringify(temporalFilterChecks)}`);
}

const realSignals = vm.runInContext(`[
  dailyReferenceSignal(inputRecords, inputDepartments, inputLatestDate, 7, "base diaria combinada"),
  dailyReferenceSignal(inputRecords, inputDepartments, inputLatestDate, 15, "base diaria combinada"),
  dailyReferenceSignal(inputRecords, inputDepartments, inputLatestDate, 30, "base diaria combinada")
]`, context);

if (realSignals.some(signal => signal.yearsComparable.includes(Number(context.inputLatestDate.slice(0, 4))))) {
  throw new Error("El año observado se incluyo dentro de su propia referencia historica.");
}
if (realSignals.some(signal => signal.departmentsComparable < 2)) {
  throw new Error("No hay suficientes departamentos para validar el promedio departamental.");
}
const recentSevenDaySum = vm.runInContext(`inputDepartments.reduce((sum, department) => {
  const rows = dailyWindowRecords(inputRecords.filter(record => record.department === department), inputLatestDate, 7);
  return sum + rows.reduce((subtotal, record) => subtotal + record.rainfallMm, 0);
}, 0)`, context);
if (!(realSignals[0].observedMm < recentSevenDaySum)) {
  throw new Error("La lectura de todos los departamentos parece sumar mm en lugar de promediarlos.");
}

const expectedStarts = ["2026-07-30", "2026-07-22", "2026-07-07"];
if (JSON.stringify(realSignals.map(signal => signal.periodStart)) !== JSON.stringify(expectedStarts)) {
  throw new Error(`Ventanas observadas inesperadas: ${JSON.stringify(realSignals.map(signal => signal.periodStart))}`);
}
if (realSignals.some(signal => signal.observedDays <= 0 || signal.possibleObservedDays <= 0)) {
  throw new Error("La cobertura observada no genero dias-departamento validos.");
}

context.curuzuRecords = vm.runInContext(`validDailyReferenceRecords({
  departments: ["Curuzu Cuatia"],
  years: [2026],
  months: [7]
})`, context);
context.curuzuLatestDate = context.curuzuRecords[context.curuzuRecords.length - 1].date;
const curuzuSignals = vm.runInContext(`[
  dailyReferenceSignal(curuzuRecords, ["Curuzu Cuatia"], curuzuLatestDate, 7, "base diaria combinada"),
  dailyReferenceSignal(curuzuRecords, ["Curuzu Cuatia"], curuzuLatestDate, 15, "base diaria combinada"),
  dailyReferenceSignal(curuzuRecords, ["Curuzu Cuatia"], curuzuLatestDate, 30, "base diaria combinada")
]`, context);
if (context.curuzuLatestDate !== context.inputLatestDate || curuzuSignals.some(signal => signal.departmentsComparable !== 1)) {
  throw new Error(`Curuzu Cuatia no se recalculo como departamento unico: ${JSON.stringify(curuzuSignals)}`);
}
if (curuzuSignals.some(signal => signal.yearsComparable.length < 3)) {
  throw new Error("Curuzu Cuatia quedo sin suficientes años comparables.");
}

const workflow = fs.readFileSync(".github/workflows/deploy-pages.yml", "utf8");
for (const requiredFile of ["rainfall-daily-history.json", "rainfall-daily-combined.json"]) {
  if (!workflow.includes(`data/${requiredFile}`) || !workflow.includes(`test -s _site/data/${requiredFile}`)) {
    throw new Error(`El artefacto de GitHub Pages no valida ${requiredFile}.`);
  }
}
const appSource = fs.readFileSync("app.js", "utf8");
if (!appSource.includes("deriveMonthlyFromDailyRecords(state.operationalDailyRecords)")) {
  throw new Error("La mensualizacion dejo de usar la base diaria operativa separada.");
}

console.log("Categorias descriptivas: limites validados.");
console.log("Cobertura historica: 70% validado; 0 mm cuenta como dia observado.");
console.log("Filtros Año/Mes: no recortan la referencia diaria 2015-2026.");
console.log(`Referencia real: ventanas 7/15/30 con ${realSignals[0].yearsComparable.length} años; año actual excluido.`);
console.log(`Todos los departamentos: promedio de ${realSignals[0].departmentsComparable} comparables, sin suma provincial.`);
console.log(`Curuzu Cuatia: ventanas recalculadas con ${curuzuSignals[0].yearsComparable.length} años comparables.`);
console.log("GitHub Pages: base histórica y combinada incluidas y verificadas.");
console.log("Pruebas de referencia diaria completadas sin errores.");
