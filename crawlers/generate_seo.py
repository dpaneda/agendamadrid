"""Generate SEO assets: JSON-LD + pre-rendered events in index.html,
per-day static pages, sitemap.xml, and robots.txt."""

import html as html_mod
import json
import os
import re
import shutil
from datetime import date, timedelta

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")
EVENTS_PATH = os.path.join(FRONTEND_DIR, "data", "events.json")
CALENDAR_PATH = os.path.join(FRONTEND_DIR, "data", "calendar.json")
INDEX_PATH = os.path.join(FRONTEND_DIR, "index.html")
BASE_URL = "https://agendamadrid.es"

DAYS_ES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
MONTHS_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
             "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
CATEGORY_LABELS = {
    "musica": "Música", "teatro": "Teatro", "danza": "Danza", "cine": "Cine",
    "exposiciones": "Exposiciones", "conferencias": "Conferencias", "talleres": "Talleres",
    "infantil": "Infantil y familiar", "deportes": "Deportes", "fiestas": "Fiestas",
    "visitas guiadas": "Visitas guiadas", "circo": "Circo", "literatura": "Literatura",
    "fotografia": "Fotografía", "mercados": "Mercados", "gastronomia": "Gastronomía",
    "otros": "Otros",
}


def _date_label(d: date) -> str:
    return f"{DAYS_ES[d.weekday()]} {d.day} de {MONTHS_ES[d.month - 1]} de {d.year}"


def _start_dt(ds, t):
    if not t:
        return ds
    return f"{ds}T{t}" if t.count(":") >= 2 else f"{ds}T{t}:00"


def _get_day_events(events, calendar, ds):
    day_events = []
    for entry in calendar.get(ds, []):
        ev = events.get(entry["event_id"])
        if not ev:
            continue
        day_events.append({
            **ev,
            "start_time": entry.get("start_time") or ev.get("start_time"),
            "end_time": entry.get("end_time") or ev.get("end_time"),
        })
    day_events.sort(key=lambda e: e.get("start_time") or "99:99")
    return day_events


def _generate_json_ld(day_events, ds):
    items = []
    for ev in day_events[:60]:
        item = {
            "@type": "Event",
            "name": ev["title"],
            "startDate": _start_dt(ds, ev.get("start_time")),
            "eventStatus": "https://schema.org/EventScheduled",
            "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
            "location": {
                "@type": "Place",
                "name": ev.get("location_name") or ev.get("location") or "Madrid",
                "address": {
                    "@type": "PostalAddress",
                    "addressLocality": "Madrid",
                    "addressCountry": "ES",
                },
            },
        }
        if ev.get("end_time"):
            item["endDate"] = _start_dt(ds, ev["end_time"])
        if ev.get("url"):
            item["url"] = ev["url"]
        if ev.get("description"):
            item["description"] = ev["description"][:300]
        cats = [CATEGORY_LABELS.get(c, c) for c in (ev.get("categories") or []) if c != "gratis"]
        if cats:
            item["keywords"] = ", ".join(cats)
        is_free = "gratis" in (ev.get("categories") or [])
        event_url = ev.get("url") or f"{BASE_URL}/{ds}/"
        item["offers"] = {
            "@type": "Offer",
            "price": "0" if is_free else "",
            "priceCurrency": "EUR",
            "availability": "https://schema.org/InStock",
            "validFrom": ev.get("created_at", ds)[:10],
            "url": event_url,
        }
        item["image"] = f"{BASE_URL}/images/og-image.png"
        loc_name = ev.get("location_name") or ev.get("location") or "Madrid"
        item["organizer"] = {"@type": "Organization", "name": loc_name, "url": event_url}
        item["performer"] = {"@type": "PerformingGroup", "name": loc_name}
        if ev.get("latitude") and ev.get("longitude"):
            item["location"]["geo"] = {
                "@type": "GeoCoordinates",
                "latitude": ev["latitude"],
                "longitude": ev["longitude"],
            }
            if ev.get("address"):
                item["location"]["address"]["streetAddress"] = ev["address"]
        items.append(item)

    ld = {"@context": "https://schema.org", "@graph": items}
    return f'<script type="application/ld+json">\n{json.dumps(ld, ensure_ascii=False, indent=2)}\n</script>'


def _generate_prerender(day_events, ds):
    parts = []
    for ev in day_events[:40]:
        title = html_mod.escape(ev["title"])
        url = ev.get("url", "")
        time_str = ev.get("start_time", "")
        loc = html_mod.escape(ev.get("location_name") or ev.get("location") or "")
        desc = html_mod.escape((ev.get("description") or "")[:200])
        cats = [CATEGORY_LABELS.get(c, c) for c in (ev.get("categories") or []) if c != "gratis"]
        is_free = "gratis" in (ev.get("categories") or [])

        title_html = f'<a href="{html_mod.escape(url)}">{title}</a>' if url else title
        meta = " · ".join(filter(None, [
            f'<time datetime="{html_mod.escape(_start_dt(ds, time_str))}">{html_mod.escape(time_str)}</time>' if time_str else "",
            loc,
            "Gratis" if is_free else "",
            html_mod.escape(", ".join(cats)) if cats else "",
        ]))
        parts.append(f'  <article>\n    <h2>{title_html}</h2>\n    {"<p>" + meta + "</p>" if meta else ""}\n    {"<p>" + desc + "</p>" if desc else ""}\n  </article>')

    return "\n".join(parts)


def _inject_markers(page, json_ld_tag, prerender_html):
    page = re.sub(
        r"<!-- SEO:JSON_LD:START -->.*?<!-- SEO:JSON_LD:END -->",
        f"<!-- SEO:JSON_LD:START -->{json_ld_tag}<!-- SEO:JSON_LD:END -->",
        page, flags=re.DOTALL,
    )
    page = re.sub(
        r"<!-- SEO:PRERENDER:START -->.*?<!-- SEO:PRERENDER:END -->",
        f"<!-- SEO:PRERENDER:START -->{prerender_html}<!-- SEO:PRERENDER:END -->",
        page, flags=re.DOTALL,
    )
    return page


def _make_day_page(template, events, calendar, ds):
    d = date.fromisoformat(ds)
    day_label = _date_label(d)
    day_events = _get_day_events(events, calendar, ds)

    page = template
    # Base href so relative assets resolve from root
    page = page.replace("<head>", '<head>\n  <base href="/">', 1)
    # Canonical
    page = re.sub(
        r'<link rel="canonical" href="[^"]*">',
        f'<link rel="canonical" href="{BASE_URL}/{ds}/">',
        page,
    )
    # Title
    page = re.sub(
        r"<title>.*?</title>",
        f"<title>Eventos en Madrid el {day_label} - Agenda Madrid</title>",
        page,
    )
    # meta description
    n = len(day_events)
    page = re.sub(
        r'<meta name="description" content="[^"]*">',
        f'<meta name="description" content="{n} eventos en Madrid el {day_label}. Conciertos, exposiciones, teatro, talleres y mucho más.">',
        page,
    )
    # og tags
    page = re.sub(
        r'<meta property="og:title" content="[^"]*">',
        f'<meta property="og:title" content="Eventos en Madrid el {day_label} - Agenda Madrid">',
        page,
    )
    page = re.sub(
        r'<meta property="og:url" content="[^"]*">',
        f'<meta property="og:url" content="{BASE_URL}/{ds}/">',
        page,
    )
    page = re.sub(
        r'<meta property="og:description" content="[^"]*">',
        f'<meta property="og:description" content="{n} eventos en Madrid el {day_label}. Conciertos, exposiciones, teatro, talleres y mucho más.">',
        page,
    )

    json_ld_tag = _generate_json_ld(day_events, ds)
    prerender_html = _generate_prerender(day_events, ds)
    page = _inject_markers(page, json_ld_tag, prerender_html)

    day_dir = os.path.join(FRONTEND_DIR, ds)
    os.makedirs(day_dir, exist_ok=True)
    with open(os.path.join(day_dir, "index.html"), "w") as f:
        f.write(page)

    return len(day_events)


def _generate_sitemap(today, day_dates):
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    lines.append(f'  <url><loc>{BASE_URL}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>')
    lines.append(f'  <url><loc>{BASE_URL}/info.html</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>')
    for ds in sorted(day_dates):
        lines.append(f'  <url><loc>{BASE_URL}/{ds}/</loc><changefreq>daily</changefreq><priority>0.8</priority></url>')
    lines.append('</urlset>')
    with open(os.path.join(FRONTEND_DIR, "sitemap.xml"), "w") as f:
        f.write("\n".join(lines) + "\n")


def _generate_robots():
    content = f"User-agent: *\nAllow: /\nSitemap: {BASE_URL}/sitemap.xml\n"
    with open(os.path.join(FRONTEND_DIR, "robots.txt"), "w") as f:
        f.write(content)


def run():
    today = date.today()
    today_str = today.isoformat()

    with open(EVENTS_PATH) as f:
        events = json.load(f)
    with open(CALENDAR_PATH) as f:
        calendar = json.load(f)

    # Read template BEFORE injecting today (idempotent: regex replaces between markers)
    with open(INDEX_PATH) as f:
        template = f.read()

    # Update index.html with today's content
    today_events = _get_day_events(events, calendar, today_str)
    json_ld_tag = _generate_json_ld(today_events, today_str)
    prerender_html = _generate_prerender(today_events, today_str)
    today_html = _inject_markers(template, json_ld_tag, prerender_html)
    with open(INDEX_PATH, "w") as f:
        f.write(today_html)

    # Generate per-day pages for the next 60 days only
    max_date_str = (today + timedelta(days=14)).isoformat()
    future_dates = sorted(
        ds for ds in calendar
        if today_str < ds <= max_date_str and len(calendar[ds]) > 0
    )

    # Clean up date directories outside the valid window (past or too far future)
    for entry in os.listdir(FRONTEND_DIR):
        if re.match(r"^\d{4}-\d{2}-\d{2}$", entry):
            if entry < today_str or entry > max_date_str:
                shutil.rmtree(os.path.join(FRONTEND_DIR, entry), ignore_errors=True)
                print(f"  Removed: {entry}/")
    for ds in future_dates:
        n = _make_day_page(template, events, calendar, ds)

    _generate_sitemap(today, future_dates)
    _generate_robots()

    print(f"SEO: hoy {len(today_events)} eventos · {len(future_dates)} páginas futuras · sitemap + robots.txt")


if __name__ == "__main__":
    run()
