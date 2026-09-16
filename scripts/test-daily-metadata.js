#!/usr/bin/env node
"use strict";

const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const projectRoot = path.resolve(__dirname, "..");
const builderPath = path.join(projectRoot, "scripts", "build-daily-data.ps1");
const validatorPath = path.join(projectRoot, "scripts", "validate-daily-rainfall.js");

function run(command, args, options = {}) { return childProcess.spawnSync(command, args, { cwd: projectRoot, encoding: "utf8", ...options }); }
function output(result) { return [`exit=${result.status}`, result.stdout && `stdout:\n${result.stdout}`, result.stderr && `stderr:\n${result.stderr}`].filter(Boolean).join("\n"); }
function assertExit(result, expected, scenario) { assert.strictEqual(result.status, expected, `[daily-metadata-test] ${scenario}\n${output(result)}`); }
function runBuilder(root, sourcePath, generatedAt) {
  return run("pwsh", ["-NoProfile", "-File", builderPath, "-ProjectRoot", root, "-SourceJsonPath", sourcePath, "-GeneratedAt", generatedAt], {
    // El fixture debe ser la única fuente del test, incluso dentro del workflow.
    env: {
      ...process.env,
      DAILY_RAIN_JSON_URL: "",
      DAILY_RAIN_JSON_PATH: "",
      DAILY_RAIN_CSV_URL: "",
      DAILY_RAIN_CSV_URLS: "",
      DAILY_RAIN_CSV_PATH: ""
    }
  });
}
function runValidator(dataDir) { return run(process.execPath, [validatorPath, "--data-dir", dataDir]); }
function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")); }
function writeJson(filePath, value) { fs.writeFileSync(filePath, JSON.stringify(value)); }
function fixtureLatestDate(records) { return records.map(record => record.date).sort().at(-1); }
function generatedAtFrom(date, daysAfter = 0) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + daysAfter);
  return value.toISOString().replace(".000Z", "Z");
}

function expectContractFailure(dataDir, summary, contract, field) {
  writeJson(path.join(dataDir, "rainfall-daily-summary.json"), summary);
  const result = runValidator(dataDir);
  assertExit(result, 1, `el contrato ${contract}.${field} debía fallar`);
  const text = output(result);
  assert.match(text, new RegExp(`contract=${contract}`), `No se informó el contrato fallido.\n${text}`);
  assert.match(text, new RegExp(`field=${field}`), `No se informó el campo fallido.\n${text}`);
  assert.match(text, /severity=error/, `No se informó la severidad error.\n${text}`);
}

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "daily-rainfall-metadata-"));
try {
  const dataDir = path.join(temporaryRoot, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const sourcePath = path.join(temporaryRoot, "source.json");
  const fixtureRecords = [{ date: "2026-09-01", department: "Capital", rain: 12.5 }, { date: "2026-09-01", department: "Goya", rain: 0 }];
  const fixtureDateMax = fixtureLatestDate(fixtureRecords);
  const generatedAt = generatedAtFrom(fixtureDateMax);
  writeJson(sourcePath, fixtureRecords);
  writeJson(path.join(dataDir, "rainfall-daily-summary.json"), { generatedAt: "2026-08-31T12:00:00Z", dateMin: "2026-08-31", dateMax: "2026-08-31", latestDataDate: "2026-08-31", daysSinceLatestData: 0, freshnessStatus: "updated" });

  // A. Metadata válida y actualizada.
  const updated = runBuilder(temporaryRoot, sourcePath, generatedAt);
  assertExit(updated, 0, "A. el builder debía aceptar datos nuevos");
  let summary = readJson(path.join(dataDir, "rainfall-daily-summary.json"));
  assert.deepStrictEqual({ dateMax: summary.dateMax, latestDataDate: summary.latestDataDate, daysSinceLatestData: summary.daysSinceLatestData, freshnessStatus: summary.freshnessStatus }, { dateMax: fixtureDateMax, latestDataDate: fixtureDateMax, daysSinceLatestData: 0, freshnessStatus: "updated" });
  let validation = runValidator(dataDir);
  assertExit(validation, 0, "A. metadata válida y actualizada debía pasar");

  // C. Fuente correcta sin datos nuevos.
  const noNewData = runBuilder(temporaryRoot, sourcePath, generatedAt);
  assertExit(noNewData, 0, "C. una consulta sin novedades debía pasar");
  summary = readJson(path.join(dataDir, "rainfall-daily-summary.json"));
  assert.strictEqual(summary.freshnessStatus, "no_new_data");
  validation = runValidator(dataDir);
  assertExit(validation, 0, "C. no_new_data debía ser warning y no error");
  assert.match(output(validation), /contract=source_without_new_data.*severity=warning/);

  // B. Metadata válida pero atrasada.
  const stale = runBuilder(temporaryRoot, sourcePath, generatedAtFrom(fixtureDateMax, 4));
  assertExit(stale, 0, "B. datos atrasados debían pasar el builder");
  summary = readJson(path.join(dataDir, "rainfall-daily-summary.json"));
  assert.deepStrictEqual({ daysSinceLatestData: summary.daysSinceLatestData, freshnessStatus: summary.freshnessStatus }, { daysSinceLatestData: 4, freshnessStatus: "stale" });
  validation = runValidator(dataDir);
  assertExit(validation, 0, "B. stale debía ser warning y no error");
  assert.match(output(validation), /contract=data_freshness.*severity=warning/);

  // La inconsistencia temporal es un caso separado y debe seguir siendo fatal.
  const futureData = runBuilder(temporaryRoot, sourcePath, generatedAtFrom(fixtureDateMax, -1));
  assertExit(futureData, 1, "rechaza latestDataDate posterior a generatedAt");
  assert.match(output(futureData), /es posterior a la fecha de generación/);

  const validSummary = { ...summary };
  // D. Metadata inválida.
  expectContractFailure(dataDir, { ...validSummary, freshnessStatus: "expired" }, "recognized_freshness_status", "freshnessStatus");
  // E. Falta latestDataDate.
  const withoutLatest = { ...validSummary }; delete withoutLatest.latestDataDate;
  expectContractFailure(dataDir, withoutLatest, "required_field", "latestDataDate");
  // F. Falta generatedAt.
  const withoutGenerated = { ...validSummary }; delete withoutGenerated.generatedAt;
  expectContractFailure(dataDir, withoutGenerated, "required_field", "generatedAt");
  // G. Sin justificación, latestDataDate distinto de dateMax es error crítico.
  expectContractFailure(dataDir, { ...validSummary, latestDataDate: "2026-08-31" }, "latest_date_consistency", "latestDataDate");

  writeJson(path.join(dataDir, "rainfall-daily-summary.json"), { ...validSummary, freshnessStatus: "unknown" });
  validation = runValidator(dataDir);
  assertExit(validation, 0, "freshnessStatus=unknown debía pasar con warning");

  const sourceFailure = runBuilder(temporaryRoot, path.join(temporaryRoot, "missing-source.json"), "2026-09-05T12:00:00Z");
  assert.notStrictEqual(sourceFailure.status, 0, `[daily-metadata-test] una fuente inexistente debía fallar\n${output(sourceFailure)}`);
  assert.match(output(sourceFailure), /No se encontro la fuente JSON local/);
  console.log("[daily-metadata-test] OK: escenarios A-G, unknown y falla de fuente validados; stale/no_new_data son warnings no fatales.");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
