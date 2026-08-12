# Integración hidrométrica y satelital del mapa

## Alcance

La vista inicial muestra dos clases de evidencia:

1. alturas de río puntuales publicadas por **INA**, **SNIH** y **Salto Grande**;
2. zonas observadas mediante **Copernicus GFM**, **NASA OPERA Sentinel-1** y **NASA VIIRS**.

No se dibujan estaciones sin valor, fecha o coordenadas válidas. Las tres redes hidrométricas se mantienen separadas: una coincidencia espacial no autoriza a deduplicar ni promediar alturas porque cada estación puede usar un cero de escala diferente.

Lluvia operativa, NASA POWER y GEOGLOWS siguen disponibles como contexto, pero están apagados al iniciar. Los polígonos departamentales son solo una referencia espacial.

## Arquitectura y respaldo

El navegador carga primero `data/map-point-sources.json`, por lo que el mapa no queda vacío cuando un proveedor se demora o falla. Con `npm start`, luego consulta:

```text
GET /api/river-heights
GET /api/satellite-flood-status
GET /api/rain-observations
```

El navegador solicita actualización cada 5 minutos mientras la pestaña está visible. El servidor limita las consultas reales a los proveedores mediante caché:

| Datos | Frecuencia del navegador | Caché del backend | Respaldo estático |
| --- | ---: | ---: | --- |
| Alturas INA + SNIH + Salto Grande | 5 min | 15 min | Instantánea diaria |
| Metadatos de escenas satelitales | 5 min | 60 min | Instantánea diaria |
| Lluvia operativa | Al abrir | 5 min | Instantánea diaria |

Si una de las tres redes hidrométricas falla, las otras siguen actualizándose y la interfaz conserva la última instantánea de la fuente fallida. No se reemplaza un faltante con el valor de otra red.

La instantánea se regenera con:

```bash
npm run refresh:points
```

La consulta validada el 12 de agosto de 2026 devolvió **73 alturas válidas**: 36 INA, 26 SNIH y 11 Salto Grande. Son conteos de una ejecución y pueden variar con la disponibilidad de los servicios.

## INA SIyAH

Inventario distrital:

```text
GET https://alerta.ina.gob.ar/pub/datos/estaciones&distrito=Corrientes&format=json
```

Últimas alturas:

```text
GET https://alerta.ina.gob.ar/geoserver/public2/ows
    ?service=WFS&version=2.0.0&request=GetFeature
    &typeNames=public2:ultimas_alturas_con_timeseries
    &outputFormat=application/json
    &srsName=EPSG:4326
    &bbox=-59.9,-30.8,-55.5,-27.0,EPSG:4326
```

Se conservan las lecturas dentro del límite provincial y las enlazadas al inventario hidrológico del distrito para no perder estaciones correntinas ubicadas sobre ríos limítrofes. Se guardan valor, fecha, tendencia, estado, umbrales, `series_id` y serie temporal publicada. Los umbrales iguales a cero se consideran no informados.

## Sistema Nacional de Información Hídrica

Inventario:

```text
POST https://snih.hidricosargentina.gob.ar/Filtros.aspx/LeerEstaciones
Content-Type: application/json

{}
```

Dato actual por estación:

```text
POST https://snih.hidricosargentina.gob.ar/MuestraDatos.aspx/LeerDatosActuales
Content-Type: application/json

{"estacion":"ID"}
```

La selección incluye todo el inventario que cumple simultáneamente: provincia Corrientes (`Provincia = 20`), estación habilitada y actual, transmisión telemétrica (`T`), tipo hidrométrico (`H`) y coordenadas en el área. Se consulta cada estación con concurrencia limitada.

Se excluyen alturas centinela (por ejemplo `-999`), valores fuera de rango, fechas anteriores al año 2000 y respuestas sin medición de altura. El SNIH describe estos valores actuales como telemétricos; el mapa los marca como **preliminares, sin validación definitiva**. Cuando está publicado, se conserva `CeroEscala` para interpretar la cota.

## Comisión Técnica Mixta de Salto Grande

Servicio SOAP y contrato:

```text
POST https://www.saltogrande.org/ws.php
WSDL https://www.saltogrande.org/ws.php?wsdl
```

Primero se invoca `ListaEstacionesTelemetricas(Activas=true)`. No hay una lista piloto codificada: de ese inventario se seleccionan todas las estaciones con variable `H` dentro del límite de Corrientes o hasta 8 km de su borde. El margen conserva estaciones sobre el río Uruguay —como Alvear, Yapeyú o Paso de los Libres— y excluye estaciones claramente ajenas del mismo rectángulo amplio, como Artigas, Catalán Grande, Cuareim y Paso de la Cruz.

Para cada estación pertinente se solicita `DatosHidrometeorologicos` sobre las últimas 48 horas. Se conserva la última altura, el valor precedente, la tendencia y hasta 14 observaciones de la serie. Las lecturas se identifican como operativas telemétricas.

## Observación satelital

### Copernicus Global Flood Monitoring

La imagen activa al iniciar usa la capa WMS vigente:

```text
WMS https://geoserver.gfm.eodc.eu/geoserver/gfm/wms
LAYER observed_flood_extent_group_layer
```

La escena más reciente que intersecta el rectángulo de Corrientes se descubre en el catálogo STAC oficial:

```text
POST https://stac.eodc.eu/api/v1/search
collection = GFM
bbox = [-59.9, -30.8, -55.5, -27.0]
```

### NASA OPERA Sentinel-1

```text
WMS https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi
LAYER OPERA_L3_Dynamic_Surface_Water_Extent-Sentinel-1
CMR collection C2949811996-POCLOUD
```

OPERA muestra extensión dinámica de agua superficial derivada de radar. No todo píxel de agua es necesariamente una inundación nueva.

### NASA VIIRS

```text
WMS https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi
LAYER VIIRS_Combined_Flood_3-Day
CMR collection C4064643747-LANCEMODIS
```

VIIRS aporta el compuesto observado de inundación de tres días. NASA CMR devuelve la escena más reciente que intersecta el área consultada.

En las tres capas, **intersección con Corrientes no equivale a cobertura completa de la provincia**. El mapa muestra fecha e identificador de escena, pero no convierte el ráster en hectáreas ni daño productivo.

## Fuentes secundarias

- **Lluvia operativa:** ubicaciones con coordenadas del Apps Script. `server.mjs` sigue redirecciones y usa la instantánea si el origen falla.
- **NASA POWER:** celdas de grilla de precipitación `PRECTOTCORR`; no son estaciones físicas.
- **GEOGLOWS–ECMWF:** pronóstico de caudal del tramo modelado más cercano a estaciones INA; no es altura observada.

## Variables de entorno

Ninguna variable es obligatoria para INA, SNIH, Salto Grande, GFM, OPERA o VIIRS.

| Variable | Obligatoria | Uso |
| --- | --- | --- |
| `DAILY_RAIN_JSON_URL` | No | Reemplaza el endpoint público de lluvia en el proxy y el actualizador. |
| `HOST` | No | Host local; valor predeterminado `127.0.0.1`. |
| `PORT` | No | Puerto local; valor predeterminado `8000`. |

`.env.local` está ignorado por Git. No se exponen credenciales en el navegador ni en los JSON publicados.

## Reglas de calidad y límites

- Valor, fecha e identificación de fuente son obligatorios para dibujar una altura.
- Se conservan `0 m` válidos; no se confunden con ausencia de dato.
- Se rechazan centinelas, fechas imposibles y coordenadas fuera del área pertinente.
- No se promedian ni fusionan cotas entre redes.
- Una lectura antigua se muestra con trazo discontinuo; no se elimina silenciosamente.
- Un dato telemétrico preliminar no se presenta como validado.
- Los productos ráster no se contabilizan como puntos ni como hectáreas.
- Ninguna capa sustituye alertas oficiales o evaluación hidrológica local.
