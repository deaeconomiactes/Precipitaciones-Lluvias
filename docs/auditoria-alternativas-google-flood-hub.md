# Alternativas primarias a Google Flood Hub

**Objetivo:** identificar fuentes oficiales que puedan reemplazar las funciones de pronóstico fluvial y representación espacial de inundaciones de Google Flood Hub en el futuro mapa climático de Corrientes.

**Fecha de verificación técnica:** 11 de agosto de 2026.

## Resumen técnico

Google Flood Hub puede reemplazarse, pero no mediante una única fuente. La combinación más adecuada es:

- **GEOGLOWS–ECMWF** para pronósticos y series de caudal por tramo de río.
- **Copernicus Global Flood Monitoring (GFM)** para extensión de inundaciones observada por satélite.
- **Copernicus GloFAS** como capa complementaria de pronóstico, riesgo y peligro de inundación global.
- **INA SIyAH** para observaciones locales, alturas, caudales y validación de los modelos globales.

GEOGLOWS y GFM son las alternativas con mejor relación entre información disponible y facilidad de integración. GloFAS aporta más productos hidrológicos, pero requiere mayor procesamiento de datos.

## Comparación general

| Fuente | Variable útil | Tipo de integración | Formatos | Autenticación | Actualización | Integración |
|---|---|---|---|---|---|---|
| GEOGLOWS–ECMWF | Pronóstico y simulación histórica de caudal por tramo de río | API REST | CSV y JSON | No requerida | Diaria | Alta |
| Copernicus GFM | Inundación y agua superficial observadas por Sentinel-1 | WMS-T, REST, STAC y descarga | GeoJSON, COG/GeoTIFF, WMS | WMS público; REST con token | Según adquisiciones Sentinel-1 | Alta para visualización; media para descarga |
| Copernicus GloFAS | Caudal, probabilidad de excedencia, peligro y riesgo de inundación | WMS-T y descarga por API | WMS, NetCDF-4 y GRIB2 | WMS público; EWDS con cuenta y API key | Diaria | Media |

## 1. GEOGLOWS–ECMWF

### Información disponible

GEOGLOWS ofrece pronósticos de caudal para la red fluvial global. Incluye:

- pronóstico medio y ensamble;
- estadísticas del pronóstico;
- registros recientes;
- simulación histórica;
- promedios diarios, mensuales y anuales;
- períodos de retorno;
- búsqueda del identificador del tramo más cercano a una coordenada.

El servicio informa pronósticos de hasta 15 días y una simulación histórica aproximada de 40 años.

### Conexión

API base:

```text
https://geoglows.ecmwf.int/api
```

Endpoints principales:

```text
GET /v2/dates
GET /v2/getriverid?lat=LATITUD&lon=LONGITUD
GET /v2/forecast/{river_id}
GET /v2/forecaststats/{river_id}
GET /v2/forecastensemble/{river_id}
GET /v2/forecastrecords/{river_id}
GET /v2/retrospectivedaily/{river_id}
GET /v2/returnperiods/{river_id}
```

### Prueba realizada en Corrientes

La siguiente consulta se ejecutó correctamente sin token:

```text
GET https://geoglows.ecmwf.int/api/v2/getriverid
    ?lat=-27.465&lon=-58.870
```

Respuesta:

```json
{"river_id": 640596292}
```

El pronóstico del tramo se obtuvo mediante:

```text
GET https://geoglows.ecmwf.int/api/v2/forecast/640596292
```

La respuesta fue un CSV con fecha, caudal mediano y límites de incertidumbre:

```csv
datetime,flow_uncertainty_upper,flow_median,flow_uncertainty_lower
2026-08-11T00:00:00+00:00,7770.2,7770.2,7770.2
```

Los valores anteriores son una prueba de conectividad y no una validación hidrológica oficial.

### Filtros e integración

- Coordenadas para identificar el tramo.
- `river_id` como identificador persistente del segmento fluvial.
- Fecha del pronóstico.
- Estadístico o miembro del ensamble.
- Período de la simulación histórica.

Para incorporarlo al mapa conviene construir previamente una capa de tramos GEOGLOWS de interés y asociarla con estaciones del INA. No debe seleccionarse automáticamente el tramo más cercano a cualquier punto del mapa: una coordenada ligeramente desplazada puede devolver un arroyo secundario en lugar del río Paraná o Uruguay.

### Limitación metodológica

GEOGLOWS entrega **caudal modelado**, no altura hidrométrica ni extensión espacial de la inundación. Los resultados deben contrastarse con observaciones del INA antes de utilizarse como alerta operativa.

### Uso recomendado

Pronóstico fluvial puntual y gráficos de evolución por tramo de río.

**Clasificación:** integración alta.

## 2. Copernicus Global Flood Monitoring (GFM)

### Información disponible

GFM procesa automáticamente imágenes Sentinel-1 y produce, entre otras capas:

- extensión de inundación observada;
- extensión total de agua observada;
- máscara de agua de referencia;
- zonas excluidas o con baja sensibilidad;
- valores de incertidumbre y banderas de calidad;
- huellas y metadatos de Sentinel-1;
- población y coberturas del suelo afectadas.

La extensión de inundación se obtiene por consenso entre algoritmos independientes. Los productos se procesan aproximadamente a 20 metros de resolución.

### WMS-T público

```text
https://geoserver.gfm.eodc.eu/geoserver/gfm/wms
```

El `GetCapabilities` respondió correctamente y expuso 29 capas. Entre las capas útiles se verificaron:

```text
observed_flood_extent
observed_water_extent
reference_water_mask
observed_flood_extent_footprint
observed_water_extent_footprint
```

El WMS-T permite filtrar por fecha y área geográfica mediante `TIME` y `BBOX`, por lo que puede incorporarse directamente como capa temporal en el dashboard.

### Descarga y API

GFM ofrece:

- REST API: `https://api.gfm.eodc.eu/v2/`;
- catálogo STAC: `https://stac.eodc.eu/api/v1`;
- portal para definir áreas de interés;
- descarga de rásteres COG/GeoTIFF;
- descarga o generación de GeoJSON;
- generación de máxima extensión inundada para un período.

El WMS es público. La API REST requiere una cuenta en el portal GFM y un token Bearer temporal, actualmente válido durante cinco horas. El portal permite definir áreas mediante coordenadas, polígonos dibujados o regiones administrativas.

### Filtros e integración

- Fecha o intervalo temporal.
- `BBOX` o área de interés.
- Producto o capa.
- Escena y huella Sentinel-1.
- Máxima extensión de inundación dentro de un período.

Para calcular superficie afectada por departamento se debe descargar el COG o GeoJSON e intersectarlo con los límites departamentales.

### Limitación metodológica

GFM representa inundación **observada después de una adquisición satelital**. No es un pronóstico. La disponibilidad depende de la programación y cobertura de Sentinel-1, y existen zonas donde la geometría, vegetación, relieve o características de la señal reducen la capacidad de detección.

### Uso recomendado

Capa de extensión inundada observada, comparación temporal y cálculo de superficie afectada.

**Clasificación:** integración alta mediante WMS-T; integración media para descargas automatizadas debido a la autenticación temporal.

## 3. Copernicus GloFAS

### Información disponible

GloFAS es el sistema global de pronóstico y monitoreo de inundaciones de Copernicus. Ofrece:

- pronósticos diarios de caudal;
- ensambles y probabilidades de excedencia;
- puntos de reporte;
- resúmenes de inundación;
- mapas de riesgo y peligro;
- mapeo rápido e impactos estimados;
- reanálisis, repronósticos y pronósticos estacionales.

Los pronósticos globales tienen una resolución de `0,05° × 0,05°`, aproximadamente 5 km, 51 miembros de ensamble y actualización diaria.

### WMS público

```text
https://ows.globalfloods.eu/glofas-ows/ows.py
    ?SERVICE=WMS
    &VERSION=1.3.0
    &REQUEST=GetCapabilities
```

El servicio respondió correctamente y expuso 76 capas. Se identificaron, entre otras:

```text
FloodSummary1_30
reportingPoints
RapidFloodMapping
FloodHazard100y
ForecastSkill
SeasonalForecastSkill
```

### Descarga de datos

Los datos originales están disponibles en el CEMS Early Warning Data Store (EWDS):

```text
https://ewds.climate.copernicus.eu/
```

Formatos principales:

- NetCDF-4;
- GRIB2.

La automatización se realiza mediante `cdsapi` o los nuevos servicios de ECMWF. Requiere:

- cuenta ECMWF;
- aceptación de la licencia del conjunto de datos;
- API key personal.

### Limitación metodológica

La resolución global es adecuada para grandes ríos y cuencas, pero no para arroyos pequeños ni análisis urbanos detallados. Los NetCDF y GRIB requieren recorte, selección de variables, manejo del ensamble y vinculación de celdas con la red hidrográfica.

### Uso recomendado

Capa complementaria de peligro, probabilidad de excedencia y pronóstico hidrológico regional.

**Clasificación:** integración media.

## Reemplazo recomendado de Google Flood Hub

| Función requerida | Fuente recomendada |
|---|---|
| Pronóstico de caudal por río | GEOGLOWS–ECMWF |
| Observación de inundación | Copernicus GFM |
| Polígonos o rásteres para intersección departamental | Copernicus GFM |
| Probabilidad, peligro y panorama regional | Copernicus GloFAS |
| Alturas y caudales observados localmente | INA SIyAH |

No se recomienda interpretar ninguna de estas fuentes de forma aislada como una alerta oficial. Para Corrientes, la arquitectura más sólida es **INA + GEOGLOWS + GFM**, incorporando GloFAS como capa regional complementaria.

## Fuentes oficiales

- [GEOGLOWS–ECMWF: documentación de la API](https://geoglows.ecmwf.int/documentation)
- [GEOGLOWS–ECMWF: descripción metodológica](https://geoglows.ecmwf.int/about)
- [GEOGLOWS–ECMWF: licencia](https://geoglows.ecmwf.int/license)
- [Copernicus GFM: información técnica](https://global-flood.emergency.copernicus.eu/react/technical-information/glofas-gfm/)
- [Copernicus GFM: productos](https://extwiki.eodc.eu/GFM/PUM/Products)
- [Copernicus GFM: acceso WMS-T](https://extwiki.eodc.eu/GFM/PUM/DataAccess/WMS-T)
- [Copernicus GFM: API REST](https://extwiki.eodc.eu/GFM/PUM/DataAccess/REST-APIs)
- [Copernicus GFM: portal, áreas de interés y tokens](https://extwiki.eodc.eu/GFM/PUM/DataAccess/WebApp)
- [Copernicus GFM: catálogo STAC](https://extwiki.eodc.eu/GFM/PUM/DataAccess/STAC)
- [Copernicus GloFAS: datos y servicios](https://global-flood.emergency.copernicus.eu/react/general-information/data-and-services/)
- [Copernicus GloFAS: WMS](https://confluence.ecmwf.int/spaces/CEMS/pages/247897119/Accessing%2BCEMS-Flood%2BWMS%2Bvia%2Bweb%2Bbrowser)
- [Copernicus GloFAS: descripción de los datos](https://confluence.ecmwf.int/spaces/CEMS/pages/242067364/Model%2BOutput)
- [Copernicus EWDS: acceso mediante API](https://confluence.ecmwf.int/spaces/CEMS/pages/242067432/EWDS%2BAPI)

