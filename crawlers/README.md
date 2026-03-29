# Pipeline de datos

## Flujo completo

```
1. Crawl           →  crawlers/data/sources/{fuente}.json
2. Enrich (LLM)    →  crawlers/data/sources/{fuente}.json (enriquecido)
3. Download images  →  frontend/images/events/*.jpg + actualiza sources
4. Consolidate      →  frontend/data/events.json + calendar.json + locations.json
5. SEO              →  index.html + YYYY-MM-DD/ + sitemap.xml
```

## Comandos

### Crawl individual (se pueden lanzar en paralelo)

```bash
# datos.madrid.es (rápido, ~10s, JSON API)
PYTHONPATH=. python -m crawlers.sources.madrid_datos

# datos.madrid.es con imágenes (~5-10min, scrapea cada página)
PYTHONPATH=. python -m crawlers.sources.madrid_datos --images

# esmadrid.com (~20-30min, scrapea cada página)
PYTHONPATH=. python -m crawlers.sources.esmadrid
```

### Enriquecer con LLM (opcional, necesita GEMINI_API_KEY)

```bash
# Enriquecer esmadrid (mejora descripción, precio, horarios, categorías)
PYTHONPATH=. GEMINI_API_KEY=key python -m crawlers.enrich_source esmadrid

# Limitar a N eventos
PYTHONPATH=. GEMINI_API_KEY=key python -m crawlers.enrich_source esmadrid --limit 20

# Re-enriquecer ya enriquecidos
PYTHONPATH=. GEMINI_API_KEY=key python -m crawlers.enrich_source esmadrid --all

# Probar LLM con una URL
PYTHONPATH=. GEMINI_API_KEY=key python -m crawlers.llm_parse "https://www.esmadrid.com/agenda/..."
```

### Descargar imágenes

```bash
# Descarga imágenes remotas de todos los sources, redimensiona a 400px
PYTHONPATH=. python -m crawlers.download_images
```

### Consolidar (genera los JSON del frontend)

```bash
PYTHONPATH=. python -m crawlers.consolidate
```

### Todo junto (crawl + consolidar, sin LLM ni imágenes)

```bash
python crawlers/build_data.py

# Solo consolidar
python crawlers/build_data.py --consolidate
```

## Fuentes de datos

| Fuente | Fichero | Eventos | Descripción |
|--------|---------|---------|-------------|
| `madrid_agenda` | datos.madrid.es JSON API | ~1200 | Datos estructurados, sin imágenes ni descripción |
| `esmadrid` | esmadrid.com scraping | ~470 | Scrapeo diario, imágenes, descripciones |

## Ficheros generados

| Fichero | Dónde | Público | Qué contiene |
|---------|-------|---------|-------------|
| `crawlers/data/sources/*.json` | Git | No | Datos crudos por fuente |
| `frontend/data/events.json` | GitHub Pages | Sí | Eventos consolidados (ID → evento) |
| `frontend/data/calendar.json` | GitHub Pages | Sí | Índice fecha → eventos + horarios |
| `frontend/data/locations.json` | GitHub Pages | Sí | Localizaciones (ID → coords) |
| `frontend/images/events/*.jpg` | GitHub Pages | Sí | Imágenes redimensionadas (400px) |

## Enriquecimiento LLM

Usa Gemini (Google AI) para mejorar los datos de esmadrid:

- **Descripción**: 2 frases sobre el contenido, sin logística
- **Precio**: formato normalizado (Gratis / 15 € / Desde 10 €)
- **Horarios**: por día de la semana (L,M,X,J,V,S,D)
- **Categorías**: clasificación mejorada
- **Multi-evento**: detecta festivales/ciclos

La LLM gana siempre en: descripción, precio, horarios, categorías.
El scraper gana siempre en: imagen, coordenadas, URLs.

### Modelo y límites

- Modelo: `gemini-3.1-flash-lite-preview`
- Free tier: 500 req/día, 15 req/min
- Auto-retry en 429 con el retryDelay del servidor

## Deduplicación

Los eventos se deduplicacan por SHA256 del título (normalizado a minúsculas).
Si un evento existe en ambas fuentes, se mergea: gana el registro más completo.
Prioridad de fuentes: esmadrid > madrid_agenda.

## Categorías

```
teatro, monólogos, danza, circo, conciertos, ópera, cine,
exposiciones, literatura, talleres, conferencias, visitas guiadas,
infantil, deportes, fiestas, mercados, gastronomía, otros
```

Tags (modificadores): `gratis, aire libre, destacado, accesible`
