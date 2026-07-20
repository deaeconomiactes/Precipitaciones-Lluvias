# Dashboard de Precipitaciones y Clima de Corrientes

Aplicación web estática e independiente presentada como prototipo de **Sala de Situación Hídrica y Climática de Corrientes**. Organiza precipitaciones departamentales y variables de estaciones meteorológicas para facilitar una lectura territorial. Usa únicamente los archivos `.xls` incluidos en esta carpeta.

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

- `data/rainfall.json`: lluvia mensual por año y departamento.
- `data/rainfall-daily.json`: lluvia diaria departamental normalizada.
- `data/rainfall-daily-summary.json`: resumen derivado de la base diaria para ventanas móviles de 1, 7, 15 y 30 días. No se usa en la interfaz actual de `Monitoreo diario`, que trabaja directamente con `data/rainfall-daily.json`.
- `data/stations.json`: variables meteorológicas agregadas mensualmente.
- `data/metadata.json`: cobertura y fuentes.

Para regenerar solo la base diaria desde el dashboard `Registro-de-lluvias` o desde una planilla publicada como CSV:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-daily-data.ps1
```

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

El workflow `.github/workflows/update-daily-rainfall.yml` puede actualizar estos JSON todos los días si el repositorio tiene configurada la variable `DAILY_RAIN_JSON_URL` con una URL JSON de Apps Script, `DAILY_RAIN_CSV_URL` con una URL CSV pública del Google Sheets, o `DAILY_RAIN_CSV_URLS` con varias URLs CSV. Si se configuran `DAILY_RAIN_JSON_URL` y `DAILY_RAIN_CSV_URLS` al mismo tiempo, el generador combina ambas fuentes y evita duplicados exactos por fecha, departamento, municipio y lluvia. Si la fuente automática devuelve una base mucho más chica que la ya publicada, el generador conserva la base existente y actualiza solo la fecha más reciente disponible para evitar pérdidas de registros previos. Desde la pestaña `Monitoreo diario`, el botón `Actualizar datos diarios` abre ese workflow para ejecutarlo manualmente con `Run workflow`; requiere permisos de escritura sobre el repositorio.

## Fuentes y criterios

- `DINAMICA LLUVIAS pruebas.xls`: serie histórica principal.
- `Registro-de-lluvias/plantilla_registro_lluvias.csv`, Apps Script o Google Sheets publicado como CSV: registros diarios departamentales usados exclusivamente para seguimiento operativo reciente.
- `Temperatura/*.xls`: temperatura, humedad relativa, viento y lluvia registrada en períodos de 24 horas (`Rn24` en las planillas originales). El dashboard suma estos registros para mostrar la lluvia acumulada de cada mes.
- Se normalizan variantes básicas de nombres departamentales.
- Para el análisis diario, la unidad de observación es departamento-fecha. Cuando existen varias cargas para un mismo departamento y fecha, se consolida una única observación diaria departamental.
- En ausencia de una marca que indique acumulaciones parciales complementarias, se utiliza el promedio de los valores válidos para evitar inflar la lluvia departamental.
- Se excluyen filas vacías y registros departamentales cuyo año completo suma cero.
- Los ceros mensuales se conservan.
- Las fechas inválidas de estaciones se descartan y no se interpolan datos faltantes.
- Los filtros de departamento, año, mes y localidad permiten seleccionar múltiples valores para realizar comparaciones.
- En el gráfico climático, el color identifica la variable climática y el tipo de línea/símbolo identifica cada combinación de localidad y año. Las variables pueden mostrarse u ocultarse desde la leyenda. Cuando se eligen varios años, se muestran por separado en lugar de promediarlos.
- En el detalle departamental, la tabla compara el acumulado mensual observado del mes de referencia contra el promedio histórico del mismo mes calendario para cada departamento. Cuando el filtro está en `Año completo`, se usa el último mes mensual disponible dentro del año seleccionado; no representa el acumulado anual.
- Los desvíos departamentales comparan cada departamento contra su propio historial mensual. No se comparan contra el promedio provincial.
- En `Perfil mensual` y `Ranking departamental`, el período seleccionado se contrasta con el promedio histórico comparable del mismo departamento o de la provincia, calculado con la serie mensual completa disponible.
- En el Resumen provincial, los KPIs mensuales usan un único mes de referencia con cobertura suficiente: al menos 80% de los departamentos seleccionados deben tener dato válido en `data/rainfall.json`. Para todos los departamentos, eso equivale a 20 de 25 departamentos.
- Los KPIs del Resumen provincial comparan el observado del mes contra el promedio histórico del mismo mes calendario. Cuando se muestran todos los departamentos, se informa el promedio departamental en mm, calculando la referencia histórica sobre los mismos departamentos con observado válido, y no se suman milímetros entre departamentos.
- El `Monitoreo diario` mantiene la serie diaria separada de la mensual y se usa solo para seguimiento operativo reciente. La base diaria tiene cobertura temporal limitada.
- Los registros diarios no se usan para calcular normales históricas, anomalías climáticas robustas ni alertas hidrológicas oficiales.
- Un registro con 0 mm representa una observación válida sin lluvia. `Sin dato` indica ausencia de registro válido en la ventana consultada.
- El número de observaciones analíticas puede diferir del número de filas cargadas en el sistema de registros, porque este tablero consolida los registros por departamento y fecha.

## Áreas inundadas

Las fuentes actuales no contienen hectáreas inundadas, geometrías ni superficies departamentales. El dashboard muestra una sección preparada, pero no calcula ni presenta estimaciones artificiales.

## Desvíos mensuales departamentales

La vista `Análisis por departamento` utiliza una comparación histórica departamental:

- Identifica, para cada departamento, el último año-mes con una observación válida en `data/rainfall.json`.
- Si se aplican filtros explícitos de año o mes, busca el último registro válido dentro de esos filtros.
- Compara el acumulado mensual observado contra el promedio histórico de ese mismo departamento y mes calendario.
- Clasifica el desvío como Muy por debajo, Por debajo, Normal, Por encima, Muy por encima o Sin referencia.

Este indicador sirve para detectar diferencias relevantes contra el historial propio de cada departamento. No representa riesgo de inundación ni una alerta hidrológica oficial porque no incorpora hectáreas inundadas, persistencia reciente ni vulnerabilidad territorial.

## Archivos del dashboard

- `index.html`: estructura de la interfaz.
- `styles.css`: diseño responsivo.
- `app.js`: filtros, métricas y visualizaciones Chart.js.
- `scripts/build-data.ps1`: transformación reproducible de planillas a JSON.
- `operational.css`: diseño institucional y navegación de la sala de situación.
- `docs/diagnostico.md`: diagnóstico de fuentes, variables y faltantes.

La carpeta `Polo/Serie-Agricola` se utilizó únicamente como referencia visual y no fue modificada.
