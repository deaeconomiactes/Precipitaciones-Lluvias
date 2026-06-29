# Exportar registros diarios desde Apps Script

El dashboard de registro de lluvias ya usa `doPost(e)` para guardar backups en Google Sheets. Para que el dashboard de precipitaciones pueda leer esos registros sin modificar el flujo de carga, reemplazar el `doGet()` actual por esta version.

```javascript
function doGet(e) {
  const format = (e && e.parameter && e.parameter.format || 'json').toLowerCase();
  const sheet = getBackupSheet();
  const rows = readActiveRecords(sheet);

  if (format === 'csv') {
    return csvResponse(rows);
  }

  return jsonResponse({
    ok: true,
    generatedAt: new Date().toISOString(),
    records: rows
  });
}

function readActiveRecords(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  return values
    .map(row => ({
      id: row[0] || '',
      date: formatDateForApi(row[1]),
      department: row[2] || '',
      municipality: row[3] || '',
      rain: normalizeNumberForApi(row[4]),
      lat: normalizeNumberForApi(row[5]),
      lng: normalizeNumberForApi(row[6]),
      status: row[8] || '',
      updatedAt: row[9] || ''
    }))
    .filter(record =>
      record.status !== 'deleted' &&
      record.date &&
      record.department &&
      record.rain !== ''
    );
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

