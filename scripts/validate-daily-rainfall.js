#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const args = process.argv.slice(2);
const dataDirIndex = args.indexOf("--data-dir");
const dataDir = dataDirIndex >= 0 ? path.resolve(args[dataDirIndex + 1] || "") : path.resolve(__dirname, "..", "data");
const errors = [];
const warnings = [];

function display(value) { return value === undefined ? "<ausente>" : JSON.stringify(value); }
function report(severity, contract, field, actual, expected, message) {
  const issue = { severity, contract, field, actual, expected, message };
  (severity === "error" ? errors : warnings).push(issue);
  const label = severity === "error" ? "ERROR" : "Warning";
  console[severity === "error" ? "error" : "warn"](`[daily-metadata] ${label}: contract=${contract}; field=${field}; actual=${display(actual)}; expected=${display(expected)}; severity=${severity}; ${message}`);
}
function error(...values) { report("error", ...values); }
function warning(...values) { report("warning", ...values); }

function readJson(fileName) {
  const filePath = path.join(dataDir, fileName);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
    error("file_exists", fileName, fs.existsSync(filePath) ? "empty" : "missing", "non-empty JSON file", `${fileName} no existe o está vacío.`);
    return null;
  }
  try { return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")); }
  catch (cause) {
    error("valid_json", fileName, cause.message, "valid JSON", `${fileName} no es JSON válido.`);
    return null;
  }
}

function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function generatedCalendarDate(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}
function calendarDaysBetween(fromDate, toDate) {
  const toUtc = value => Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
  return Math.round((toUtc(toDate) - toUtc(fromDate)) / 86400000);
}

function validate() {
  const daily = readJson("rainfall-daily.json");
  const summary = readJson("rainfall-daily-summary.json");
  if (daily === null || summary === null) return;
  if (!Array.isArray(daily) || daily.length === 0) {
    error("daily_has_records", "rainfall-daily.json", Array.isArray(daily) ? daily.length : typeof daily, "> 0 records", "rainfall-daily.json no contiene registros.");
  }
  for (const field of ["generatedAt", "dateMax", "latestDataDate", "freshnessStatus"]) {
    if (summary[field] === undefined || summary[field] === null || summary[field] === "") error("required_field", field, summary[field], "present", `Falta ${field} en rainfall-daily-summary.json.`);
  }
  for (const field of ["dateMax", "latestDataDate"]) {
    if (summary[field] !== undefined && summary[field] !== null && summary[field] !== "" && !isIsoDate(summary[field])) error("iso_calendar_date", field, summary[field], "YYYY-MM-DD", `${field} tiene formato inválido.`);
  }
  if (summary.dateMax !== undefined && summary.latestDataDate !== undefined && summary.latestDataDate !== summary.dateMax) {
    error("latest_date_consistency", "latestDataDate", summary.latestDataDate, summary.dateMax, "latestDataDate y dateMax deben representar la misma última fecha real.");
  }
  if (typeof summary.daysSinceLatestData !== "number" || !Number.isFinite(summary.daysSinceLatestData)) {
    error("numeric_freshness_age", "daysSinceLatestData", summary.daysSinceLatestData, "finite number", "daysSinceLatestData no es numérico.");
  }
  const allowedStatuses = new Set(["updated", "no_new_data", "stale", "unknown"]);
  if (summary.freshnessStatus !== undefined && summary.freshnessStatus !== null && summary.freshnessStatus !== "" && !allowedStatuses.has(summary.freshnessStatus)) {
    error("recognized_freshness_status", "freshnessStatus", summary.freshnessStatus, [...allowedStatuses], "freshnessStatus tiene un valor no reconocido.");
  }
  const generatedDate = generatedCalendarDate(summary.generatedAt);
  if (summary.generatedAt && !generatedDate) warning("generated_at_parseable", "generatedAt", summary.generatedAt, "parseable date-time", "generatedAt está presente pero no pudo interpretarse como fecha/hora.");
  if (generatedDate && isIsoDate(summary.latestDataDate) && typeof summary.daysSinceLatestData === "number" && Number.isFinite(summary.daysSinceLatestData)) {
    const calculatedDays = calendarDaysBetween(summary.latestDataDate, generatedDate);
    if (summary.daysSinceLatestData !== calculatedDays) warning("freshness_age_consistency", "daysSinceLatestData", summary.daysSinceLatestData, calculatedDays, "La antigüedad informada no coincide con generatedAt y latestDataDate.");
  }
  if (summary.freshnessStatus === "stale") {
    warning("data_freshness", "latestDataDate", summary.latestDataDate, "informational only", `latestDataDate está atrasado. Último dato real: ${summary.latestDataDate}; archivo generado: ${summary.generatedAt}; daysSinceLatestData: ${summary.daysSinceLatestData}; freshnessStatus: stale.`);
  } else if (summary.freshnessStatus === "no_new_data") {
    warning("source_without_new_data", "freshnessStatus", summary.freshnessStatus, "informational only", `La fuente respondió correctamente pero no trajo registros nuevos. Último dato real: ${summary.latestDataDate}.`);
  } else if (summary.freshnessStatus === "unknown") {
    warning("data_freshness", "freshnessStatus", summary.freshnessStatus, "informational only", "No fue posible determinar la frescura; la estructura del contrato sigue siendo válida.");
  }
  if (errors.length === 0) console.log(`[daily-metadata] OK: 0 error(es), ${warnings.length} warning(s). generatedAt=${summary.generatedAt}, latestDataDate=${summary.latestDataDate}, daysSinceLatestData=${summary.daysSinceLatestData}, freshnessStatus=${summary.freshnessStatus}, records=${Array.isArray(daily) ? daily.length : "invalid"}`);
  else console.error(`[daily-metadata] FAILED: ${errors.length} error(es), ${warnings.length} warning(s).`);
}

validate();
if (errors.length > 0) process.exitCode = 1;
