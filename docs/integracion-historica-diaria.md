# Integracion de registros diarios historicos

## Alcance

El proceso `scripts/import-daily-history.py` importa los libros `2015.xls` a `2025.xlsx` del repositorio `cesarkali-40/Registro-de-lluvias`, genera `data/rainfall-daily-history.json` y lo combina con `data/rainfall-daily.json` en `data/rainfall-daily-combined.json`.

No modifica `data/rainfall.json`. La base mensual combinada del tablero sigue derivando meses faltantes exclusivamente desde `data/rainfall-daily.json`.

## Estructura observada en los Excel

- Cada archivo contiene 12 hojas mensuales.
- Los nombres de hoja cambian: abreviaturas como `Dptos ENE15`, variantes `Deptos ENE22` y nombres completos como `ENERO` desde 2024.
- El mes se obtiene del nombre de la hoja y, como respaldo, de su posicion entre las 12 hojas. El año se toma del nombre del archivo, por lo que errores como una hoja `OCT17` dentro del libro 2018 no cambian el año importado.
- El encabezado aparece en la fila 4 o 5 y se detecta por la presencia de dos columnas `DIA`.
- La tabla tiene dos bloques horizontales de departamentos, cada uno asociado a su propia columna `DIA`.
- La cantidad de filas varía según el mes y existen filas auxiliares o totales después de los días.
- Algunos meses incorporan `LA CRUZ` como columna adicional.

## Normalizacion territorial

Se normalizan abreviaturas y variantes ortográficas a los 25 departamentos usados por el dashboard. Dos columnas representan localidades y requieren consolidación:

- `MOCORETA` se asigna a `Monte Caseros`.
- `LA CRUZ` se asigna a `San Martin`.

Cuando esas columnas coinciden con la columna departamental en una misma fecha, se calcula el promedio de las observaciones válidas. Es la misma convención utilizada por la base mensual validada y evita sumar milímetros entre puntos territoriales.

## Fechas, lluvia y faltantes

- La fecha final se construye como año del archivo, mes de la hoja y día de la fila, y se valida con calendario real.
- La lluvia debe ser numérica, finita y estar entre 0 y 1000 mm.
- Un `0` explícito es una observación válida.
- Una celda vacía, texto no numérico, `NaN`, fecha imposible o departamento no reconocido se descarta y se contabiliza por causa.
- No se crean registros para días faltantes y no se imputan como 0 mm.
- Los valores se normalizan a dos decimales.

## Duplicados y prioridad

La clave es `department + date`.

1. Dentro de los Excel, observaciones repetidas de una misma clave se promedian.
2. Dentro de la base operativa, cualquier repetición excepcional se consolida con el mismo criterio.
3. Al combinar, la observación operativa reemplaza a la histórica para toda clave coincidente.

El resultado final contiene como máximo un registro por departamento-fecha.

## Diagnostico reproducible

Cada ejecución informa, por archivo:

- observaciones fuente válidas y registros finales;
- descartes por fecha, departamento y lluvia;
- duplicados resueltos;
- registros explícitos de 0 mm;
- departamentos y rango de fechas;
- hojas y filas de encabezado detectadas.

También informa totales históricos, operativos y combinados, solapamientos resueltos a favor de la base operativa y rango final. `--dry-run` ejecuta estas verificaciones sin escribir archivos.

## Referencia historica diaria en el tablero

La solapa `Monitoreo diario` presenta tres tarjetas para ventanas de 7, 15 y 30 días. Cada tarjeta compara el acumulado reciente con el promedio de la misma ventana calendario en años anteriores.

- El año observado actual no integra su propia referencia.
- Se exige al menos 70% de cobertura: 5/7, 11/15 o 21/30 días.
- Los ceros explícitos cuentan como días observados; las fechas ausentes no se completan.
- Se requieren al menos tres años comparables.
- Para un departamento se muestra su propia comparación.
- Para selecciones múltiples se promedian los acumulados departamentales comparables; no se suman milímetros como total provincial.

Las categorías son `Muy por debajo`, `Por debajo`, `En torno al promedio`, `Por encima`, `Muy por encima` y `Referencia insuficiente`. La lectura es descriptiva y no sustituye una evaluación oficial.
