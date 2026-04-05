# Agenda Madrid

Web de eventos en Madrid. Muestra conciertos, exposiciones, teatro, talleres y mucho mas, actualizados automaticamente desde fuentes abiertas.

**https://agendamadrid.es**

## Como funciona

1. Unos crawlers en Python recogen eventos de esmadrid.com y datos abiertos del Ayuntamiento
2. Los eventos se deduplican por titulo (hash SHA256) y se mergean quedandose con el registro mas completo
3. Se generan `events.json` (dict por ID), `calendar.json` (fecha -> refs con horarios) y `locations.json` (ubicaciones con coordenadas)
4. GitHub Actions ejecuta los crawlers una vez al dia (6:00 UTC)
5. Se generan paginas pre-renderizadas por fecha para SEO, JSON-LD, sitemap.xml
6. El frontend es estatico (HTML + CSS + JS vanilla) y se sirve desde GitHub Pages

No hay backend. Todo el sitio es un puñado de archivos estaticos.

## Estructura del proyecto

```
frontend/              Sitio web (lo que se despliega)
  index.html
  style.css
  app.js
  sw.js                Service worker (PWA)
  manifest.json        Manifiesto PWA
  info.html            Pagina de informacion
  data/
    events.json        Eventos unicos (dict por ID)
    calendar.json      Calendario (fecha -> refs a eventos con horarios)
    locations.json     Ubicaciones (dict por ID, con coordenadas)
  images/events/       Thumbnails de eventos (~400px, JPEG)
  YYYY-MM-DD/          Paginas pre-renderizadas por fecha (SEO)

crawlers/              Recogida de datos
  sources/             Un modulo por fuente de datos
    esmadrid.py        Scraping de esmadrid.com (14 dias, paralelo)
    madrid_datos.py    API JSON-LD de datos.madrid.es
  build_data.py        Script principal: ejecuta crawlers y genera los JSON
  consolidate.py       Deduplicacion y merge de eventos de todas las fuentes
  categories.py        18 categorias canonicas + 4 tags modificadores
  base.py              Clase base para crawlers
  runner.py            Descubrimiento automatico de crawlers
  download_images.py   Descarga y redimensionado de imagenes
  generate_seo.py      Genera paginas por fecha, JSON-LD, sitemap
  llm_enrich.py        Enriquecimiento opcional con Gemini (necesita GEMINI_API_KEY)
  enrich_source.py     Runner de enriquecimiento LLM por lotes
  data/sources/        JSON crudo de cada fuente

tests/                 Tests con pytest

.github/workflows/
  crawl.yml            Ejecuta crawlers, descarga imagenes, consolida, genera SEO, commit + push
  pages.yml            Despliega frontend/ en GitHub Pages (con cache-busting)
```

## Desarrollo local

```bash
# Instalar dependencias de los crawlers
pip install -r crawlers/requirements.txt

# Generar datos (pipeline completo)
python crawlers/build_data.py

# Solo consolidar (sin crawlear)
python crawlers/build_data.py --consolidate

# Descargar imagenes
python -m crawlers.download_images

# Consolidar manualmente
python -m crawlers.consolidate

# Servir el frontend
cd frontend && python -m http.server 8000

# Tests
pytest tests/
```

## Fuentes de datos

| Fuente | Descripcion |
|--------|-------------|
| `esmadrid` | [esmadrid.com](https://www.esmadrid.com/agenda) — scraping diario por busqueda + JSON-LD, 14 dias, ~470 eventos |
| `madrid_datos` | [datos.madrid.es](https://datos.madrid.es) — agenda general de actividades, API JSON-LD, ~1200 eventos |

## Añadir una fuente nueva

1. Crear un archivo en `crawlers/sources/` con una clase que herede de `BaseCrawler`
2. Implementar el metodo `crawl()` que devuelve una lista de eventos
3. El runner la descubre automaticamente via `pkgutil.iter_modules()`

Cada evento debe tener al menos `title`, `start_date`, `source` y `categories`.

## Frontend

- 3 temas: Clasico (morado), Madrid (rojo), Noche (oscuro)
- Leaflet.js para mapa (OpenStreetMap, sin API key)
- Flatpickr para selector de fecha
- Firebase opcional para sync de favoritos/vistos entre dispositivos
- PWA (service worker + manifest)
- Vista lista + vista mapa
- Filtros: categorias, gratis, localizacion, fuente, ordenar por hora/precio/distancia
- Paginas pre-renderizadas por fecha para SEO y compartir en redes
