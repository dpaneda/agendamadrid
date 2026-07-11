# Agenda Madrid

Web de eventos de Madrid.

## Arquitectura

100% estatica, sin backend:
- **Frontend**: HTML + CSS + JS vanilla en `frontend/`
- **Datos**: `frontend/data/events.json` + `frontend/data/calendar.json` + `frontend/data/locations.json` (generados por crawlers, commiteados al repo)
- **Crawlers**: Python en `crawlers/`, se ejecutan via GitHub Actions (1x/dia)
- **Hosting**: GitHub Pages con dominio custom `agendamadrid.es`

## Como funciona

1. GitHub Actions ejecuta `crawlers/build_data.py`
2. Los crawlers descargan eventos de esmadrid.com (scraping diario) y datos.madrid.es (JSON-LD)
3. Se deduplican por titulo (hash SHA256), se mergea el registro mas completo
4. Se generan `events.json` (dict por ID), `calendar.json` (fecha -> refs con horarios), `locations.json` (ubicaciones)
5. Se generan paginas pre-renderizadas por fecha, JSON-LD, sitemap.xml
6. Se commitea y pushea -> GitHub Pages despliega

## Fuentes de datos

- `esmadrid`: Scraping de esmadrid.com (busqueda diaria + JSON-LD en cada pagina, 30 dias, ~470 eventos, paralelo con ThreadPoolExecutor)
- `madrid_agenda`: API JSON-LD de datos.madrid.es (~1200 eventos)
- `teatros_canal`: Deshabilitado (.disabled)

## Categorias canonicas

8 categorias + 19 tags modificadores en `crawlers/categories.py` (set canonico interno). Todos los crawlers mapean a este set fijo. En el frontend no hay distincion categoria/subcategoria: el eje primario es el Formato (Puntual / Exposiciones / Eventos tematicos) y el resto del vocabulario se presenta como tags planos ordenados por volumen (tabla unica `TAGS` en `frontend/app.js`).

## Pipeline de datos

Documentado en detalle (fases + grafo Mermaid + CI) en **[crawlers/PIPELINE.md](crawlers/PIPELINE.md)**.

```
build_data.py               Ejecuta crawlers (o --consolidate para saltar)
  -> sources/*.json         JSON crudo por fuente en crawlers/data/sources/
enrich_source.py            Opcional: enriquece con Gemini (GEMINI_API_KEY)
download_images.py          Descarga + resize a 400px max
consolidate.py              Deduplica, mergea, poda, canonicaliza lugares -> events/calendar/locations.json
generate_seo.py             Paginas por fecha, JSON-LD, sitemap.xml
```

## Frontend

- 3 temas: Clasico (#381d92), Madrid (#b30012), Noche (#121212)
- Leaflet.js para mapa (OpenStreetMap)
- Flatpickr para selector de fecha
- Firebase opcional para sync de favoritos/vistos/settings
- Filtros: tags clickables (categoria, gratis), localizacion, fuente, ordenar por hora/precio/distancia
- Vista lista + vista mapa
- Paginas pre-renderizadas por fecha (SEO + social sharing)

## Desarrollo local

```bash
pip install -r crawlers/requirements.txt
python crawlers/build_data.py
python crawlers/build_data.py --consolidate  # solo consolidar
cd frontend && python -m http.server 8000
pytest tests/
```

## GitHub Actions

- `crawl.yml`: Diario 6:00 UTC. Crawl -> imagenes -> consolidar -> SEO -> commit + push
- `pages.yml`: Push a main -> cache-busting (hash commit en CSS/JS) -> deploy GitHub Pages

## DNS

Dominio `agendamadrid.es` en OVH, 4 registros A apuntando a GitHub Pages.
TXT de verificacion: `_github-pages-challenge-dpaneda`

## Notas

- Los crawlers no necesitan API key, todo es open data o scraping publico
- ~1500+ eventos
- 92% de eventos tienen coordenadas GPS
- Deduplicacion por SHA256 del titulo (primeros 16 chars = event ID)
- Crawl incremental: cachea paginas parseadas, reutiliza datos previos
