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

function run(command, args, options = {}) {
  return childProcess.spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    ...options
  });
}

function runBuilder(root, sourcePath, generatedAt) {
  return run("pwsh", [
    "-NoProfile",
    "-File", builderPath,
    "-ProjectRoot", root,
    "-SourceJsonPath", sourcePath,
    "-GeneratedAt", generatedAt
  ]);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "daily-rainfall-metadata-"));
try {
  const dataDir = path.join(temporaryRoot, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const sourcePath = path.join(temporaryRoot, "source.json");
  fs.writeFileSync(sourcePath, JSON.stringify([
    { date: "2026-09-01", department: "Capital", rain: 12.5 },
    { date: "2026-09-01", department: "Goya", rain: 0 }
  ]));
  fs.writeFileSync(path.join(dataDir, "rainfall-daily-summary.json"), JSON.stringify({
    generatedAt: "2026-08-31T12:00:00Z",
    dateMin: "2026-08-31",
    dateMax: "2026-08-31",
    latestDataDate: "2026-08-31",
    daysSinceLatestData: 0,
    freshnessStatus: "updated"
  }));

  const updated = runBuilder(temporaryRoot, sourcePath, "2026-09-02T12:00:00Z");
  assert.strictEqual(updated.status, 0, `La actualización con datos nuevos falló: ${updated.stderr || updated.stdout}`);
  let summary = readJson(path.join(dataDir, "rainfall-daily-summary.json"));
  assert.deepStrictEqual(
    {
      dateMax: summary.dateMax,
      latestDataDate: summary.latestDataDate,
      daysSinceLatestData: summary.daysSinceLatestData,
      freshnessStatus: summary.freshnessStatus
    },
    { dateMax: "2026-09-01", latestDataDate: "2026-09-01", daysSinceLatestData: 1, freshnessStatus: "updated" },
    "Un dato nuevo no actualizó correctamente la metadata diaria."
  );

  const noNewData = runBuilder(temporaryRoot, sourcePath, "2026-09-02T18:00:00Z");
  assert.strictEqual(noNewData.status, 0, `La consulta sin novedades falló: ${noNewData.stderr || noNewData.stdout}`);
  summary = readJson(path.join(dataDir, "rainfall-daily-summary.json"));
  assert.strictEqual(summary.freshnessStatus, "no_new_data", "Una fuente correcta sin registros nuevos no quedó marcada como no_new_data.");
  assert.strictEqual(summary.dateMax, "2026-09-01", "Una consulta sin novedades modificó dateMax.");

  const stale = runBuilder(temporaryRoot, sourcePath, "2026-09-05T12:00:00Z");
  assert.strictEqual(stale.status, 0, `La consulta con datos atrasados falló: ${stale.stderr || stale.stdout}`);
  summary = readJson(path.join(dataDir, "rainfall-daily-summary.json"));
  assert.deepStrictEqual(
    { daysSinceLatestData: summary.daysSinceLatestData, freshnessStatus: summary.freshnessStatus },
    { daysSinceLatestData: 4, freshnessStatus: "stale" },
    "Los datos atrasados no quedaron identificados como stale."
  );

  const sourceFailure = runBuilder(temporaryRoot, path.join(temporaryRoot, "missing-source.json"), "2026-09-05T12:00:00Z");
  assert.notStrictEqual(sourceFailure.status, 0, "Una fuente inexistente no hizo fallar la actualización.");
  assert.match(`${sourceFailure.stderr}\n${sourceFailure.stdout}`, /No se encontro la fuente JSON local/, "La falla de fuente no informa una causa clara.");

  const validMetadata = run(process.execPath, [validatorPath, "--data-dir", dataDir]);
  assert.strictEqual(validMetadata.status, 0, `La metadata válida no superó el contrato: ${validMetadata.stderr || validMetadata.stdout}`);
  delete summary.latestDataDate;
  fs.writeFileSync(path.join(dataDir, "rainfall-daily-summary.json"), JSON.stringify(summary));
  const invalidMetadata = run(process.execPath, [validatorPath, "--data-dir", dataDir]);
  assert.notStrictEqual(invalidMetadata.status, 0, "La metadata inválida no hizo fallar el contrato.");
  assert.match(`${invalidMetadata.stderr}\n${invalidMetadata.stdout}`, /latestDataDate/, "La falla de metadata no identifica el campo faltante.");

  console.log("Metadata diaria: escenarios con datos nuevos, sin novedades, atraso, fuente fallida y metadata inválida validados.");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
