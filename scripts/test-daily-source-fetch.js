#!/usr/bin/env node
"use strict";

const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const builderPath = path.join(projectRoot, "scripts", "build-daily-data.ps1");

function normalize(text) {
  return String(text)
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[|~]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function output(result) {
  return normalize([`exit=${result.status}`, result.stdout, result.stderr].filter(Boolean).join("\n"));
}

function runBuilder(root, options) {
  const args = ["-NoProfile", "-File", builderPath, "-ProjectRoot", root, "-GeneratedAt", "2026-09-01T12:00:00Z", "-RetryDelaysSeconds", "0"];
  for (const [name, value] of Object.entries(options)) args.push(`-${name}`, value);
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn("pwsh", args, {
      cwd: projectRoot,
      env: {
        ...process.env,
        DAILY_RAIN_JSON_URL: "",
        DAILY_RAIN_JSON_PATH: "",
        DAILY_RAIN_CSV_URL: "",
        DAILY_RAIN_CSV_URLS: "",
        DAILY_RAIN_CSV_PATH: ""
      }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", status => resolve({ status, stdout, stderr }));
  });
}

function expectExit(result, expected, label) {
  assert.strictEqual(result.status, expected, `${label}\n${output(result)}`);
}

function createScenarioRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "daily-rainfall-source-"));
  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  return { root, dataDir };
}
function writeJson(filePath, value) { fs.writeFileSync(filePath, JSON.stringify(value)); }

async function startFixtureServer() {
  const records = JSON.stringify([{ date: "2026-09-01", department: "Capital", rain: 12.5 }]);
  const csv = "date,department,rain\n2026-09-01,Capital,12.5\n";
  const server = http.createServer((request, response) => {
    const routes = {
      "/json": [200, "application/json", records],
      "/html": [200, "text/html; charset=utf-8", "<!doctype html><html><body>Unable to open the file at this time.</body></html>"],
      "/not-found": [404, "text/plain", "Not Found"],
      "/empty": [200, "application/json", ""],
      "/invalid-json": [200, "application/json", "{not-json"],
      "/csv": [200, "text/csv", csv],
      "/csv-zero": [200, "text/csv", "date,department,rain\n2026-09-01,Capital,0\n"],
      "/invalid-csv": [200, "text/html", "<html>Unable to open the file at this time.</html>"]
    };
    const [status, contentType, body] = routes[request.url] || [404, "text/plain", "not found"];
    response.writeHead(status, { "Content-Type": contentType });
    response.end(body);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function main() {
  const { server, baseUrl } = await startFixtureServer();
  try {
    // A. JSON válido.
    let scenario = createScenarioRoot();
    let result = await runBuilder(scenario.root, { SourceJsonUrl: `${baseUrl}/json` });
    expectExit(result, 0, "A. la fuente JSON válida debía pasar");
    assert.ok(fs.existsSync(path.join(scenario.dataDir, "rainfall-daily.json")));
    fs.rmSync(scenario.root, { recursive: true, force: true });

    // B. HTML en una fuente declarada JSON.
    scenario = createScenarioRoot();
    result = await runBuilder(scenario.root, { SourceJsonUrl: `${baseUrl}/html` });
    expectExit(result, 1, "B. HTML no debía aceptarse como JSON");
    assert.match(output(result), /HTML\/no JSON/);
    assert.ok(!fs.existsSync(path.join(scenario.dataDir, "rainfall-daily.json")), "No debe escribirse salida al recibir HTML.");
    fs.rmSync(scenario.root, { recursive: true, force: true });

    // C. Fallback: JSON falla, CSV responde registros válidos.
    scenario = createScenarioRoot();
    result = await runBuilder(scenario.root, { SourceJsonUrl: `${baseUrl}/not-found`, SourceCsvUrl: `${baseUrl}/csv-zero` });
    expectExit(result, 0, "C. el CSV alternativo debía recuperarse tras fallar JSON");
    assert.match(output(result), /Fuente válida encontrada: CSV #1/);
    const csvPayload = JSON.parse(fs.readFileSync(path.join(scenario.dataDir, "rainfall-daily.json"), "utf8"));
    const csvRows = Array.isArray(csvPayload) ? csvPayload : [csvPayload];
    assert.strictEqual(csvRows[0].rainfallMm, 0, "0 mm debe conservarse como dato válido.");
    fs.rmSync(scenario.root, { recursive: true, force: true });

    // D. Todas las fuentes remotas fallan, pero la última base publicada es válida.
    scenario = createScenarioRoot();
    const previousDaily = [{ date: "2026-08-31", department: "Capital", rainfallMm: 7.5, lat: -27.4692, lng: -58.8306 }];
    const previousSummary = { generatedAt: "2026-08-31T12:00:00Z", dateMin: "2026-08-31", dateMax: "2026-08-31", latestDataDate: "2026-08-31", daysSinceLatestData: 0, freshnessStatus: "updated", records: 1 };
    writeJson(path.join(scenario.dataDir, "rainfall-daily.json"), previousDaily);
    writeJson(path.join(scenario.dataDir, "rainfall-daily-summary.json"), previousSummary);
    result = await runBuilder(scenario.root, { SourceJsonUrl: `${baseUrl}/html`, SourceCsvUrl: `${baseUrl}/invalid-csv` });
    expectExit(result, 0, "D. una base previa válida debía activar fallback sin datos nuevos");
    assert.match(output(result), /Se conserva la última base diaria válida/);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(scenario.dataDir, "rainfall-daily.json"), "utf8")), previousDaily);
    const fallbackSummary = JSON.parse(fs.readFileSync(path.join(scenario.dataDir, "rainfall-daily-summary.json"), "utf8"));
    assert.strictEqual(fallbackSummary.sourceStatus, "fallback_previous_valid");
    assert.strictEqual(fallbackSummary.fallbackUsed, true);
    fs.rmSync(scenario.root, { recursive: true, force: true });

    // E. Todas las fuentes fallan sin base previa.
    scenario = createScenarioRoot();
    result = await runBuilder(scenario.root, { SourceJsonUrl: `${baseUrl}/html`, SourceCsvUrl: `${baseUrl}/invalid-csv` });
    expectExit(result, 1, "E. todas las fuentes inválidas sin base previa debían fallar");
    assert.match(output(result), /No se encontraron fuentes diarias válidas/);
    assert.ok(!fs.existsSync(path.join(scenario.dataDir, "rainfall-daily-summary.json")), "No debe sobrescribirse metadata ante fallas.");
    fs.rmSync(scenario.root, { recursive: true, force: true });

    // F. Respuesta vacía.
    scenario = createScenarioRoot();
    result = await runBuilder(scenario.root, { SourceJsonUrl: `${baseUrl}/empty` });
    expectExit(result, 1, "F. una respuesta vacía debía fallar");
    assert.match(output(result), /respuesta vacía/);
    fs.rmSync(scenario.root, { recursive: true, force: true });

    // G. JSON malformado.
    scenario = createScenarioRoot();
    result = await runBuilder(scenario.root, { SourceJsonUrl: `${baseUrl}/invalid-json` });
    expectExit(result, 1, "G. JSON inválido debía fallar");
    assert.match(output(result), /JSON inválido/);
    fs.rmSync(scenario.root, { recursive: true, force: true });

    console.log("Fuentes diarias: JSON válido, HTML, fallback CSV, errores totales, vacío y JSON inválido validados.");
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
