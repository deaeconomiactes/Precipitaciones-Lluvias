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
- `data/rainfall-daily-summary.json`: indicadores de semáforo pluviométrico para ventanas móviles de 1, 7, 15 y 30 días.
- `data/stations.json`: variables meteorológicas agregadas mensualmente.
- `data/metadata.json`: cobertura y fuentes.

Para regenerar solo la base diaria desde el dashboard `Registro-de-lluvias` o desde una planilla publicada como CSV:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-daily-data.ps1
```

Opcionalmente se puede indicar una fuente explícita:

```powershell
$env:DAILY_RAIN_CSV_URL = "https://docs.google.com/spreadsheets/d/e/.../pub?output=csv"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-daily-data.ps1
```

Si el registro diario está separado en dos solapas, configurar `DAILY_RAIN_CSV_URLS` con ambas URLs CSV separadas por punto y coma:

```powershell
$env:DAILY_RAIN_CSV_URLS = "https://docs.google.com/spreadsheets/d/.../export?format=csv&gid=111;https://docs.google.com/spreadsheets/d/.../export?format=csv&gid=222"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-daily-data.ps1
```

El workflow `.github/workflows/update-daily-rainfall.yml` puede actualizar estos JSON todos los días si el repositorio tiene configurada la variable `DAILY_RAIN_CSV_URL` con una URL CSV pública del Google Sheets, o `DAILY_RAIN_CSV_URLS` con varias URLs CSV. Desde la pestaña `Monitoreo diario`, el botón `Actualizar datos diarios` abre ese workflow para ejecutarlo manualmente con `Run workflow`; requiere permisos de escritura sobre el repositorio.

## Fuentes y criterios

- `DINAMICA LLUVIAS pruebas.xls`: serie histórica principal.
- `Registro-de-lluvias/plantilla_registro_lluvias.csv` o Google Sheets publicado como CSV: registros diarios departamentales usados para el monitoreo reciente.
- `Temperatura/*.xls`: temperatura, humedad relativa, viento y lluvia registrada en períodos de 24 horas (`Rn24` en las planillas originales). El dashboard suma estos registros para mostrar la lluvia acumulada de cada mes.
- Se normalizan variantes básicas de nombres departamentales.
- Se excluyen filas vacías y registros departamentales cuyo año completo suma cero.
- Los ceros mensuales se conservan.
- Las fechas inválidas de estaciones se descartan y no se interpolan datos faltantes.
- Los filtros de departamento, año, mes y localidad permiten seleccionar múltiples valores para realizar comparaciones.
- En el gráfico climático, el color identifica la variable climática y el tipo de línea/símbolo identifica cada combinación de localidad y año. Las variables pueden mostrarse u ocultarse desde la leyenda. Cuando se eligen varios años, se muestran por separado en lugar de promediarlos.
- En el detalle departamental, el acumulado suma las observaciones mensuales seleccionadas y el promedio se calcula sobre esas observaciones, no sobre totales anuales.
- En `Perfil mensual` y `Ranking departamental`, el período seleccionado se contrasta con el promedio histórico comparable del mismo departamento o de la provincia, calculado con la serie mensual completa disponible.
- El `Monitoreo diario` mantiene la serie diaria separada de la mensual. El semáforo compara la lluvia reciente contra el promedio histórico disponible para la misma ventana calendario; como la base diaria comienza en 2023, la referencia se muestra como promedio histórico disponible y no como normal climatológica oficial.

## Áreas inundadas

Las fuentes actuales no contienen hectáreas inundadas, geometrías ni superficies departamentales. El dashboard muestra una sección preparada, pero no calcula ni presenta estimaciones artificiales.

## Prioridad pluviométrica

La vista `Prioridad y alertas` utiliza un indicador relativo y transparente:

- Calcula la lluvia promedio de cada departamento para el período seleccionado.
- Calcula la diferencia porcentual de cada departamento frente al promedio provincial.
- Clasifica como Bajo los valores menores a −10%, Medio entre −10% y +10%, Alto entre +10% y +30%, y Crítico por encima de +30%.

Este indicador sirve para ordenar revisiones territoriales. No representa riesgo de inundación ni una alerta hidrológica oficial porque todavía no incorpora hectáreas inundadas, persistencia reciente ni vulnerabilidad territorial.

## Archivos del dashboard

- `index.html`: estructura de la interfaz.
- `styles.css`: diseño responsivo.
- `app.js`: filtros, métricas y visualizaciones Chart.js.
- `scripts/build-data.ps1`: transformación reproducible de planillas a JSON.
- `operational.css`: diseño institucional y navegación de la sala de situación.
- `docs/diagnostico.md`: diagnóstico de fuentes, variables y faltantes.

La carpeta `Polo/Serie-Agricola` se utilizó únicamente como referencia visual y no fue modificada.
