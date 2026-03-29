"""PoC: Use Gemini Flash to extract structured event data from a web page."""

import json
import os
import re
import sys

import requests
from google import genai

PROMPT = """Extrae datos estructurados de esta página web de un evento en Madrid. Devuelve JSON estricto:

{
  "title": "string - título exacto del evento",
  "description": "string - máximo 2 frases describiendo el contenido artístico/cultural. NO incluir fechas, horarios, precios, direcciones ni información logística",
  "price": "string - precio de la entrada general (ej: '15 €', 'Desde 10 €', 'Gratis', 'Entrada libre'). Busca en toda la página: secciones de precio, tarifas, entradas, ticketing. Si hay varios precios, usa el general/adulto. NUNCA null si hay cualquier indicación de precio o gratuidad",
  "location_name": "string - nombre corto del venue (ej: 'Teatro Real', 'Matadero Madrid')",
  "address": "string - calle y número, o null",
  "start_date": "string - formato YYYY-MM-DD, primer día del evento",
  "end_date": "string - formato YYYY-MM-DD, último día, o null si es un solo día",
  "schedule": "objeto con los días y horarios. Busca tablas de horario, secciones 'horario', 'cuándo', 'apertura'. Formato: {'L': '10:00-20:00', 'M': '10:00-20:00', ...} usando L,M,X,J,V,S,D para los días. Si el horario es el mismo todos los días pon {'todos': '10:00-20:00'}. null solo si no hay ninguna información de horario",
  "categories": ["EXACTAMENTE una o dos de: música, teatro, exposiciones, danza, cine, infantil, talleres, deportes, fiestas, visitas guiadas, conferencias, literatura, gastronomía, circo, fotografía, mercados, otros"],
  "is_free": "boolean - true si el evento es gratuito/entrada libre/gratis"
}

REGLAS:
- Responde SOLO con el JSON, sin markdown ni explicaciones
- BUSCA EXHAUSTIVAMENTE en toda la página: precio, horarios y fechas son CRÍTICOS
- La descripción debe ser puramente sobre el contenido, NO logística
- Máximo 2 categorías de la lista proporcionada, no inventar otras
- Fechas en formato ISO (YYYY-MM-DD)
- Si hay horarios diferentes por día, detállalos todos en schedule

HTML:
"""


def fetch_page(url):
    from bs4 import BeautifulSoup
    headers = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"}
    resp = requests.get(url, timeout=15, headers=headers)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "lxml")

    # Extract JSON-LD if available
    ld_json = ""
    ld_script = soup.find("script", type="application/ld+json")
    if ld_script and ld_script.string:
        ld_json = f"JSON-LD:\n{ld_script.string}\n\n"

    # Get only the main content area, stripping nav/header/footer/scripts
    for tag in soup(["script", "style", "nav", "header", "footer", "noscript", "iframe"]):
        tag.decompose()

    # Try to find the main content
    main = soup.find("main") or soup.find("article") or soup.find(class_=re.compile("content|node|event"))
    text = (main or soup.body or soup).get_text(separator="\n", strip=True)

    # Collapse whitespace
    text = re.sub(r'\n{3,}', '\n\n', text)
    if len(text) > 15000:
        text = text[:15000]

    return ld_json + "Page content:\n" + text


def parse_event(url, api_key=None):
    api_key = api_key or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("Error: set GEMINI_API_KEY env var or pass --key")
        sys.exit(1)

    print(f"Fetching: {url}")
    html = fetch_page(url)
    print(f"HTML: {len(html)} chars")

    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model="gemini-3-flash-preview",
        contents=PROMPT + html,
    )

    text = response.text.strip()
    if text.startswith("```"):
        text = re.sub(r'^```\w*\n?', '', text)
        text = re.sub(r'\n?```$', '', text)

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        print(f"Failed to parse JSON:\n{text[:500]}")
        return None


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("url", help="URL of event page to parse")
    parser.add_argument("--key", help="Gemini API key")
    args = parser.parse_args()

    result = parse_event(args.url, args.key)
    if result:
        print(json.dumps(result, indent=2, ensure_ascii=False))
