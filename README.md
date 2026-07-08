# Dashboard de Precipitaciones y Clima de Corrientes

AplicaciÃ³n web estÃ¡tica e independiente presentada como prototipo de **Sala de SituaciÃ³n HÃ­drica y ClimÃ¡tica de Corrientes**. Organiza precipitaciones departamentales y variables de estaciones meteorolÃ³gicas para facilitar una lectura territorial. Usa Ãºnicamente los archivos `.xls` incluidos en esta carpeta.

## Ejecutar

Los JSON necesarios ya estÃ¡n generados en `data/`. Para abrir el dashboard, iniciÃ¡ un servidor HTTP desde esta carpeta:

```powershell
python -m http.server 8000
```

Luego abrÃ­ `http://localhost:8000`. No funciona correctamente abriendo `index.html` directamente porque el navegador restringe la carga local de JSON.

## GitHub y publicaciÃ³n

- Este repositorio es pÃºblico y no contiene las planillas originales.
- Las planillas originales se comparten mediante el repositorio privado `Precipitaciones-Lluvias-Datos`.
- Los archivos JSON procesados de `data/` forman parte del repositorio y tambiÃ©n del visualizador pÃºblico.
- El workflow `.github/workflows/deploy-pages.yml` usa una lista blanca y nunca publica planillas, scripts ni documentaciÃ³n interna.
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

- `data/rainfall.json`: lluvia mensual por aÃ±o y departamento.
- `data/rainfall-daily.json`: lluvia diaria departamental normalizada.
- `data/rainfall-daily-summary.json`: indicadores de semÃ¡foro pluviomÃ©trico para ventanas mÃ³viles de 1, 7, 15 y 30 dÃ­as.
- `data/stations.json`: variables meteorolÃ³gicas agregadas mensualmente.
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

TambiÃ©n se puede indicar una fuente CSV:

```powershell
$env:DAILY_RAIN_CSV_URL = "https://docs.google.com/spreadsheets/d/e/.../pub?output=csv"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-daily-data.ps1
```

Si el registro diario estÃ¡ separado en dos solapas o se quiere sumar una planilla adicional, configurar `DAILY_RAIN_CSV_URLS` con las URLs CSV separadas por punto y coma:

```powershell
$env:DAILY_RAIN_CSV_URLS = "https://docs.google.com/spreadsheets/d/.../export?format=csv&gid=111;https://docs.google.com/spreadsheets/d/.../export?format=csv&gid=222"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-daily-data.ps1
```

El workflow `.github/workflows/update-daily-rainfall.yml` puede actualizar estos JSON todos los dÃ­as si el repositorio tiene configurada la variable `DAILY_RAIN_JSON_URL` con una URL JSON de Apps Script, `DAILY_RAIN_CSV_URL` con una URL CSV pÃºblica del Google Sheets, o `DAILY_RAIN_CSV_URLS` con varias URLs CSV. Si se configuran `DAILY_RAIN_JSON_URL` y `DAILY_RAIN_CSV_URLS` al mismo tiempo, el generador combina ambas fuentes y evita duplicados exactos por fecha, departamento, municipio y lluvia. Si la fuente automÃ¡tica devuelve una base mucho mÃ¡s chica que la ya publicada, el generador conserva la base existente y actualiza solo la fecha mÃ¡s reciente disponible para evitar pÃ©rdidas de histÃ³rico. Desde la pestaÃ±a `Monitoreo diario`, el botÃ³n `Actualizar datos diarios` abre ese workflow para ejecutarlo manualmente con `Run workflow`; requiere permisos de escritura sobre el repositorio.

## Fuentes y criterios

- `DINAMICA LLUVIAS pruebas.xls`: serie histÃ³rica principal.
- `Registro-de-lluvias/plantilla_registro_lluvias.csv`, Apps Script o Google Sheets publicado como CSV: registros diarios departamentales usados para el monitoreo reciente.
- `Temperatura/*.xls`: temperatura, humedad relativa, viento y lluvia registrada en perÃ­odos de 24 horas (`Rn24` en las planillas originales). El dashboard suma estos registros para mostrar la lluvia acumulada de cada mes.
- Se normalizan variantes bÃ¡sicas de nombres departamentales.
- En la base diaria, si existe mÃ¡s de un registro para el mismo departamento y fecha, se calcula un promedio departamental diario antes de generar las ventanas de 1, 7, 15 y 30 dÃ­as.
- Se excluyen filas vacÃ­as y registros departamentales cuyo aÃ±o completo suma cero.
- Los ceros mensuales se conservan.
- Las fechas invÃ¡lidas de estaciones se descartan y no se interpolan datos faltantes.
- Los filtros de departamento, aÃ±o, mes y localidad permiten seleccionar mÃºltiples valores para realizar comparaciones.
- En el grÃ¡fico climÃ¡tico, el color identifica la variable climÃ¡tica y el tipo de lÃ­nea/sÃ­mbolo identifica cada combinaciÃ³n de localidad y aÃ±o. Las variables pueden mostrarse u ocultarse desde la leyenda. Cuando se eligen varios aÃ±os, se muestran por separado en lugar de promediarlos.
- En el detalle departamental, la tabla compara el Ãºltimo mes disponible de cada departamento contra su promedio histÃ³rico del mismo mes calendario.
- Los desvÃ­os departamentales comparan cada departamento contra su propio historial mensual. No se comparan contra el promedio provincial.
- En `Perfil mensual` y `Ranking departamental`, el perÃ­odo seleccionado se contrasta con el promedio histÃ³rico comparable del mismo departamento o de la provincia, calculado con la serie mensual completa disponible.
- En el Resumen provincial, los KPIs mensuales usan un Ãºnico mes de referencia con cobertura suficiente: al menos 80% de los departamentos seleccionados deben tener dato vÃ¡lido en `data/rainfall.json`. Para todos los departamentos, eso equivale a 20 de 25 departamentos.
- Los KPIs del Resumen provincial comparan el observado del mes contra el promedio histÃ³rico del mismo mes calendario. Cuando se muestran todos los departamentos, se informa el promedio departamental en mm, calculando la referencia histÃ³rica sobre los mismos departamentos con observado vÃ¡lido, y no se suman milÃ­metros entre departamentos.
- El `Monitoreo diario` mantiene la serie diaria separada de la mensual. El semÃ¡foro compara la lluvia reciente contra el promedio histÃ³rico disponible para la misma ventana calendario; como la base diaria comienza en 2023, la referencia se muestra como promedio histÃ³rico disponible y no como normal climatolÃ³gica oficial.

## Ãreas inundadas

Las fuentes actuales no contienen hectÃ¡reas inundadas, geometrÃ­as ni superficies departamentales. El dashboard muestra una secciÃ³n preparada, pero no calcula ni presenta estimaciones artificiales.

## DesvÃ­os mensuales departamentales

La vista `AnÃ¡lisis por departamento` utiliza una comparaciÃ³n histÃ³rica departamental:

- Identifica, para cada departamento, el Ãºltimo aÃ±o-mes con una observaciÃ³n vÃ¡lida en `data/rainfall.json`.
- Si se aplican filtros explÃ­citos de aÃ±o o mes, busca el Ãºltimo registro vÃ¡lido dentro de esos filtros.
- Compara la lluvia observada contra el promedio histÃ³rico de ese mismo departamento y mes calendario.
- Clasifica el desvÃ­o como Muy por debajo, Por debajo, Normal, Por encima, Muy por encima o Sin referencia.

Este indicador sirve para detectar diferencias relevantes contra el historial propio de cada departamento. No representa riesgo de inundaciÃ³n ni una alerta hidrolÃ³gica oficial porque no incorpora hectÃ¡reas inundadas, persistencia reciente ni vulnerabilidad territorial.

## Archivos del dashboard

- `index.html`: estructura de la interfaz.
- `styles.css`: diseÃ±o responsivo.
- `app.js`: filtros, mÃ©tricas y visualizaciones Chart.js.
- `scripts/build-data.ps1`: transformaciÃ³n reproducible de planillas a JSON.
- `operational.css`: diseÃ±o institucional y navegaciÃ³n de la sala de situaciÃ³n.
- `docs/diagnostico.md`: diagnÃ³stico de fuentes, variables y faltantes.

La carpeta `Polo/Serie-Agricola` se utilizÃ³ Ãºnicamente como referencia visual y no fue modificada.
