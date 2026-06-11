# Publicación y privacidad

## Arquitectura recomendada

### Repositorio público: `Precipitaciones-Lluvias`

Contiene:

- Código fuente del dashboard.
- Script de procesamiento.
- JSON procesados.
- Documentación y metodología.

Publica GitHub Pages y permite colaborar sobre el visualizador.

### Repositorio privado: `Precipitaciones-Lluvias-Datos`

Contiene las planillas originales `.xls`. El acceso debe limitarse a compañeros autorizados mediante `Settings > Collaborators and teams`.

### GitHub Pages público

El workflow de Pages crea una carpeta temporal `_site` mediante una lista blanca. Publica únicamente:

- `index.html`
- `app.js`
- Archivos CSS
- JSON procesados de `data/`

No publica:

- Planillas originales.
- Carpeta `Temperatura/`.
- Scripts de procesamiento.
- Documentación interna.

## Advertencia sobre los JSON públicos

GitHub Pages es un sitio estático. Los datos que utiliza el navegador pueden ser descargados por cualquier visitante.

Por lo tanto, los JSON procesados de lluvia y clima deben considerarse públicos. Si esos datos no pueden compartirse públicamente, no debe publicarse este dashboard mediante GitHub Pages sin reemplazarlos por una versión autorizada o agregada.

Esta separación permite utilizar GitHub Pages con GitHub Free sin publicar las planillas originales.
