# Agenda Madrid

Web de eventos de Madrid. Inspirada en agendagijon.com.

## Arquitectura

100% estatica, sin backend:
- **Frontend**: HTML + CSS + JS vanilla en `frontend/`
- **Datos**: `frontend/data/events.json` (generado por crawlers, commiteado al repo)
- **Crawlers**: Python en `crawlers/`, se ejecutan via GitHub Actions (1x/dia)
- **Hosting**: GitHub Pages con dominio custom `agendamadrid.es`

## Como funciona

1. GitHub Actions ejecuta `crawlers/build_data.py`
2. Los crawlers descargan eventos de datos.madrid.es (JSON-LD) y esmadrid.com (scraping)
3. Se deduplican por titulo+fecha, se mergea el registro mas completo
4. Se genera `frontend/data/events.json`
5. Se commitea y pushea -> GitHub Pages despliega

## Fuentes de datos

- `madrid_bibliotecas`: Eventos en bibliotecas (datos.madrid.es, JSON-LD)
- `madrid_agenda`: Agenda general de actividades (datos.madrid.es, JSON-LD)
- `esmadrid`: Agenda de esmadrid.com (scraping via sitemap + JSON-LD en cada pagina)

Nota: `madrid_cultura` se elimino porque estaba 100% contenido en `madrid_agenda`.

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
- Filtros: tipo de evento, gratis/pago, fuente
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
- esmadrid.com crawler tarda ~20 min (1s delay entre requests, ~1200 paginas)
