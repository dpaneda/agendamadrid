"""Inject SEO content into index.html: Schema.org JSON-LD + pre-rendered events."""

import html
import json
import os
import re
from datetime import date

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")
EVENTS_PATH = os.path.join(FRONTEND_DIR, "data", "events.json")
CALENDAR_PATH = os.path.join(FRONTEND_DIR, "data", "calendar.json")
INDEX_PATH = os.path.join(FRONTEND_DIR, "index.html")

CATEGORY_LABELS = {
    "musica": "Música", "teatro": "Teatro", "danza": "Danza", "cine": "Cine",
    "exposiciones": "Exposiciones", "conferencias": "Conferencias", "talleres": "Talleres",
    "infantil": "Infantil y familiar", "deportes": "Deportes", "fiestas": "Fiestas",
    "visitas guiadas": "Visitas guiadas", "circo": "Circo", "literatura": "Literatura",
    "fotografia": "Fotografía", "mercados": "Mercados", "gastronomia": "Gastronomía",
    "otros": "Otros",
}


def _start_datetime(ds, start_time):
    if start_time:
        return f"{ds}T{start_time}:00"
    return ds


def _generate_json_ld(today_events, today_str):
    items = []
    for ev in today_events[:60]:
        item = {
            "@type": "Event",
            "name": ev["title"],
            "startDate": _start_datetime(today_str, ev.get("start_time")),
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
            item["endDate"] = _start_datetime(today_str, ev["end_time"])
        if ev.get("url"):
            item["url"] = ev["url"]
        if ev.get("description"):
            item["description"] = ev["description"][:300]
        cats = [CATEGORY_LABELS.get(c, c) for c in (ev.get("categories") or []) if c != "gratis"]
        if cats:
            item["keywords"] = ", ".join(cats)
        is_free = "gratis" in (ev.get("categories") or [])
        item["offers"] = {
            "@type": "Offer",
            "price": "0" if is_free else "",
            "priceCurrency": "EUR",
            "availability": "https://schema.org/InStock",
        }
        if ev.get("latitude") and ev.get("longitude"):
            item["location"]["geo"] = {
                "@type": "GeoCoordinates",
                "latitude": ev["latitude"],
                "longitude": ev["longitude"],
            }
        items.append(item)

    ld = {
        "@context": "https://schema.org",
        "@graph": items,
    }
    return f'<script type="application/ld+json">\n{json.dumps(ld, ensure_ascii=False, indent=2)}\n</script>'


def _generate_prerender(today_events, today_str):
    parts = []
    for ev in today_events[:40]:
        title = html.escape(ev["title"])
        url = ev.get("url", "")
        time_str = ev.get("start_time", "")
        loc = html.escape(ev.get("location_name") or ev.get("location") or "")
        desc = html.escape((ev.get("description") or "")[:200])
        cats = [CATEGORY_LABELS.get(c, c) for c in (ev.get("categories") or []) if c != "gratis"]
        is_free = "gratis" in (ev.get("categories") or [])

        title_html = f'<a href="{html.escape(url)}">{title}</a>' if url else title
        time_html = f'<time datetime="{html.escape(_start_datetime(today_str, time_str))}">{html.escape(time_str)}</time> · ' if time_str else ""
        loc_html = f'<span>{loc}</span>' if loc else ""
        free_html = ' · <span>Gratis</span>' if is_free else ""
        cats_html = f'<span>{html.escape(", ".join(cats))}</span>' if cats else ""
        desc_html = f"<p>{desc}</p>" if desc else ""

        parts.append(f"""  <article>
    <h2>{title_html}</h2>
    <p>{time_html}{loc_html}{free_html}</p>
    {f"<p>{cats_html}</p>" if cats_html else ""}
    {desc_html}
  </article>""")

    return "\n".join(parts)


def run():
    today_str = date.today().isoformat()

    with open(EVENTS_PATH) as f:
        events = json.load(f)
    with open(CALENDAR_PATH) as f:
        calendar = json.load(f)

    today_entries = calendar.get(today_str, [])
    today_events = []
    for entry in today_entries:
        ev = events.get(entry["event_id"])
        if not ev:
            continue
        today_events.append({
            **ev,
            "start_time": entry.get("start_time") or ev.get("start_time"),
            "end_time": entry.get("end_time") or ev.get("end_time"),
        })

    # Sort by start_time
    today_events.sort(key=lambda e: e.get("start_time") or "99:99")

    json_ld_tag = _generate_json_ld(today_events, today_str)
    prerender_html = _generate_prerender(today_events, today_str)

    with open(INDEX_PATH) as f:
        html_content = f.read()

    html_content = re.sub(
        r"<!-- SEO:JSON_LD:START -->.*?<!-- SEO:JSON_LD:END -->",
        f"<!-- SEO:JSON_LD:START -->{json_ld_tag}<!-- SEO:JSON_LD:END -->",
        html_content,
        flags=re.DOTALL,
    )
    html_content = re.sub(
        r"<!-- SEO:PRERENDER:START -->.*?<!-- SEO:PRERENDER:END -->",
        f"<!-- SEO:PRERENDER:START -->{prerender_html}<!-- SEO:PRERENDER:END -->",
        html_content,
        flags=re.DOTALL,
    )

    with open(INDEX_PATH, "w") as f:
        f.write(html_content)

    print(f"SEO: {len(today_events)} eventos hoy ({today_str}), JSON-LD + pre-render generados")


if __name__ == "__main__":
    run()
