"""Crawler for esmadrid.com events via daily search pages."""

import json
import re
import time
from datetime import datetime, timedelta
from urllib.parse import quote

import requests
from bs4 import BeautifulSoup

from crawlers.base import BaseCrawler
from crawlers.categories import normalize

BASE_URL = "https://www.esmadrid.com"
CRAWL_DELAY = 1  # seconds between requests
MAX_RETRIES = 3
HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

DAY_NAMES = {
    "lunes": 0, "martes": 1, "miércoles": 2, "miercoles": 2,
    "jueves": 3, "viernes": 4, "sábado": 5, "sabado": 5,
    "sábados": 5, "sabados": 5, "domingo": 6, "domingos": 6,
    "lunes a viernes": [0, 1, 2, 3, 4],
    "lunes a sábado": [0, 1, 2, 3, 4, 5],
    "lunes a sábados": [0, 1, 2, 3, 4, 5],
    "lunes a domingo": [0, 1, 2, 3, 4, 5, 6],
    "lunes a domingos": [0, 1, 2, 3, 4, 5, 6],
    "martes a sábado": [1, 2, 3, 4, 5],
    "martes a sábados": [1, 2, 3, 4, 5],
    "martes a domingo": [1, 2, 3, 4, 5, 6],
    "martes a domingos": [1, 2, 3, 4, 5, 6],
    "miércoles a domingo": [2, 3, 4, 5, 6],
    "miércoles a domingos": [2, 3, 4, 5, 6],
    "miercoles a domingo": [2, 3, 4, 5, 6],
    "jueves a domingo": [3, 4, 5, 6],
    "jueves a domingos": [3, 4, 5, 6],
    "viernes a domingo": [4, 5, 6],
    "viernes a domingos": [4, 5, 6],
}


def _parse_open_days(text):
    """Extract which days of the week an event is open from schedule text."""
    if not text:
        return None
    text_lower = text.lower()
    # Try range patterns first (longer matches)
    for pattern, days in sorted(DAY_NAMES.items(), key=lambda x: -len(x[0])):
        if pattern in text_lower:
            if isinstance(days, list):
                return set(days)
    # Try individual day names
    found = set()
    for name, day_num in DAY_NAMES.items():
        if isinstance(day_num, int) and name in text_lower:
            found.add(day_num)
    return found if found else None


CATEGORY_MAP = {
    "fiestas y eventos de la ciudad": "fiestas",
    "fiestas": "fiestas",
    "música": "musica",
    "musica": "musica",
    "conciertos": "musica",
    "niños": "infantil",
    "infantil": "infantil",
    "exposiciones": "exposiciones",
    "escenarios": "teatro",
    "teatro": "teatro",
    "musicales": "teatro",
    "deporte": "deportes",
    "deportes": "deportes",
    "danza": "danza",
    "cine": "cine",
    "gastronomía": "gastronomia",
    "gastronomia": "gastronomia",
    "flamenco": "musica",
    "ópera": "musica",
    "opera": "musica",
    "circo": "circo",
    "conferencias": "conferencias",
    "talleres": "talleres",
    "mercados": "mercados",
    "visitas guiadas": "visitas guiadas",
    "fotografia": "fotografia",
    "fotografía": "fotografia",
    "literatura": "literatura",
}


def _fetch(url):
    """GET with exponential backoff retries."""
    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.get(url, headers=HEADERS, timeout=30)
            resp.raise_for_status()
            return resp
        except Exception as e:
            if attempt == MAX_RETRIES - 1:
                raise
            wait = 2 ** (attempt + 1)
            print(f"    Retry {attempt + 1}/{MAX_RETRIES} after {wait}s: {e}")
            time.sleep(wait)


def _search_url(date_str, page=0):
    """Build search URL for a given date (DD/MM/YYYY) and page number."""
    encoded_date = quote(date_str, safe="")
    url = (
        f"{BASE_URL}/agenda/busqueda?"
        f"text=&datef%5Bdate%5D={encoded_date}"
        f"&datei%5Bdate%5D={encoded_date}"
        f"&sort_bef_combine=search_api_relevance+DESC"
        f"&items_per_page=50"
    )
    if page > 0:
        url += f"&page={page}"
    return url


def _get_event_urls_for_date(date):
    """Get all event detail URLs from search results for a specific date."""
    date_str = date.strftime("%d/%m/%Y")
    urls = []
    page = 0

    while True:
        search_url = _search_url(date_str, page)
        try:
            resp = _fetch(search_url)
        except Exception as e:
            print(f"    Error fetching search page {page}: {e}")
            break

        soup = BeautifulSoup(resp.text, "lxml")

        # Extract event links from search results
        new_urls = []
        for link in soup.find_all("a", href=re.compile(r"^/agenda/[^/?]+$")):
            href = link.get("href", "")
            if href and "/busqueda" not in href:
                full_url = BASE_URL + href
                if full_url not in urls:
                    new_urls.append(full_url)

        if not new_urls:
            break

        urls.extend(new_urls)
        page += 1
        time.sleep(CRAWL_DELAY)

        # Safety: max 30 pages (600 events per day should be plenty)
        if page >= 30:
            break

    return list(dict.fromkeys(urls))  # dedupe preserving order


def _parse_event_page(url):
    """Scrape a single event page for structured data."""
    resp = _fetch(url)
    html = resp.text
    soup = BeautifulSoup(html, "lxml")

    # Extract JSON-LD
    ld_script = soup.find("script", type="application/ld+json")
    if not ld_script:
        return None

    try:
        ld = json.loads(ld_script.string)
    except (json.JSONDecodeError, TypeError):
        return None

    # Handle @graph wrapper
    if "@graph" in ld:
        event_ld = None
        for item in ld["@graph"]:
            if item.get("@type") == "Event":
                event_ld = item
                break
        if not event_ld:
            return None
        ld = event_ld
    elif ld.get("@type") != "Event":
        return None

    title = (ld.get("name") or "").strip()
    if not title:
        return None

    description = (ld.get("description") or "").strip()
    if description:
        description = re.sub(r"<[^>]+>", "", description).strip()
        if len(description) > 300:
            description = description[:297] + "..."

    # Dates from JSON-LD (used as fallback, actual date comes from search)
    start_date = None
    end_date = None
    start_raw = ld.get("startDate", "")
    end_raw = ld.get("endDate", "")
    if start_raw:
        start_date = start_raw[:10]
    if end_raw:
        end_date = end_raw[:10]

    # Location
    location_data = ld.get("location", {})
    location_name = None
    address = None
    if isinstance(location_data, dict):
        location_name = (location_data.get("name") or "").strip() or None
        addr = location_data.get("address", {})
        if isinstance(addr, dict):
            address = (addr.get("streetAddress") or "").strip() or None

    # GPS from Drupal JS (formatter_calcule_route)
    latitude = None
    longitude = None
    route_match = re.search(
        r'formatter_calcule_route.*?lat["\']?\s*:\s*["\']?(-?\d+\.\d+).*?long["\']?\s*:\s*["\']?(-?\d+\.\d+)',
        html, re.DOTALL
    )
    if route_match:
        try:
            latitude = float(route_match.group(1))
            longitude = float(route_match.group(2))
            if latitude == 0 and longitude == 0:
                latitude = None
                longitude = None
        except ValueError:
            pass

    # Schedule/time from page
    start_time = None
    end_time = None
    schedule_el = (
        soup.find("div", class_="field-name-field-resumen-fechas-y-horarios")
        or soup.find("div", class_="field-name-field-horario")
    )
    schedule_text = ""
    if schedule_el:
        schedule_text = schedule_el.get_text()
        times = re.findall(r"(\d{1,2}[:.]\d{2})", schedule_text)
        if times:
            start_time = times[0].replace(".", ":") + ":00"
            if len(times) > 1:
                end_time = times[1].replace(".", ":") + ":00"

    # Parse open days from schedule text + description
    open_days = _parse_open_days(schedule_text) or _parse_open_days(description)

    # Price / free
    is_free = False
    price_text_raw = None
    price_el = soup.find("div", class_="field-name-field-price")
    if price_el:
        # Remove the label "Precio" from the text
        label = price_el.find("div", class_="field-label")
        if label:
            label.decompose()
        price_text_raw = price_el.get_text().strip()
        price_lower = price_text_raw.lower()
        if any(w in price_lower for w in ("gratis", "gratuito", "gratuita", "entrada libre", "acceso libre", "acceso gratuito")):
            is_free = True

    # Categories from field-name-field-categoria
    categories = []
    cat_field = soup.find("div", class_="field-name-field-categoria")
    if cat_field:
        cat_text = cat_field.get_text().lower()
        for keyword, cat in CATEGORY_MAP.items():
            if keyword in cat_text:
                categories.append(cat)

    if not categories:
        categories.append("otros")

    if is_free:
        categories.append("gratis")

    categories = list(dict.fromkeys(categories))

    # External website (the actual event/venue URL)
    event_url = None
    web_el = soup.find("div", class_="field-name-field-web")
    if web_el:
        link = web_el.find("a")
        if link and link.get("href"):
            event_url = link["href"]

    # Filter out permanent/long-running events (>180 days)
    if start_date and end_date:
        try:
            from datetime import datetime
            ds = datetime.strptime(start_date, "%Y-%m-%d")
            de = datetime.strptime(end_date, "%Y-%m-%d")
            if (de - ds).days > 365:
                return None
        except ValueError:
            pass

    return {
        "title": title,
        "description": description or None,
        "start_date": start_date,
        "end_date": end_date,
        "start_time": start_time,
        "end_time": end_time,
        "location_name": location_name,
        "address": address,
        "district": None,
        "latitude": latitude,
        "longitude": longitude,
        "url": event_url or url,
        "price": price_text_raw,
        "source_url": url,
        "source": "esmadrid",
        "categories": normalize(categories),
        "open_days": open_days,
    }


class EsMadridCrawler(BaseCrawler):
    name = "esmadrid"

    def crawl(self) -> list[dict]:
        return self.crawl_incremental(set())

    def crawl_incremental(self, known_urls: set) -> list[dict]:
        today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        days_ahead = 14
        events = []
        seen_urls = {}  # url -> parsed event data (cache across days)

        for day_offset in range(days_ahead):
            date = today + timedelta(days=day_offset)
            date_str = date.strftime("%Y-%m-%d")
            t0 = time.time()
            print(f"  [{date_str}] Fetching search results...")

            day_urls = _get_event_urls_for_date(date)
            new_urls = [u for u in day_urls if u not in known_urls]
            known_count = len(day_urls) - len(new_urls)
            print(f"  [{date_str}] {len(day_urls)} found, {len(new_urls)} new, {known_count} known ({time.time()-t0:.0f}s)")

            scraped = 0
            skipped_days = 0
            errors = 0
            for url in new_urls:
                # Use cached parse if we already scraped this URL for another day
                if url in seen_urls:
                    ev = seen_urls[url]
                else:
                    try:
                        ev = _parse_event_page(url)
                        time.sleep(CRAWL_DELAY)
                    except Exception as e:
                        print(f"    Error: {url.split('/')[-1]}: {e}")
                        ev = None
                        errors += 1
                    seen_urls[url] = ev

                if ev:
                    # Skip if event doesn't run on this day of the week
                    open_days = ev.get("open_days")
                    if open_days and date.weekday() not in open_days:
                        skipped_days += 1
                        continue
                    day_ev = {**ev, "start_date": date_str}
                    events.append(day_ev)
                    scraped += 1

            # Also add events from known URLs that appear on this day
            stubs = 0
            cached = 0
            for url in day_urls:
                if url in known_urls:
                    if url in seen_urls and seen_urls[url]:
                        ev = seen_urls[url]
                        open_days = ev.get("open_days")
                        if open_days and date.weekday() not in open_days:
                            skipped_days += 1
                            continue
                        day_ev = {**ev, "start_date": date_str}
                        events.append(day_ev)
                        cached += 1
                    else:
                        events.append({"_known_url": url, "start_date": date_str})
                        stubs += 1

            print(f"  [{date_str}] +{scraped} scraped, +{cached} cached, +{stubs} stubs, -{skipped_days} wrong day, {errors} errors")

        print(f"  Total: {len(events)} events across {days_ahead} days, scraped {len(seen_urls)} unique pages")
        return events
