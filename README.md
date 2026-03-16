# Agenda Madrid

Web de eventos en Madrid. Muestra conciertos, exposiciones, teatro, talleres y mucho mas, actualizados automaticamente desde fuentes abiertas.

**https://agendamadrid.es**

## Como funciona

1. Unos crawlers en Python recogen eventos de datos abiertos del Ayuntamiento y de esmadrid.com
2. Los eventos se deduplican y se guardan en un unico archivo JSON
3. GitHub Actions ejecuta los crawlers una vez al dia (6:00 UTC)
4. El frontend es estatico (HTML + CSS + JS vanilla) y se sirve desde GitHub Pages

No hay backend. Todo el sitio es un puñado de archivos estaticos.

## Estructura del proyecto

```
frontend/          Sitio web (lo que se despliega)
  index.html
  style.css
  app.js
  data/events.json   Datos generados por los crawlers

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
| `madrid_agenda` | [Agenda general de actividades](https://datos.madrid.es/portal/site/egob/menuitem.c05c1f754a33a9fbe4b2e4b284f1a5a0/?vgnextoid=00149033f2201410VgnVCM100000171f5a0aRCRD) (datos.madrid.es) |
| `madrid_bibliotecas` | [Actividades en bibliotecas](https://datos.madrid.es/portal/site/egob/menuitem.c05c1f754a33a9fbe4b2e4b284f1a5a0/?vgnextoid=4e02e069e0e0a410VgnVCM1000000b205a0aRCRD) (datos.madrid.es) |
| `esmadrid` | [Agenda de eventos](https://www.esmadrid.com/agenda-madrid) (esmadrid.com, scraping) |

## Añadir una fuente nueva

1. Crear un archivo en `crawlers/sources/` con una clase que herede de `BaseCrawler`
2. Implementar el metodo `crawl()` que devuelve una lista de eventos
3. El runner la descubre automaticamente

Cada evento debe tener al menos `title`, `start_date`, `source` y `categories`.
