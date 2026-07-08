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
- `data/stations.json`: variables meteorológicas agregadas mensualmente.
- `data/metadata.json`: cobertura y fuentes.

## Fuentes y criterios

- `DINAMICA LLUVIAS pruebas.xls`: serie histórica principal.
- `Temperatura/*.xls`: temperatura, humedad relativa, viento y lluvia registrada en períodos de 24 horas (`Rn24` en las planillas originales). El dashboard suma estos registros para mostrar la lluvia acumulada de cada mes.
- Se normalizan variantes básicas de nombres departamentales.
- Se excluyen filas vacías y registros departamentales cuyo año completo suma cero.
- Los ceros mensuales se conservan.
- Las fechas inválidas de estaciones se descartan y no se interpolan datos faltantes.
- Los filtros de departamento, año, mes y localidad permiten seleccionar múltiples valores para realizar comparaciones.
- En el gráfico climático, el color identifica la variable climática y el tipo de línea/símbolo identifica cada combinación de localidad y año. Las variables pueden mostrarse u ocultarse desde la leyenda. Cuando se eligen varios años, se muestran por separado en lugar de promediarlos.
- En el detalle departamental, la tabla compara el último mes disponible de cada departamento contra su promedio histórico del mismo mes calendario.
- Los desvíos departamentales comparan cada departamento contra su propio historial mensual. No se comparan contra el promedio provincial.
- En `Perfil mensual` y `Ranking departamental`, el período seleccionado se contrasta con el promedio histórico comparable del mismo departamento o de la provincia, calculado con la serie mensual completa disponible.
- En el Resumen provincial, los KPIs mensuales usan un único mes de referencia con cobertura suficiente: al menos 80% de los departamentos seleccionados deben tener dato válido en `data/rainfall.json`. Para todos los departamentos, eso equivale a 20 de 25 departamentos.
- Los KPIs del Resumen provincial comparan el observado del mes contra el promedio histórico del mismo mes calendario. Cuando se muestran todos los departamentos, se informa el promedio departamental en mm, calculando la referencia histórica sobre los mismos departamentos con observado válido, y no se suman milímetros entre departamentos.

## Áreas inundadas

Las fuentes actuales no contienen hectáreas inundadas, geometrías ni superficies departamentales. El dashboard muestra una sección preparada, pero no calcula ni presenta estimaciones artificiales.

## Desvíos mensuales departamentales

La vista `Análisis por departamento` utiliza una comparación histórica departamental:

- Identifica, para cada departamento, el último año-mes con una observación válida en `data/rainfall.json`.
- Si se aplican filtros explícitos de año o mes, busca el último registro válido dentro de esos filtros.
- Compara la lluvia observada contra el promedio histórico de ese mismo departamento y mes calendario.
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
