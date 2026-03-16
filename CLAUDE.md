# Agenda Madrid

Web de eventos de Madrid. Inspirada en agendagijon.com.

## Arquitectura

100% estatica, sin backend:
- **Frontend**: HTML + CSS + JS vanilla en `frontend/`
- **Datos**: `frontend/data/events.json` + `frontend/data/calendar.json` (generados por crawlers, commiteados al repo)
- **Crawlers**: Python en `crawlers/`, se ejecutan via GitHub Actions (1x/dia)
- **Hosting**: GitHub Pages con dominio custom `agendamadrid.es`

## Como funciona

1. GitHub Actions ejecuta `crawlers/build_data.py`
2. Los crawlers descargan eventos de esmadrid.com (scraping diario) y datos.madrid.es (JSON-LD)
3. Se deduplican por titulo (hash SHA256), se mergea el registro mas completo
4. Se generan `frontend/data/events.json` (dict por ID) y `frontend/data/calendar.json` (fecha -> refs)
5. Se commitea y pushea -> GitHub Pages despliega

## Fuentes de datos

- `esmadrid`: Agenda de esmadrid.com (scraping diario por busqueda + JSON-LD en cada pagina, 14 dias)
- `madrid_agenda`: Agenda general de actividades (datos.madrid.es, JSON-LD)
- `teatros_canal`: Teatros del Canal (API REST WordPress, deshabilitado temporalmente)

## Categorias canonicas

Definidas en `crawlers/categories.py`. Todos los crawlers mapean a este set fijo.

## Desarrollo local

```bash
pip install -r crawlers/requirements.txt

# Generar datos
python crawlers/build_data.py

# Servir localmente
cd frontend && python -m http.server 8000
```

## Frontend

- Leaflet.js para mapa (OpenStreetMap, sin API key)
- Flatpickr para selector de fecha
- Inter font (Google Fonts)
- Paleta morada (#381d92)
- Filtros: tags clickables (categoria, gratis), localizacion clickable, fuente, ordenar por hora/precio/distancia
- Vista lista + vista mapa
- Selector de fecha con flechas prev/next dia

## DNS

Dominio `agendamadrid.es` en OVH, 4 registros A apuntando a GitHub Pages.
MX records para correo OVH. SPF configurado.
TXT de verificacion: `_github-pages-challenge-dpaneda`

## Notas

- Los crawlers no necesitan API key, todo es open data o scraping publico
- ~1500+ eventos, ~1MB el JSON
- 92% de eventos tienen coordenadas GPS
- esmadrid.com crawler: busqueda diaria con reintentos (exponential backoff), ~270 eventos/dia, filtra por dias de la semana (open_days)
