#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const dataDirIndex = args.indexOf("--data-dir");
const dataDir = dataDirIndex >= 0
  ? path.resolve(args[dataDirIndex + 1] || "")
  : path.resolve(__dirname, "..", "data");

function fail(message) {
  throw new Error(`ERROR: ${message}`);
}

function readJson(fileName) {
  const filePath = path.join(dataDir, fileName);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
    fail(`no se generó data/${fileName}.`);
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    fail(`${fileName} inválido: ${error.message}`);
  }
}

function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function calendarDaysBetween(fromDate, toDate) {
  const toUtc = value => Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
  return Math.round((toUtc(toDate) - toUtc(fromDate)) / 86400000);
}

function generatedCalendarDate(value) {
  if (typeof value !== "string" || !value.trim() || Number.isNaN(Date.parse(value))) {
    fail(`generatedAt no es una fecha ISO válida: ${value}`);
  }
  const date = value.slice(0, 10);
  if (!isIsoDate(date)) fail(`generatedAt no contiene una fecha calendario válida: ${value}`);
  return date;
}

function validate() {
  const daily = readJson("rainfall-daily.json");
  if (!Array.isArray(daily) || daily.length === 0) {
    fail("rainfall-daily.json no contiene registros válidos.");
  }
  const dates = daily.map((record, index) => {
    if (!record || !isIsoDate(record.date)) fail(`rainfall-daily.json contiene una fecha inválida en el registro ${index}.`);
    if (!record.department || !Number.isFinite(Number(record.rainfallMm))) {
      fail(`rainfall-daily.json contiene un registro inválido en la posición ${index}.`);
    }
    return record.date;
  }).sort();

  const summary = readJson("rainfall-daily-summary.json");
  const generatedDate = generatedCalendarDate(summary.generatedAt);
  const actualDateMin = dates[0];
  const actualDateMax = dates[dates.length - 1];
  if (summary.dateMin !== actualDateMin) fail(`dateMin (${summary.dateMin}) no coincide con el primer registro real (${actualDateMin}).`);
  if (summary.dateMax !== actualDateMax) fail(`dateMax (${summary.dateMax}) no coincide con el último registro real (${actualDateMax}).`);
  if (summary.latestDataDate !== summary.dateMax) fail("latestDataDate debe coincidir con dateMax.");
  if (summary.records !== daily.length) fail(`records (${summary.records}) no coincide con rainfall-daily.json (${daily.length}).`);

  const expectedDays = calendarDaysBetween(summary.latestDataDate, generatedDate);
  if (!Number.isInteger(summary.daysSinceLatestData) || summary.daysSinceLatestData !== expectedDays || expectedDays < 0) {
    fail(`daysSinceLatestData debe ser ${expectedDays} según generatedAt y latestDataDate.`);
  }
  const allowedStatuses = new Set(["updated", "stale", "no_new_data"]);
  if (!allowedStatuses.has(summary.freshnessStatus)) fail(`freshnessStatus inválido: ${summary.freshnessStatus}`);
  if (expectedDays > 1 && summary.freshnessStatus !== "stale") {
    fail(`freshnessStatus debe ser stale cuando el último dato tiene ${expectedDays} días calendario.`);
  }
  if (expectedDays <= 1 && summary.freshnessStatus === "stale") {
    fail("freshnessStatus no puede ser stale cuando el último dato está dentro de un día calendario.");
  }

  console.log(`[daily-rainfall] Validación OK: generatedAt=${summary.generatedAt}, latestDataDate=${summary.latestDataDate}, daysSinceLatestData=${summary.daysSinceLatestData}, freshnessStatus=${summary.freshnessStatus}, records=${daily.length}`);
}

try {
  validate();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
