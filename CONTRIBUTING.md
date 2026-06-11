# Colaborar en el dashboard

## Flujo recomendado

1. Clonar el repositorio.
2. Crear una rama para cada cambio:

```bash
git checkout -b mejora/nombre-del-cambio
```

3. Ejecutar el dashboard localmente:

```bash
python -m http.server 8000
```

4. Abrir `http://localhost:8000`, verificar los cambios y crear un pull request hacia `main`.

Cada cambio integrado en `main` activa automáticamente la publicación en GitHub Pages.

## Datos

- Los JSON procesados de `data/` forman parte del repositorio y permiten ejecutar el visualizador.
- Las planillas originales `.xls` se comparten únicamente dentro del repositorio privado `Precipitaciones-Lluvias-Datos`.
- El workflow de GitHub Pages no publica las planillas originales.
- Para regenerar los JSON se necesitan las planillas originales en la estructura local documentada en `README.md`.
- No incorporar información sensible ni datos sin autorización.

## Reglas

- No inventar hectáreas inundadas, geometrías ni indicadores sin fuente.
- Mantener visibles las unidades y limitaciones.
- Documentar cambios metodológicos.
- Probar filtros, navegación y diseño móvil antes de solicitar integración.
