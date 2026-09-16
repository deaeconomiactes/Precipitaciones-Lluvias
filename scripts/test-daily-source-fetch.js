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
  return { root, dataDir: path.join(root, "data") };
}

async function startFixtureServer() {
  const records = JSON.stringify([{ date: "2026-09-01", department: "Capital", rain: 12.5 }]);
  const csv = "date,department,rain\n2026-09-01,Capital,12.5\n";
  const server = http.createServer((request, response) => {
    const routes = {
      "/json": [200, "application/json", records],
      "/html": [200, "text/html; charset=utf-8", "<!doctype html><html><body>Unable to open the file at this time.</body></html>"],
      "/empty": [200, "application/json", ""],
      "/invalid-json": [200, "application/json", "{not-json"],
      "/csv": [200, "text/csv", csv],
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
    result = await runBuilder(scenario.root, { SourceJsonUrl: `${baseUrl}/html`, SourceCsvUrl: `${baseUrl}/csv` });
    expectExit(result, 0, "C. el CSV alternativo debía recuperarse tras fallar JSON");
    assert.match(output(result), /Fuente válida encontrada: CSV #1/);
    fs.rmSync(scenario.root, { recursive: true, force: true });

    // D. Todas las fuentes fallan.
    scenario = createScenarioRoot();
    result = await runBuilder(scenario.root, { SourceJsonUrl: `${baseUrl}/html`, SourceCsvUrl: `${baseUrl}/invalid-csv` });
    expectExit(result, 1, "D. todas las fuentes inválidas debían fallar");
    assert.match(output(result), /No se encontraron fuentes diarias válidas/);
    assert.ok(!fs.existsSync(path.join(scenario.dataDir, "rainfall-daily-summary.json")), "No debe sobrescribirse metadata ante fallas.");
    fs.rmSync(scenario.root, { recursive: true, force: true });

    // E. Respuesta vacía.
    scenario = createScenarioRoot();
    result = await runBuilder(scenario.root, { SourceJsonUrl: `${baseUrl}/empty` });
    expectExit(result, 1, "E. una respuesta vacía debía fallar");
    assert.match(output(result), /respuesta vacía/);
    fs.rmSync(scenario.root, { recursive: true, force: true });

    // F. JSON malformado.
    scenario = createScenarioRoot();
    result = await runBuilder(scenario.root, { SourceJsonUrl: `${baseUrl}/invalid-json` });
    expectExit(result, 1, "F. JSON inválido debía fallar");
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
