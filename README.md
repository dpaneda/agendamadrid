# Agenda Madrid

Web de eventos en Madrid. Muestra conciertos, exposiciones, teatro, talleres y mucho mas, actualizados automaticamente desde fuentes abiertas.

**https://agendamadrid.es**

## Como funciona

1. Unos crawlers en Python recogen eventos de esmadrid.com y datos abiertos del Ayuntamiento
2. Los eventos se deduplican por titulo y se guardan en `events.json` (dict por ID) + `calendar.json` (fecha -> refs)
3. GitHub Actions ejecuta los crawlers una vez al dia (6:00 UTC)
4. El frontend es estatico (HTML + CSS + JS vanilla) y se sirve desde GitHub Pages

No hay backend. Todo el sitio es un puñado de archivos estaticos.

## Estructura del proyecto

```
frontend/          Sitio web (lo que se despliega)
  index.html
  style.css
  app.js
  data/events.json   Eventos unicos (dict por ID)
  data/calendar.json  Calendario (fecha -> refs a eventos)

crawlers/          Recogida de datos
  sources/           Un modulo por fuente de datos
  build_data.py      Script principal: ejecuta crawlers y genera el JSON
  categories.py      Categorias canonicas
  base.py            Clase base para crawlers
  runner.py          Descubrimiento y ejecucion de crawlers

.github/workflows/
  crawl.yml          Ejecuta crawlers y hace commit del JSON
  pages.yml          Despliega frontend/ en GitHub Pages
```

## Desarrollo local

```bash
# Instalar dependencias de los crawlers
pip install -r crawlers/requirements.txt

# Generar datos
python crawlers/build_data.py

# Servir el frontend
cd frontend && python -m http.server 8000
```

## Fuentes de datos

| Fuente | Descripcion |
|--------|-------------|
| `esmadrid` | [esmadrid.com](https://www.esmadrid.com/agenda) — scraping diario por busqueda, 14 dias |
| `madrid_agenda` | [datos.madrid.es](https://datos.madrid.es/portal/site/egob/menuitem.c05c1f754a33a9fbe4b2e4b284f1a5a0/?vgnextoid=00149033f2201410VgnVCM100000171f5a0aRCRD) — agenda general de actividades |

## Añadir una fuente nueva

1. Crear un archivo en `crawlers/sources/` con una clase que herede de `BaseCrawler`
2. Implementar el metodo `crawl()` que devuelve una lista de eventos
3. El runner la descubre automaticamente

Cada evento debe tener al menos `title`, `start_date`, `source` y `categories`.
