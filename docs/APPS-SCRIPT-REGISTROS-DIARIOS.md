# Exportar registros diarios desde Apps Script

El dashboard de registro de lluvias ya usa `doPost(e)` para guardar backups en Google Sheets. Para que el dashboard de precipitaciones pueda leer esos registros sin modificar el flujo de carga, reemplazar el `doGet()` actual por esta version y agregar las funciones auxiliares.

Esta version une dos solapas:

- `plantilla_registro_lluvias.csv`: registros historicos anteriores.
- `Registros`: registros nuevos cargados desde el dashboard de registro.

```javascript
const EXPORT_SHEET_NAMES = ['plantilla_registro_lluvias.csv', 'Registros'];

function doGet(e) {
  const format = (e && e.parameter && e.parameter.format || 'json').toLowerCase();
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const rows = readAllRainRecords(spreadsheet);

  if (format === 'csv') {
    return csvResponse(rows);
  }

  return jsonResponse({
    ok: true,
    generatedAt: new Date().toISOString(),
    sources: EXPORT_SHEET_NAMES,
    records: rows
  });
}

function readAllRainRecords(spreadsheet) {
  const byKey = {};

  EXPORT_SHEET_NAMES.forEach(sheetName => {
    const sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) return;

    readRecordsFromSheet(sheet).forEach(record => {
      const key = record.id || [
        record.date,
        normalizeTextForKey(record.department),
        normalizeTextForKey(record.municipality),
        record.rain
      ].join('|');

      byKey[key] = record;
    });
  });

  return Object.keys(byKey)
    .map(key => byKey[key])
    .sort((a, b) =>
      String(a.date).localeCompare(String(b.date)) ||
      String(a.department).localeCompare(String(b.department)) ||
      String(a.municipality).localeCompare(String(b.municipality))
    );
}

function readRecordsFromSheet(sheet) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) return [];

  const values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  const headers = values[0].map(header => normalizeTextForKey(header));

  return values.slice(1)
    .map(row => rowToRainRecord(row, headers))
    .filter(record =>
      record.status !== 'deleted' &&
      record.date &&
      record.department &&
      record.rain !== ''
    );
}

function rowToRainRecord(row, headers) {
  return {
    id: getByAliases(row, headers, ['id']),
    date: formatDateForApi(getByAliases(row, headers, ['date', 'fecha'])),
    department: getByAliases(row, headers, ['department', 'departamento']),
    municipality: getByAliases(row, headers, ['municipality', 'localidad', 'municipio']),
    rain: normalizeNumberForApi(getByAliases(row, headers, ['rain', 'lluvia', 'precipitacion', 'precipitacion_mm', 'lluvia_mm', 'mm'])),
    lat: normalizeNumberForApi(getByAliases(row, headers, ['lat', 'latitude', 'latitud'])),
    lng: normalizeNumberForApi(getByAliases(row, headers, ['lng', 'lon', 'long', 'longitude', 'longitud'])),
    status: String(getByAliases(row, headers, ['status', 'estado']) || 'active').trim(),
    updatedAt: getByAliases(row, headers, ['updatedat', 'updated_at', 'actualizado'])
  };
}

function getByAliases(row, headers, aliases) {
  for (let index = 0; index < aliases.length; index++) {
    const position = headers.indexOf(normalizeTextForKey(aliases[index]));
    if (position >= 0) {
      const value = row[position];
      if (value !== null && value !== undefined && String(value).trim() !== '') {
        return value;
      }
    }
  }
  return '';
}

function formatDateForApi(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, 'America/Argentina/Buenos_Aires', 'yyyy-MM-dd');
  }
  return String(value).trim();
}

function normalizeNumberForApi(value) {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(String(value).replace(',', '.'));
  return Number.isFinite(number) ? number : '';
}

function normalizeTextForKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_');
}

function csvResponse(records) {
  const headers = ['date', 'department', 'municipality', 'rain', 'lat', 'lng'];
  const lines = [
    headers.join(','),
    ...records.map(record => headers.map(header => csvEscape(record[header])).join(','))
  ];

  return ContentService
    .createTextOutput(lines.join('\n'))
    .setMimeType(ContentService.MimeType.CSV);
}

function csvEscape(value) {
  const text = String(value === null || value === undefined ? '' : value);
  if (/[",\n\r]/.test(text)) {
    return '"' + text.replace(/"/g, '""') + '"';
  }
  return text;
}
```

Despues de publicar el Apps Script como Web App, guardar la URL `/exec` en la variable del repositorio:

`DAILY_RAIN_JSON_URL`

