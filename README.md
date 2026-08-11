# Registro y Seguimiento de Precipitaciones

Aplicación web estática e independiente del **Departamento de Economía Agraria** como herramienta de apoyo a la gestión. Organiza precipitaciones departamentales y variables de estaciones meteorológicas para facilitar una lectura territorial. Usa únicamente los archivos `.xls` incluidos en esta carpeta.

## Ejecutar

Los JSON necesarios ya están generados en `data/`. Para abrir el dashboard, iniciá un servidor HTTP desde esta carpeta:

```powershell
python -m http.server 8000
```

Luego abrí `http://localhost:8000`. No funciona correctamente abriendo `index.html` directamente porque el navegador restringe la carga local de JSON.

## GitHub y publicación

- Este repositorio es público y no contiene las planillas originales.
- Las planillas originales se comparten mediante el repositorio privado `Precipitaciones-Lluvias-Datos`.
- Los archivos JSON procesados de `data/` forman parte del repositorio y también del visualizador público.
- El workflow `.github/workflows/deploy-pages.yml` usa una lista blanca y nunca publica planillas, scripts ni documentación interna.
- Las personas que colaboran deben trabajar mediante ramas y pull requests, siguiendo `CONTRIBUTING.md`.
- Revisar `docs/PUBLICACION-Y-PRIVACIDAD.md` antes de habilitar Pages.

Para habilitar Pages por primera vez en GitHub:

1. Abrir `Settings > Pages`.
2. En `Build and deployment`, seleccionar `GitHub Actions`.
3. Ejecutar el workflow `Deploy dashboard to GitHub Pages` o realizar un push a `main`.

## Regenerar datos

El script requiere Microsoft Excel instalado y abre todas las planillas en modo solo lectura:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-data.ps1
```

Genera:

- `data/rainfall.json`: base mensual histórica por año y departamento. En la interfaz mensual se combina con acumulados diarios mensualizados cuando falta una carga mensual específica.
- `data/rainfall-daily.json`: base diaria vigente normalizada por departamento-fecha, usada para monitoreo operativo.
- `data/rainfall-daily-history.json`: registros diarios históricos 2015-2025 normalizados desde los Excel de `cesarkali-40/Registro-de-lluvias`.
- `data/rainfall-daily-combined.json`: unión histórica-operativa por departamento-fecha; ante solapamientos conserva la observación operativa vigente.
- `data/rainfall-daily-summary.json`: resumen derivado de la base operativa para ventanas móviles de 1, 7, 15 y 30 días. La interfaz actual calcula sus ventanas directamente desde la base combinada, con respaldo operativo.
- `data/department-climate-status.json`: indicadores diarios y mensuales por departamento consumidos por el mapa interactivo.
- `data/geo/corrientes-departamentos.geojson`: polígonos normalizados de los 25 departamentos de Corrientes, obtenidos de la API oficial GeoRef Argentina (geometrías basadas en IGN).
- `data/stations-climate-status.json`: contrato inicial de la futura capa puntual; puede estar vacío o no existir sin impedir la carga del mapa departamental.
- `data/stations.json`: variables meteorológicas agregadas mensualmente.
- `data/metadata.json`: cobertura y fuentes.

Para regenerar solo la base diaria desde el dashboard `Registro-de-lluvias` o desde una planilla publicada como CSV:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-daily-data.ps1
```

Para descargar los Excel 2015-2025, normalizarlos y generar las bases histórica y combinada:

```powershell
python -m pip install -r .\scripts\requirements-daily-history.txt
python .\scripts\import-daily-history.py
```

Para usar una copia local del repositorio fuente sin descargar los libros:

```powershell
python .\scripts\import-daily-history.py --source-dir "C:\ruta\Registro-de-lluvias"
```

Para regenerar los indicadores del mapa y validar su correspondencia con las fuentes actuales:

```powershell
python .\scripts\build-department-climate-status.py
python .\scripts\build-department-climate-status.py --check
```

Para actualizar el GeoJSON desde GeoRef Argentina:

```powershell
python .\scripts\fetch-corrientes-geojson.py
```

El modo `--dry-run` inspecciona y valida sin escribir JSON. El detalle de formatos, normalizaciones y supuestos está en `docs/integracion-historica-diaria.md`.

Opcionalmente se puede indicar una fuente JSON de Apps Script:

```powershell
$env:DAILY_RAIN_JSON_URL = "https://script.google.com/macros/s/.../exec"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-daily-data.ps1
```

La fuente JSON actualmente usada para el monitoreo diario es el Apps Script exportador del registro de lluvias:

```text
https://script.google.com/macros/s/AKfycbyWxsaNypgJegUB419DKjF5tXhTRAyY4mT7aH34L3fwUwmGpy_J4ywwwZAsEhJWcEY/exec
```

También se puede indicar una fuente CSV:

```powershell
$env:DAILY_RAIN_CSV_URL = "https://docs.google.com/spreadsheets/d/e/.../pub?output=csv"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-daily-data.ps1
```

Si el registro diario está separado en dos solapas o se quiere sumar una planilla adicional, configurar `DAILY_RAIN_CSV_URLS` con las URLs CSV separadas por punto y coma:

```powershell
$env:DAILY_RAIN_CSV_URLS = "https://docs.google.com/spreadsheets/d/.../export?format=csv&gid=111;https://docs.google.com/spreadsheets/d/.../export?format=csv&gid=222"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-daily-data.ps1
```

El workflow `.github/workflows/update-daily-rainfall.yml` actualiza primero la base operativa cuando está configurada alguna de las variables `DAILY_RAIN_JSON_URL`, `DAILY_RAIN_CSV_URL` o `DAILY_RAIN_CSV_URLS`. Después importa los Excel históricos, regenera las bases histórica y combinada, actualiza los indicadores departamentales del mapa y publica el tablero. Si no hay diferencias, informa que no existen cambios y finaliza sin intentar un commit vacío. Desde la pestaña `Monitoreo diario`, el enlace `Abrir flujo de actualización` abre ese workflow en GitHub Actions; la ejecución manual requiere permisos de escritura sobre el repositorio.

## Fuentes y criterios

- `DINAMICA LLUVIAS pruebas.xls`: serie histórica principal.
- `Registro-de-lluvias/plantilla_registro_lluvias.csv`, Apps Script o Google Sheets publicado como CSV: registros diarios departamentales vigentes usados para seguimiento operativo y para construir acumulados mensualizados cuando falta una carga mensual específica.
- Excel `2015.xls` a `2025.xlsx` de `cesarkali-40/Registro-de-lluvias`: referencia histórica diaria usada por el monitoreo y las ventanas diarias; no reemplaza `data/rainfall.json` ni cambia la metodología mensual.
- API GeoRef Argentina: límites departamentales WGS84 basados en IGN. El dashboard usa una copia GeoJSON local y normalizada para evitar depender de la API durante la visualización.
- `Temperatura/*.xls`: temperatura, humedad relativa, viento y lluvia registrada en períodos de 24 horas (`Rn24` en las planillas originales). El dashboard suma estos registros para mostrar la lluvia acumulada de cada mes.
- Se normalizan variantes básicas de nombres departamentales.
- Para el análisis diario, la unidad de observación es departamento-fecha. Cuando existen varias cargas para un mismo departamento y fecha, se consolida una única observación diaria departamental.
- En ausencia de una marca que indique acumulaciones parciales complementarias, se utiliza el promedio de los valores válidos para evitar inflar la lluvia departamental.
- La base mensual se compone de registros mensuales existentes y, para los meses recientes sin carga mensual específica, de acumulados construidos a partir de registros diarios consolidados por departamento y mes. Estos acumulados diarios mensualizados se utilizan como observaciones mensuales disponibles para el análisis, incluyendo promedios, mínimos y máximos mensuales.
- Los registros de `data/rainfall.json` tienen prioridad: si existe un valor mensual numérico para un departamento-año-mes, no se reemplaza por el acumulado diario mensualizado.
- Para construir un acumulado diario mensualizado se suman solo observaciones diarias válidas del mismo departamento, año y mes. No se imputan días faltantes como cero; un registro explícito de 0 mm sí cuenta como observación válida.
- Se excluyen filas vacías y registros departamentales cuyo año completo suma cero.
- Los ceros mensuales se conservan.
- Las fechas inválidas de estaciones se descartan y no se interpolan datos faltantes.
- Los filtros de departamento, año, mes y localidad permiten seleccionar múltiples valores para realizar comparaciones.
- En el gráfico climático, el color identifica la variable climática y el tipo de línea/símbolo identifica cada combinación de localidad y año. Las variables pueden mostrarse u ocultarse desde la leyenda. Cuando se eligen varios años, se muestran por separado en lugar de promediarlos.
- En el detalle departamental, la tabla compara el acumulado mensual observado del mes de referencia contra el promedio histórico del mismo mes calendario para cada departamento. Cuando el filtro está en `Año completo`, se usa el último mes mensual disponible dentro del año seleccionado; no representa el acumulado anual.
- Los desvíos departamentales comparan cada departamento contra su propio historial mensual. No se comparan contra el promedio provincial.
- En `Perfil mensual` y `Ranking departamental`, el período seleccionado se contrasta con el promedio histórico comparable del mismo departamento o del promedio departamental, calculado con la serie mensual combinada disponible.
- En el Resumen provincial, los KPIs mensuales usan un único mes de referencia con cobertura suficiente: al menos 80% de los departamentos seleccionados deben tener dato válido en la base mensual combinada. Para todos los departamentos, eso equivale a 20 de 25 departamentos.
- Los KPIs del Resumen provincial comparan el observado del mes contra el promedio histórico del mismo mes calendario. Cuando se muestran todos los departamentos, se informa el promedio departamental en mm, calculando la referencia histórica sobre los mismos departamentos con observado válido, y no se suman milímetros entre departamentos.
- El `Monitoreo diario` intenta cargar `data/rainfall-daily-combined.json` y, si no está disponible, usa `data/rainfall-daily.json` como respaldo. La mensualización derivada continúa usando exclusivamente la base operativa para no modificar la metodología mensual validada.
- Los registros históricos Excel se incorporan al análisis diario descriptivo. La mensualización derivada utiliza solo registros operativos y los identifica como derivados diarios; no se cambió la metodología mensual validada.
- Un registro con 0 mm representa una observación válida sin lluvia. `Sin dato` indica ausencia de registro válido en la ventana consultada.
- El número de observaciones analíticas puede diferir del número de filas cargadas en el sistema de registros, porque este tablero consolida los registros por departamento y fecha.
- El tablero no estima superficie inundada, hectáreas afectadas ni daño productivo.

## Áreas inundadas

Las fuentes actuales no contienen hectáreas inundadas, geometrías propias ni superficies departamentales afectadas. El mapa es una referencia territorial piloto y no representa superficie inundada calculada, hectáreas afectadas ni daño productivo.

## Desvíos mensuales departamentales

La vista `Análisis por departamento` utiliza una comparación histórica departamental:

- Identifica, para cada departamento, el último año-mes con una observación válida en la base mensual combinada.
- Si se aplican filtros explícitos de año o mes, busca el último registro válido dentro de esos filtros.
- Compara el acumulado mensual observado contra el promedio histórico de ese mismo departamento y mes calendario.
- Clasifica el desvío como Muy por debajo, Por debajo, Normal, Por encima, Muy por encima o Sin referencia.

Este indicador sirve para detectar diferencias relevantes contra el historial propio de cada departamento. No representa una evaluación hidrológica oficial porque no incorpora hectáreas inundadas, persistencia reciente ni vulnerabilidad territorial.

## Archivos del dashboard

- `index.html`: estructura de la interfaz.
- `styles.css`: diseño responsivo.
- `app.js`: filtros, métricas y visualizaciones Chart.js.
- `scripts/build-data.ps1`: transformación reproducible de planillas a JSON.
- `operational.css`: diseño institucional y navegación de la sala de situación.
- `docs/diagnostico.md`: diagnóstico de fuentes, variables y faltantes.

La carpeta `Polo/Serie-Agricola` se utilizó únicamente como referencia visual y no fue modificada.
