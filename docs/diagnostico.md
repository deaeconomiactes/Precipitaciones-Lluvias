# Diagnóstico del proyecto

## Fuentes encontradas

- `DINAMICA LLUVIAS pruebas.xls`: lluvia mensual por año y departamento. Cobertura procesada: 1993–2026.
- `Grilla Dptos Diferencia mm 05-26.xls`: promedio, acumulado y diferencias departamentales para May–Oct 2020.
- `Grilla Dptos Diferencia % 05-26.xls`: contiene las mismas métricas principales con otro ordenamiento.
- `Temperatura/*.xls`: registros de temperatura, humedad relativa, viento y lluvia registrada durante períodos de 24 horas para ocho localidades.

## Capacidades actuales

- Comparar lluvia mensual y anual entre departamentos.
- Analizar perfiles estacionales y anomalías de la grilla disponible.
- Consultar variables climáticas históricas de estaciones.
- Ordenar departamentos mediante un indicador relativo de prioridad pluviométrica.
- Descargar el resumen departamental filtrado.

## Faltantes críticos

- No existen hectáreas ni superficie inundada observada o estimada.
- No existen GeoJSON, shapefiles, coordenadas ni geometrías departamentales.
- No existe lluvia departamental reciente diaria que permita calcular acumulados provinciales de 24 horas, 7 días o 30 días.
- No existen variables territoriales de vulnerabilidad o exposición.

Por estos faltantes, el prototipo no muestra un mapa, no estima hectáreas afectadas y no presenta su indicador de prioridad como riesgo hidrológico oficial.

## Decisiones de procesamiento

- Los archivos originales no se modifican.
- Los datos derivados se guardan en `data/`.
- Se normalizan variantes básicas de nombres departamentales.
- Se excluyen filas vacías y años departamentales totalmente en cero.
- Se conservan ceros mensuales.
- Se descartan fechas inválidas de estaciones y no se interpolan faltantes.
