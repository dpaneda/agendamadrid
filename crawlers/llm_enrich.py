"""Enrich event data using Gemini LLM.

Takes already-downloaded HTML and returns structured event fields.
Supports single-event (HTML) and batch (metadata-only) modes.
"""

import json
import os
import re
import time

from bs4 import BeautifulSoup
from google import genai

PROMPT = """Extrae datos estructurados de esta página web de un evento en Madrid. Devuelve JSON estricto:

{
  "title": "string - título exacto del evento",
  "description": "string - máximo 2 frases describiendo el contenido artístico/cultural. NO incluir fechas, horarios, precios, direcciones ni información logística",
  "price": "string - precio de la entrada general. Formatos válidos: 'Gratis' (si es gratuito/entrada libre/acceso libre), '15 €' (precio único), 'Desde 10 €' (si hay varios precios, usa el más bajo). Busca en toda la página: secciones de precio, tarifas, entradas, ticketing. Si hay varios precios (general/reducida/etc), usa el general/adulto. null SOLO si no hay absolutamente ninguna indicación de precio",
  "location_name": "string - nombre corto del venue (ej: 'Teatro Real', 'Matadero Madrid')",
  "address": "string - calle y número, o null",
  "start_date": "string - formato YYYY-MM-DD, primer día del evento",
  "end_date": "string - formato YYYY-MM-DD, último día, o null si es un solo día",
  "schedule": "objeto con los días y horarios. Busca tablas de horario, secciones 'horario', 'cuándo', 'apertura'. Formato: {'L': '10:00-20:00', 'M': '10:00-20:00', ...} usando L,M,X,J,V,S,D para los días. Si el horario es el mismo todos los días pon {'todos': '10:00-20:00'}. null solo si no hay ninguna información de horario",
  "categories": ["Al menos una categoría de: teatro, conciertos, exposiciones, talleres, conferencias, deportes, ferias. Tags adicionales opcionales: infantil, visitas guiadas, gratis, danza, circo, ópera, monólogos, aire libre, cine"],
  "is_multi_event": "boolean - true si es un festival, ciclo o programación con múltiples eventos/espectáculos dentro (ej: festivales, temporadas, ciclos de conciertos). false si es un evento único"
}

REGLAS:
- Responde SOLO con el JSON, sin markdown ni explicaciones
- BUSCA EXHAUSTIVAMENTE en toda la página: precio, horarios y fechas son CRÍTICOS
- La descripción debe ser puramente sobre el contenido, NO logística
- Al menos una categoría de la lista proporcionada, no inventar otras
- Fechas en formato ISO (YYYY-MM-DD)
- Si hay horarios diferentes por día, detállalos todos en schedule

Contenido de la página:
"""

BATCH_PROMPT = """Para cada evento de Madrid, mejora los datos y clasifícalos.
Categorías válidas: teatro, conciertos, exposiciones, talleres, conferencias, deportes, ferias.
Tags opcionales: infantil, visitas guiadas, gratis, danza, circo, ópera, monólogos, aire libre, cine.

Eventos:
{events_json}

Devuelve SOLO un JSON array con un objeto por evento (mismo orden), cada uno con:
{{"title": "título mejorado", "description": "máx 2 frases del contenido", "categories": ["categorías y tags"], "price": "precio o null"}}

REGLAS:
- Responde SOLO con el JSON array, sin markdown ni explicaciones
- Al menos una categoría de la lista proporcionada, no inventar otras
- Mantén el mismo número de eventos y el mismo orden
"""

# Map LLM day abbreviations to Python weekday ints
_DAY_MAP = {"L": 0, "M": 1, "X": 2, "J": 3, "V": 4, "S": 5, "D": 6, "todos": "todos"}

_client = None

# Model fallback chain: try each in order
_MODELS = os.environ.get("GEMINI_MODEL", "gemini-3.1-flash-lite-preview,gemini-2.5-flash,gemma-4-31b-it,gemma-3-27b-it").split(",")


def _get_client():
    global _client
    if _client is None:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            return None
        _client = genai.Client(api_key=api_key)
    return _client


_dead_models = set()
_cooldown_until = {}  # model -> timestamp when cooldown expires


def _llm_call(prompt):
    """Call LLM with model fallback chain. Handles per-minute and per-day limits."""
    client = _get_client()
    if not client:
        return None

    now = time.time()
    for model in _MODELS:
        model = model.strip()
        if model in _dead_models:
            continue
        if model in _cooldown_until and now < _cooldown_until[model]:
            continue
        try:
            response = client.models.generate_content(model=model, contents=prompt)
            return response.text.strip()
        except Exception as e:
            err = str(e)
            if "429" not in err:
                print(f"    ⚠ {model} error: {e.__class__.__name__}")
                continue
            if "per day" in err.lower() or "daily" in err.lower() or "RPD" in err:
                _dead_models.add(model)
                print(f"    ✗ {model} daily limit exhausted, disabled")
            else:
                wait = 62
                try:
                    m = re.search(r'retryDelay.*?(\d+)', err)
                    if m:
                        wait = int(m.group(1)) + 2
                except Exception:
                    pass
                print(f"    ⏳ {model} per-minute limit, waiting {wait}s...")
                time.sleep(wait)
                return _llm_call(prompt)  # retry after wait
            continue
    return None


def _parse_json(raw):
    """Parse JSON from LLM response, stripping markdown fences."""
    if not raw:
        return None
    if raw.startswith("```"):
        raw = re.sub(r'^```\w*\n?', '', raw)
        raw = re.sub(r'\n?```$', '', raw)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def _clean_html(html):
    """Extract readable text from HTML, stripping noise."""
    soup = BeautifulSoup(html, "lxml")

    # Extract JSON-LD if available
    ld_json = ""
    ld_script = soup.find("script", type="application/ld+json")
    if ld_script and ld_script.string:
        ld_json = f"JSON-LD:\n{ld_script.string}\n\n"

    for tag in soup(["script", "style", "nav", "header", "footer", "noscript", "iframe"]):
        tag.decompose()

    main = soup.find("main") or soup.find("article") or soup.find(class_=re.compile("content|node|event"))
    text = (main or soup.body or soup).get_text(separator="\n", strip=True)
    text = re.sub(r'\n{3,}', '\n\n', text)
    if len(text) > 15000:
        text = text[:15000]

    return ld_json + "Page content:\n" + text


def _parse_schedule(llm_schedule):
    """Convert LLM schedule format to our internal format (weekday int -> [times])."""
    if not llm_schedule or not isinstance(llm_schedule, dict):
        return None

    schedule = {}
    for day_key, time_str in llm_schedule.items():
        if day_key == "todos":
            # Same time all days
            times = _parse_time_range(time_str)
            for d in range(7):
                schedule[d] = times
            return schedule

        day_int = _DAY_MAP.get(day_key)
        if day_int is not None:
            schedule[day_int] = _parse_time_range(time_str)

    return schedule if schedule else None


def _parse_time_range(time_str):
    """Parse '10:00-20:00' into ['10:00:00', '20:00:00']."""
    if not time_str or not isinstance(time_str, str):
        return []
    parts = time_str.split("-")
    times = []
    for p in parts:
        p = p.strip()
        if re.match(r'\d{1,2}:\d{2}$', p):
            times.append(p + ":00")
        elif re.match(r'\d{1,2}:\d{2}:\d{2}$', p):
            times.append(p)
    return times


def enrich(html):
    """Send page HTML to LLM and return enriched fields dict, or None on failure."""
    raw = _llm_call(PROMPT + _clean_html(html))
    data = _parse_json(raw)
    if not data:
        return None

    result = {}
    for field in ("title", "description", "price", "location_name", "address",
                  "start_date", "end_date"):
        if data.get(field):
            result[field] = data[field]

    if data.get("categories"):
        result["categories"] = data["categories"]

    sched = _parse_schedule(data.get("schedule"))
    if sched:
        result["schedule"] = sched

    if data.get("is_multi_event"):
        result["is_multi_event"] = True

    return result


def enrich_batch(events_data):
    """Enrich a batch of events from metadata (no HTML needed).

    events_data: list of dicts with title, categories, description, etc.
    Returns: list of enriched dicts (same order), or None on failure.
    """
    slim = []
    for ev in events_data:
        slim.append({
            "title": ev.get("title", ""),
            "categories": ev.get("categories", []),
            "description": (ev.get("description") or "")[:200],
        })

    prompt = BATCH_PROMPT.format(events_json=json.dumps(slim, ensure_ascii=False))
    raw = _llm_call(prompt)
    data = _parse_json(raw)

    if not data or not isinstance(data, list) or len(data) != len(events_data):
        return None

    return data


def merge_llm_data(scraped, llm_data):
    """Merge LLM enrichment into scraped event.

    LLM always wins for: description, price, schedule (better quality).
    LLM fills gaps for: location_name, address, start_date, end_date, categories.
    Scraper always wins for: image, latitude, longitude, source_url, url (structural data).
    """
    if not llm_data:
        return scraped

    merged = {**scraped}

    # LLM always wins for these (better quality)
    for field in ("description", "price", "schedule"):
        if llm_data.get(field):
            merged[field] = llm_data[field]

    # LLM always wins for categories (better classification)
    if llm_data.get("categories"):
        merged["categories"] = llm_data["categories"]

    # LLM fills gaps for these
    for field in ("title", "location_name", "address", "start_date", "end_date"):
        if llm_data.get(field) and not scraped.get(field):
            merged[field] = llm_data[field]

    if llm_data.get("is_multi_event"):
        merged["is_multi_event"] = True

    return merged
